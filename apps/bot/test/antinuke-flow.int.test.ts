/**
 * End-to-end Anti-Nuke flow against a real Postgres (fake Discord guild, in-memory store).
 * Skipped unless TEST_DATABASE_URL is set.
 */
import { randomInt } from 'node:crypto';
import { createDb, type DbHandle, runMigrations, securityRepo, trust as trustRepo } from '@quill/db';
import {
  AuditLogEvent,
  Collection,
  type Guild,
  type GuildAuditLogsEntry,
  PermissionFlagsBits,
} from 'discord.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { MemoryStore } from '../src/lib/store.js';
import { createLogger } from '../src/logger.js';
import { viewFromRow } from '../src/modules/antinuke/cards.js';
import { MODULES } from '../src/modules/index.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const fakeId = () => String(10n ** 17n + BigInt(randomInt(1, 2 ** 47)));

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met in time');
}

interface FakeRole {
  id: string;
  name: string;
  managed: boolean;
  permissions: { bitfield: bigint };
}

function makeRole(id: string, bits: bigint, opts: { managed?: boolean; above?: boolean } = {}) {
  const role = {
    id,
    name: id,
    managed: opts.managed ?? false,
    position: 1,
    hoist: false,
    mentionable: false,
    unicodeEmoji: null,
    colors: { primaryColor: 0 },
    members: new Collection(),
    permissions: { bitfield: bits },
    comparePositionTo: () => (opts.above ? 1 : -1),
    setPermissions: async (next: bigint) => {
      role.permissions.bitfield = next;
    },
  };
  return role;
}

function makeWorld(roles: FakeRole[] = []) {
  const ids = { guild: fakeId(), owner: fakeId(), attacker: fakeId() };
  const bans: string[] = [];
  const created: string[] = [];
  const channels = new Collection<string, unknown>();
  const me = { id: fakeId(), roles: { highest: { position: 99 } }, permissions: { has: () => true } };
  const attacker = {
    id: ids.attacker,
    roles: { cache: new Collection(), highest: { position: 1, comparePositionTo: () => -1 } },
  };
  const guild = {
    id: ids.guild,
    name: 'Nuke Test',
    ownerId: ids.owner,
    verificationLevel: 1,
    explicitContentFilter: 0,
    defaultMessageNotifications: 0,
    afkChannelId: null,
    afkTimeout: 300,
    systemChannelId: null,
    description: null,
    members: {
      me,
      cache: new Collection(),
      fetch: async (id: string) => (id === ids.attacker ? attacker : null),
    },
    channels: {
      cache: channels,
      create: async (options: { name: string; type: number }) => {
        const channel = {
          id: fakeId(),
          name: options.name,
          type: options.type,
          rawPosition: 0,
          parentId: null,
          isThread: () => false,
          permissionOverwrites: { cache: new Collection() },
          setPosition: async () => undefined,
        };
        channels.set(channel.id, channel);
        created.push(options.name);
        return channel;
      },
    },
    roles: {
      cache: new Collection(roles.map((r) => [r.id, r])),
      everyone: makeRole('everyone', 0n),
    },
    bans: {
      create: async (userId: string) => {
        bans.push(userId);
      },
      remove: async () => undefined,
    },
    fetchOwner: async () => ({ send: async () => ({}) }),
    setIncidentActions: async () => ({}),
  } as unknown as Guild;
  return { guild, ids, bans, created };
}

