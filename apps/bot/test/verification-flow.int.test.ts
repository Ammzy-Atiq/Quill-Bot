/**
 * Bot-side verification against a real Postgres (fake Discord guild, in-memory store).
 * Skipped unless TEST_DATABASE_URL is set.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { banRepo, createDb, type DbHandle, runMigrations, verificationRepo } from '@quill/db';
import { REDIS_CHANNELS, type VerificationCompletedMessage } from '@quill/shared';
import { Collection, type Guild, type GuildMember } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { MemoryStore } from '../src/lib/store.js';
import { createLogger } from '../src/logger.js';
import { MODULES } from '../src/modules/index.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const fakeId = () => String(10n ** 17n + BigInt(randomInt(1, 2 ** 47)));

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('condition not met in time');
}

interface Recorder {
  added: string[];
  removed: string[];
  dms: number;
  kicked: string[];
  banned: string[];
}

function makeWorld() {
  const ids = { guild: fakeId(), owner: fakeId(), verified: fakeId(), unverified: fakeId() };
  const rec: Recorder = { added: [], removed: [], dms: 0, kicked: [], banned: [] };
  const members = new Collection<string, GuildMember>();
  const users = new Map<string, unknown>();
  const guild = {
    id: ids.guild,
    name: 'Verify Test',
    ownerId: ids.owner,
    members: {
      me: { id: fakeId(), roles: { highest: { position: 99 } }, permissions: { has: () => true } },
      cache: members,
      fetch: async (id: string) => members.get(id) ?? null,
    },
    channels: { cache: new Collection() },
    roles: { cache: new Collection() },
    bans: {
      create: async (id: string) => {
        rec.banned.push(id);
      },
      remove: async () => undefined,
    },
  } as unknown as Guild;

  const addMember = (userId = fakeId(), created = new Date(Date.UTC(2020, 0, 1))) => {
    const roles = new Collection<string, { id: string }>();
    const user = {
      id: userId,
      bot: false,
      username: `user${userId.slice(-4)}`,
      createdAt: created,
      createdTimestamp: created.getTime(),
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
      send: async () => {
        rec.dms++;
        return {};
      },
    };
    const member = {
      id: userId,
      guild,
      user,
      roles: {
        cache: roles,
        highest: { position: 1, comparePositionTo: () => -1 },
        add: async (id: string) => {
          roles.set(id, { id });
          rec.added.push(`${userId}:${id}`);
        },
        remove: async (id: string) => {
          roles.delete(id);
          rec.removed.push(`${userId}:${id}`);
        },
      },
      kick: async () => {
        rec.kicked.push(userId);
      },
    } as unknown as GuildMember;
    members.set(userId, member);
    users.set(userId, user);
    return member;
  };
  return { guild, ids, rec, addMember, users };
}

suite('Verification flow (integration)', () => {
  let handle: DbHandle;
  let app: App;
  const users = new Map<string, unknown>();

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, { max: 3 });
    const env = loadEnv({ dryRun: true, source: { DATABASE_URL: url! } as NodeJS.ProcessEnv });
    app = new App(env, createLogger('error', false), handle.db, new MemoryStore(), MODULES);
    await app.configs.init();
    await app.trust.init();
    await app.verification.init();
    vi.spyOn(app.client.users, 'fetch').mockImplementation(async (id) => users.get(String(id)) as never);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.store.close();
    await handle?.close();
  });

  async function setup(extra: Array<{ path: string[]; value: unknown }> = []) {
    const world = makeWorld();
    const originalAdd = world.addMember;
    world.addMember = (...args: Parameters<typeof originalAdd>) => {
      const member = originalAdd(...args);
      users.set(member.id, member.user);
      return member;
    };
    app.client.guilds.cache.set(world.ids.guild, world.guild);
    await app.configs.update(world.ids.guild, world.ids.owner, [
      { path: ['verification', 'enabled'], value: true },
      { path: ['verification', 'verifiedRoleId'], value: world.ids.verified },
      { path: ['verification', 'unverifiedRoleId'], value: world.ids.unverified },
      ...extra,
    ]);
    return world;
  }

  const completed = (
    world: ReturnType<typeof makeWorld>,
    userId: string,
    patch: Partial<VerificationCompletedMessage>,
  ) =>
    app.store.publish(REDIS_CHANNELS.verificationCompleted, {
      sessionId: randomUUID(),
      guildId: world.ids.guild,
      userId,
      verdict: 'pass',
      reasons: [],
      confidence: 1,
      linkedUserIds: [],
      addedToGuild: false,
      method: 'oauth',
      ...patch,
    } satisfies VerificationCompletedMessage);

  it('website pass: gives the verified role and removes the unverified role', async () => {
    const world = await setup();
    const member = world.addMember();
    await member.roles.add(world.ids.unverified);
    await completed(world, member.id, { verdict: 'pass' });
    await until(() => member.roles.cache.has(world.ids.verified));
    expect(member.roles.cache.has(world.ids.unverified)).toBe(false);
  });

  it('website flag → staff approve; block → ban', async () => {
    const world = await setup();
    const flagged = world.addMember();
    await completed(world, flagged.id, { verdict: 'flag', reasons: ['new_account'], confidence: 0.8 });
    await until(() => flagged.roles.cache.has(world.ids.unverified));
    expect(flagged.roles.cache.has(world.ids.verified)).toBe(false);

    const { summary } = await app.verification.review(world.guild, flagged.id, 'approve', world.ids.owner);
    expect(summary).toContain('is verified');
    expect(flagged.roles.cache.has(world.ids.verified)).toBe(true);
    expect(await verificationRepo.getGuildVerification(handle.db, world.ids.guild, flagged.id)).toMatchObject(
      {
        status: 'verified',
        reviewedBy: world.ids.owner,
      },
    );

    await app.configs.set(
      world.ids.guild,
      world.ids.owner,
      ['verification', 'evasion', 'blockAction'],
      'ban',
    );
    const evader = world.addMember();
    await completed(world, evader.id, { verdict: 'block', reasons: ['alt_of_banned'], confidence: 0.97 });
    await until(() => world.rec.banned.includes(evader.id));
  });

  it('SSO on join verifies members verified elsewhere; alts of banned members are flagged', async () => {
    const world = await setup();
    const regular = world.addMember();
    await verificationRepo.touchVerifiedIdentity(handle.db, regular.id);
    await app.verification.onJoin(regular);
    expect(regular.roles.cache.has(world.ids.verified)).toBe(true);
    expect(
      (await verificationRepo.getGuildVerification(handle.db, world.ids.guild, regular.id))?.method,
    ).toBe('sso');

    const bannedUser = fakeId();
    await banRepo.recordBan(handle.db, {
      guildId: world.ids.guild,
      userId: bannedUser,
      reason: 'raid',
      moderatorId: null,
    });
    const alt = world.addMember();
    await verificationRepo.touchVerifiedIdentity(handle.db, alt.id);
    await verificationRepo.upsertIdentityLink(handle.db, alt.id, bannedUser, 0.95, ['device']);
    await app.verification.onJoin(alt);
    expect(alt.roles.cache.has(world.ids.verified)).toBe(false);
    expect(alt.roles.cache.has(world.ids.unverified)).toBe(true);
    expect(await verificationRepo.getGuildVerification(handle.db, world.ids.guild, alt.id)).toMatchObject({
      status: 'flagged',
      method: 'sso',
    });
  });

  it('kicks members who do not verify in time', async () => {
    const world = await setup([{ path: ['verification', 'kickUnverifiedAfterMinutes'], value: 1 }]);
    const late = world.addMember();
    const quick = world.addMember();
    await app.verification.onJoin(late);
    await app.verification.onJoin(quick);
    expect(late.roles.cache.has(world.ids.unverified)).toBe(true);
    await app.verification.grant(quick, await app.configs.get(world.ids.guild), 'test');

    expect(await app.verification.sweepGuild(world.guild, Date.now())).toBe(0); // not due yet
    expect(await app.verification.sweepGuild(world.guild, Date.now() + 61_000)).toBe(1);
    expect(world.rec.kicked).toEqual([late.id]);
  });

  it('one-click mode still flags brand-new accounts', async () => {
    const world = await setup([
      { path: ['verification', 'mode'], value: 'simple' },
      { path: ['verification', 'evasion', 'minAccountAgeDays'], value: 7 },
    ]);
    const config = await app.configs.get(world.ids.guild);
    const old = world.addMember();
    const fresh = world.addMember(fakeId(), new Date());
    for (const member of [old, fresh]) {
      const evaluation = await app.verification.assess(world.guild, member.user, config);
      await app.verification.applyVerdict(world.guild, config, member.user, member, {
        ...evaluation,
        method: 'simple',
        record: true,
      });
    }
    expect(old.roles.cache.has(world.ids.verified)).toBe(true);
    expect(fresh.roles.cache.has(world.ids.verified)).toBe(false);
    expect((await verificationRepo.getGuildVerification(handle.db, world.ids.guild, fresh.id))?.status).toBe(
      'flagged',
    );
  });
});
