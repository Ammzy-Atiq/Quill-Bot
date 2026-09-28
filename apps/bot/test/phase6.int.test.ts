/**
 * Moderation commands, /messages and native AutoMod keyword selection against a real Postgres.
 * Skipped unless TEST_DATABASE_URL is set.
 */
import { randomInt } from 'node:crypto';
import { builtinWordlist } from '@quill/core';
import { automodRepo, cases as caseRepo, createDb, type DbHandle, runMigrations } from '@quill/db';
import { DEFAULT_TEMPLATES } from '@quill/shared';
import { Collection, type Guild } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import type { CommandContext, ComponentContext } from '../src/framework/types.js';
import { MemoryStore } from '../src/lib/store.js';
import { createLogger } from '../src/logger.js';
import { MAX_KEYWORDS, nativeKeywords } from '../src/modules/automod/native.js';
import { messagesComponents } from '../src/modules/general/messages.js';
import { MODULES } from '../src/modules/index.js';
import { warnCommand } from '../src/modules/moderation/commands.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const fakeId = () => String(10n ** 17n + BigInt(randomInt(1, 2 ** 47)));

suite('Phase 6 (integration)', () => {
  let handle: DbHandle;
  let app: App;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, { max: 3 });
    const env = loadEnv({ dryRun: true, source: { DATABASE_URL: url! } as NodeJS.ProcessEnv });
    app = new App(env, createLogger('error', false), handle.db, new MemoryStore(), MODULES);
    await app.configs.init();
  });

  afterAll(async () => {
    await app?.store.close();
    await handle?.close();
  });

  function world(targetRank = -1) {
    const ids = { guild: fakeId(), owner: fakeId(), mod: fakeId(), target: fakeId() };
    const dms: string[] = [];
    const target = {
      id: ids.target,
      user: {
        id: ids.target,
        bot: false,
        username: 'target',
        send: async () => {
          dms.push(ids.target);
          return {};
        },
      },
      roles: { cache: new Collection(), highest: { position: 1, comparePositionTo: () => targetRank } },
    };
    const guild = {
      id: ids.guild,
      name: 'Phase 6',
      ownerId: ids.owner,
      members: {
        me: { roles: { highest: { position: 99 } }, permissions: { has: () => true } },
        fetch: async (id: string) => (id === ids.target ? target : null),
      },
      channels: { cache: new Collection() },
    } as unknown as Guild;
    return { ids, guild, target, dms };
  }

  function commandContext(w: ReturnType<typeof world>, options: Record<string, unknown>, replies: unknown[]) {
    const interaction = {
      user: { id: w.ids.mod, username: 'mod' },
      member: { id: w.ids.mod, permissions: { has: () => true }, roles: { highest: { position: 5 } } },
      deferred: false,
      replied: false,
      options: {
        getUser: (name: string) => options[name] ?? null,
        getString: (name: string) => options[name] ?? null,
        getInteger: (name: string) => options[name] ?? null,
      },
      reply: async (payload: unknown) => {
        replies.push(payload);
      },
    };
    return { interaction, guild: w.guild } as unknown as Omit<CommandContext, 'app' | 'config'>;
  }

  it('/warn records a case, DMs the member and adds risk points', async () => {
    const w = world();
    const replies: unknown[] = [];
    const ctx = commandContext(w, { user: w.target.user, reason: 'spamming invites', points: 12 }, replies);
    await warnCommand.execute({ ...ctx, app, config: await app.configs.get(w.ids.guild) } as CommandContext);
    const history = await caseRepo.listUserCases(handle.db, w.ids.guild, w.ids.target);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: 'warn',
      source: 'manual',
      moderatorId: w.ids.mod,
      reason: 'spamming invites',
    });
    expect(w.dms).toEqual([w.ids.target]);
    expect(await app.risk.score(w.ids.guild, w.ids.target)).toBeCloseTo(12, 0);
    expect(replies).toHaveLength(1);
  });

  it('moderators cannot act on members at or above their own role', async () => {
    const w = world(1); // target ranks above the moderator
    const ctx = commandContext(w, { user: w.target.user, reason: 'nope' }, []);
    await expect(
      warnCommand.execute({ ...ctx, app, config: await app.configs.get(w.ids.guild) } as CommandContext),
    ).rejects.toThrow('not below yours');
    expect(await caseRepo.listUserCases(handle.db, w.ids.guild, w.ids.target)).toEqual([]);
  });

  it('/messages saves a template from the modal and drops overrides equal to the default', async () => {
    const w = world();
    const save = messagesComponents.find((c) => c.id === 'msg:save')!;
    const submit = (values: Record<string, string>, thumb: 'yes' | 'no') =>
      ({
        app,
        guild: w.guild,
        args: ['moderation_dm'],
        config: {} as never,
        interaction: {
          user: { id: w.ids.owner },
          deferred: false,
          replied: false,
          isModalSubmit: () => true,
          fields: {
            getTextInputValue: (id: string) => values[id] ?? '',
            getStringSelectValues: () => [thumb],
          },
          reply: async () => undefined,
        },
      }) as unknown as ComponentContext;

    await save.execute(
      submit({ title: 'Heads up, {user.name}', body: 'You got **{action}**: {reason}', footer: '' }, 'no'),
    );
    let config = await app.configs.get(w.ids.guild);
    expect(config.messages.templates.moderation_dm).toEqual({
      title: 'Heads up, {user.name}',
      body: 'You got **{action}**: {reason}',
      footer: '',
      showThumbnail: false,
      imageUrl: null,
    });

    const d = DEFAULT_TEMPLATES.moderation_dm;
    await save.execute(submit({ title: d.title, body: d.body, footer: d.footer }, 'yes'));
    config = await app.configs.get(w.ids.guild);
    expect(config.messages.templates.moderation_dm).toBeUndefined();

    await expect(
      save.execute(submit({ title: 'x', body: 'y', image: 'http://insecure.example/a.png' }, 'yes')),
    ).rejects.toThrow('https://');
  });

  it('native AutoMod keywords: custom words first, severity threshold, Discord limits', async () => {
    const guildId = fakeId();
    await automodRepo.addCustomWord(handle.db, {
      guildId,
      term: 'zorblax',
      match: 'boundary',
      severity: 3,
      createdBy: fakeId(),
    });
    await automodRepo.addCustomWord(handle.db, {
      guildId,
      term: 'qwxz',
      match: 'substring',
      severity: 3,
      createdBy: fakeId(),
    });
    await automodRepo.addCustomWord(handle.db, {
      guildId,
      term: 'a+b',
      match: 'regex',
      severity: 3,
      createdBy: fakeId(),
    });
    let config = await app.configs.get(guildId);
    const keywords = await nativeKeywords(app, guildId, config);
    expect(new Set(keywords.slice(0, 2))).toEqual(new Set(['zorblax', '*qwxz*'])); // custom words first
    expect(keywords).not.toContain('a+b');
    expect(new Set(keywords).size).toBe(keywords.length);
    expect(keywords.every((k) => k.length <= 60)).toBe(true);

    const eligible = builtinWordlist().filter(
      (w) =>
        w.category !== 'custom' && config.automod.words.categories[w.category].enabled && w.severity >= 4,
    );
    expect(keywords.length).toBeGreaterThan(2);
    expect(keywords.length).toBeLessThanOrEqual(eligible.length + 2);

    config = await app.configs.update(guildId, fakeId(), [
      { path: ['automod', 'native', 'minSeverity'], value: 5 },
      { path: ['automod', 'words', 'categories', 'slur_racial', 'enabled'], value: false },
    ]);
    const strict = await nativeKeywords(app, guildId, config);
    expect(strict.length).toBeLessThan(keywords.length);
    const racial = new Set(
      builtinWordlist()
        .filter((w) => w.category === 'slur_racial')
        .map((w) => w.term.toLowerCase()),
    );
    expect(strict.some((k) => racial.has(k.replace(/^\*|\*$/g, '')))).toBe(false);
    expect(Math.min(strict.length, MAX_KEYWORDS)).toBeLessThanOrEqual(1000);
  });
});