suite('Anti-Nuke flow (integration)', () => {
  let handle: DbHandle;
  let app: App;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, { max: 3 });
    const env = loadEnv({ dryRun: true, source: { DATABASE_URL: url! } as NodeJS.ProcessEnv });
    app = new App(env, createLogger('error', false), handle.db, new MemoryStore(), MODULES);
    await app.configs.init();
    await app.trust.init();
    vi.spyOn(app.client.users, 'fetch').mockImplementation(
      async (id) => ({ id: String(id), bot: false, username: 'attacker' }) as never,
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.store.close();
    await handle?.close();
  });

  /** Simulates `channelDelete` (cached copy) + the audit-log entry for it. */
  async function deleteChannel(world: ReturnType<typeof makeWorld>, name: string) {
    const id = fakeId();
    app.antinuke.reverter.deletedChannels.set(id, {
      id,
      type: 0,
      name,
      parentId: null,
      position: 0,
      topic: null,
      nsfw: false,
      rateLimitPerUser: 0,
      bitrate: null,
      userLimit: null,
      overwrites: [],
    });
    const entry = {
      action: AuditLogEvent.ChannelDelete,
      executorId: world.ids.attacker,
      targetId: id,
      changes: [
        { key: 'name', old: name },
        { key: 'type', old: 0 },
      ],
      extra: null,
    } as unknown as GuildAuditLogsEntry;
    await app.antinuke.onAuditEntry(entry, world.guild);
  }

  const summaryOf = async (guildId: string, number = 1) => {
    const row = await securityRepo.getIncident(handle.db, guildId, number);
    return row ? viewFromRow(row) : null;
  };

  it('strict mode: punishes the first unwhitelisted deletion once and re-creates every channel', async () => {
    const world = makeWorld();
    await app.configs.set(world.ids.guild, world.ids.owner, ['antinuke', 'enabled'], true);
    for (const name of ['general', 'rules', 'announcements']) await deleteChannel(world, name);

    await until(() => world.bans.length === 1 && world.created.length === 3);
    expect(world.bans).toEqual([world.ids.attacker]);
    expect([...world.created].sort()).toEqual(['announcements', 'general', 'rules']);

    await until(async () => (await summaryOf(world.ids.guild))?.summary.reverts.reverted === 3);
    const incident = await summaryOf(world.ids.guild);
    expect(incident?.status).toBe('contained');
    expect(incident?.summary.punishment).toMatchObject({ type: 'ban', ok: true });
    expect(incident?.summary.counts).toEqual({ channel_delete: 3 });
    await until(
      async () => (await securityRepo.recentSecurityEvents(handle.db, world.ids.guild, 10)).length === 3,
    );
  }, 20_000);

  it('threshold mode: allows the limit, then punishes and reverts retroactively', async () => {
    const world = makeWorld();
    await app.configs.update(world.ids.guild, world.ids.owner, [
      { path: ['antinuke', 'enabled'], value: true },
      { path: ['antinuke', 'mode'], value: 'threshold' },
    ]);
    await deleteChannel(world, 'one');
    await deleteChannel(world, 'two'); // default limit: 2 channel deletions per 10 s
    expect(world.bans).toEqual([]);
    expect(world.created).toEqual([]);

    await deleteChannel(world, 'three');
    await until(() => world.bans.length === 1 && world.created.length === 3);
    expect([...world.created].sort()).toEqual(['one', 'three', 'two']);
  }, 20_000);

  it('anti-betray: a whitelisted user is trusted within limits and stopped when going rogue', async () => {
    const world = makeWorld();
    await app.configs.set(world.ids.guild, world.ids.owner, ['antinuke', 'enabled'], true);
    await trustRepo.upsertWhitelist(handle.db, {
      guildId: world.ids.guild,
      userId: world.ids.attacker,
      permissions: ['channel_delete'],
      addedBy: world.ids.owner,
    });
    await app.trust.invalidate(world.ids.guild);

    for (let i = 0; i < 3; i++) await deleteChannel(world, `ok-${i}`);
    expect(world.bans).toEqual([]);

    // 6 deletions → critical threat (6 × 12 = 72) → anti-betray punishes + auto emergency mode.
    for (let i = 3; i < 7; i++) await deleteChannel(world, `rogue-${i}`);
    await until(() => world.bans.length === 1 && world.created.length === 7);
    await until(async () => (await securityRepo.getEmergency(handle.db, world.ids.guild))?.active === true);
  }, 20_000);

  it('emergency mode strips dangerous permissions and restores them exactly', async () => {
    const admin = makeRole('admin', PermissionFlagsBits.Administrator);
    const mod = makeRole('mod', PermissionFlagsBits.BanMembers | PermissionFlagsBits.SendMessages);
    const member = makeRole('member', PermissionFlagsBits.SendMessages);
    const bot = makeRole('bot', PermissionFlagsBits.Administrator, { managed: true });
    const above = makeRole('above', PermissionFlagsBits.Administrator, { above: true });
    const world = makeWorld([admin, mod, member, bot, above]);

    const report = await app.emergency.activate(world.guild, 'test', false, world.ids.owner);
    expect(report.roles).toBe(2);
    expect(report.skipped).toContain('@above (above QUILL)');
    expect(admin.permissions.bitfield).toBe(0n);
    expect(mod.permissions.bitfield).toBe(PermissionFlagsBits.SendMessages);
    expect(member.permissions.bitfield).toBe(PermissionFlagsBits.SendMessages);
    expect(bot.permissions.bitfield).toBe(PermissionFlagsBits.Administrator);
    expect(await app.emergency.isActive(world.ids.guild)).toBe(true);

    const restored = await app.emergency.deactivate(world.guild, world.ids.owner);
    expect(restored.roles).toBe(2);
    expect(admin.permissions.bitfield).toBe(PermissionFlagsBits.Administrator);
    expect(mod.permissions.bitfield).toBe(PermissionFlagsBits.BanMembers | PermissionFlagsBits.SendMessages);
    expect(await app.emergency.isActive(world.ids.guild)).toBe(false);
  });
});
