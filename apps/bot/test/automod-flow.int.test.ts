/**
 * End-to-end AutoMod flow against a real Postgres (fake Discord objects, in-memory store).
 * Skipped unless TEST_DATABASE_URL is set.
 */
import { randomInt } from 'node:crypto';
import { cases as caseRepo, createDb, type DbHandle, runMigrations } from '@quill/db';
import { Collection } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { MemoryStore } from '../src/lib/store.js';
import { createLogger } from '../src/logger.js';
import { MODULES } from '../src/modules/index.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const fakeId = () => String(10n ** 17n + BigInt(randomInt(1, 2 ** 47)));

interface Recorder {
  deleted: number;
  timeouts: number[];
  dms: number;
  bans?: string[];
}

function fakeMessage(
  _app: App,
  content: string,
  rec: Recorder,
  ids: { guild: string; user: string; channel: string },
) {
  const user = {
    id: ids.user,
    bot: false,
    tag: 'tester',
    username: 'tester',
    createdTimestamp: Date.UTC(2020, 0, 1),
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    send: async () => {
      rec.dms++;
      return {};
    },
  };
  const highest = { comparePositionTo: () => -1, position: 1 };
  const member = {
    id: ids.user,
    user,
    roles: { cache: new Collection<string, unknown>(), highest },
    permissionsIn: () => ({ has: () => false }),
    timeout: async (ms: number) => {
      rec.timeouts.push(ms);
    },
    kick: async () => undefined,
  };
  const guild = {
    id: ids.guild,
    name: 'Flow Test',
    ownerId: fakeId(),
    members: {
      me: { roles: { highest: { position: 99 } }, permissions: { has: () => true } },
      fetch: async () => member,
    },
    channels: { cache: new Collection() },
    roles: { cache: new Collection() },
    bans: {
      create: async (userId: string) => {
        rec.bans = [...(rec.bans ?? []), userId];
      },
      remove: async () => undefined,
    },
  };
  return {
    inGuild: () => true,
    author: user,
    webhookId: null,
    system: false,
    guildId: ids.guild,
    guild,
    member,
    channelId: ids.channel,
    channel: { parentId: null, isSendable: () => false },
    content,
    embeds: [],
    stickers: new Collection(),
    poll: null,
    attachments: new Collection(),
    mentions: { users: new Collection(), roles: new Collection(), repliedUser: null },
    createdTimestamp: Date.now(),
    createdAt: new Date(),
    url: 'https://discord.com/channels/1/2/3',
    delete: async () => {
      rec.deleted++;
    },
  } as unknown as Parameters<App['automod']['handle']>[0];
}

suite('AutoMod flow (integration)', () => {
  let handle: DbHandle;
  let app: App;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, { max: 3 });
    const env = loadEnv({ dryRun: true, source: { DATABASE_URL: url! } as NodeJS.ProcessEnv });
    app = new App(env, createLogger('error', false), handle.db, new MemoryStore(), MODULES);
    await app.configs.init();
    await app.trust.init();
    await app.automodData.init();
  });

  afterAll(async () => {
    await app?.store.close();
    await handle?.close();
  });

  it('deletes slurs, records cases, escalates timeout → ban through the risk ladder', async () => {
    const ids = { guild: fakeId(), user: fakeId(), channel: fakeId() };
    const rec: Recorder = { deleted: 0, timeouts: [], dms: 0 };

    await app.automod.handle(fakeMessage(app, 'you are a n1gg3r', rec, ids));
    expect(rec.deleted).toBe(1);
    let history = await caseRepo.listUserCases(handle.db, ids.guild, ids.user);
    expect(history.length).toBe(1);
    const firstScore = await app.risk.score(ids.guild, ids.user);
    expect(firstScore).toBeGreaterThanOrEqual(50);
    expect(rec.timeouts).toEqual([3_600_000]); // ladder step 45 → timeout 1h

    // A second slur a moment later crosses the next ladder steps → timeout.
    await new Promise((r) => setTimeout(r, 4_100)); // burst window
    await app.automod.handle(fakeMessage(app, 'f a g g o t', rec, ids));
    expect(rec.deleted).toBe(2);
    history = await caseRepo.listUserCases(handle.db, ids.guild, ids.user);
    expect(history.length).toBe(2);
    expect(await app.risk.score(ids.guild, ids.user)).toBeGreaterThan(firstScore);
    expect(rec.bans).toEqual([ids.user]); // repeat offence × 1.5 → crosses 100 → ban
    expect(history[0]?.type).toBe('ban');
  }, 20_000);

  it('ignores clean messages and respects shadow mode', async () => {
    const ids = { guild: fakeId(), user: fakeId(), channel: fakeId() };
    const rec: Recorder = { deleted: 0, timeouts: [], dms: 0 };
    await app.automod.handle(fakeMessage(app, 'hello friends, nice weather today', rec, ids));
    expect(rec.deleted).toBe(0);

    await app.configs.set(ids.guild, ids.user, ['automod', 'words', 'shadow'], true);
    await app.automod.handle(fakeMessage(app, 'kill yourself', rec, ids));
    expect(rec.deleted).toBe(0);
    expect(await caseRepo.listUserCases(handle.db, ids.guild, ids.user)).toEqual([]);
  });

  it('applies the scam detector immediate timeout for crypto giveaway scams', async () => {
    const ids = { guild: fakeId(), user: fakeId(), channel: fakeId() };
    const rec: Recorder = { deleted: 0, timeouts: [], dms: 0 };
    await app.automod.handle(
      fakeMessage(app, 'MrBeast crypto giveaway!! use promo code BEAST to withdraw 0.5 BTC', rec, ids),
    );
    expect(rec.deleted).toBe(1);
    expect(rec.timeouts[0]).toBe(86_400_000);
    expect(rec.dms).toBeGreaterThan(0);
  });
});
