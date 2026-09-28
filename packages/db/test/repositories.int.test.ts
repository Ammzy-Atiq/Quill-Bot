/**
 * Integration tests against a real Postgres. Skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgres://quill:quill@localhost:5432/quill_test pnpm test
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import * as automodRepo from '../src/repositories/automod.js';
import * as banRepo from '../src/repositories/bans.js';
import * as caseRepo from '../src/repositories/cases.js';
import * as guildRepo from '../src/repositories/guilds.js';
import * as riskRepo from '../src/repositories/risk.js';
import * as trustRepo from '../src/repositories/trust.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const fakeId = () => String(10n ** 17n + BigInt(randomInt(1, 2 ** 47)));

suite('db repositories (integration)', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, { max: 2 });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('upserts guilds and saves settings with optimistic concurrency', async () => {
    const guildId = fakeId();
    await guildRepo.upsertGuild(handle.db, { id: guildId, name: 'Test', ownerId: fakeId(), memberCount: 5 });
    const empty = await guildRepo.getGuildSettings(handle.db, guildId);
    expect(empty.version).toBe(0);

    const v1 = await guildRepo.saveGuildSettings(handle.db, {
      guildId,
      config: { automod: { enabled: false } },
      expectedVersion: 0,
      updatedBy: fakeId(),
    });
    expect(v1).toBe(1);
    const v2 = await guildRepo.saveGuildSettings(handle.db, {
      guildId,
      config: { automod: { enabled: true } },
      expectedVersion: 1,
      updatedBy: fakeId(),
    });
    expect(v2).toBe(2);
    await expect(
      guildRepo.saveGuildSettings(handle.db, {
        guildId,
        config: {},
        expectedVersion: 1,
        updatedBy: fakeId(),
      }),
    ).rejects.toBeInstanceOf(guildRepo.ConfigVersionConflictError);
    expect((await guildRepo.getGuildSettings(handle.db, guildId)).config).toEqual({
      automod: { enabled: true },
    });
  });

  it('numbers cases per guild atomically', async () => {
    const guildId = fakeId();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        caseRepo.createCase(handle.db, {
          guildId,
          userId: fakeId(),
          moderatorId: null,
          source: 'automod',
          type: 'warn',
          reason: 'test',
        }),
      ),
    );
    expect(results.map((r) => r.caseNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('stores trust entries (extra owners + per-action whitelist)', async () => {
    const guildId = fakeId();
    const userId = fakeId();
    await trustRepo.upsertWhitelist(handle.db, {
      guildId,
      userId,
      permissions: ['ban', 'kick'],
      addedBy: fakeId(),
    });
    await trustRepo.upsertWhitelist(handle.db, {
      guildId,
      userId,
      permissions: ['channel_create'],
      addedBy: fakeId(),
    });
    await trustRepo.addExtraOwner(handle.db, { guildId, userId: fakeId(), addedBy: fakeId() });
    const rows = await trustRepo.listTrustEntries(handle.db, guildId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === 'whitelist')?.permissions).toEqual(['channel_create']);
    expect(await trustRepo.clearWhitelist(handle.db, guildId)).toBe(1);
  });

  it('stores custom words, policies, AI credentials and risk scores', async () => {
    const guildId = fakeId();
    const user = fakeId();
    await automodRepo.addCustomWord(handle.db, {
      guildId,
      term: 'badword',
      match: 'boundary',
      severity: 3,
      createdBy: user,
    });
    await automodRepo.addCustomWord(handle.db, {
      guildId,
      term: 'badword',
      match: 'substring',
      severity: 4,
      createdBy: user,
    });
    const words = await automodRepo.listCustomWords(handle.db, guildId);
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({ match: 'substring', severity: 4 });

    await automodRepo.upsertPolicy(handle.db, {
      guildId,
      name: 'no-exe',
      definition: { a: 1 },
      createdBy: user,
    });
    expect(await automodRepo.setPolicyEnabled(handle.db, guildId, 'no-exe', false)).toBe(true);
    expect((await automodRepo.listPolicies(handle.db, guildId))[0]?.enabled).toBe(false);

    await automodRepo.saveAiCredential(handle.db, {
      guildId,
      provider: 'anthropic',
      model: 'claude-opus-5',
      baseUrl: null,
      apiKeyEnc: 'v1.x.y.z',
      createdBy: user,
    });
    expect((await automodRepo.getAiCredential(handle.db, guildId))?.model).toBe('claude-opus-5');

    await riskRepo.saveRisk(handle.db, {
      guildId,
      userId: user,
      score: 12.5,
      lastStepThreshold: 10,
      lastViolationAt: new Date(),
    });
    await riskRepo.saveRisk(handle.db, {
      guildId,
      userId: user,
      score: 30,
      lastStepThreshold: 25,
      lastViolationAt: new Date(),
    });
    expect((await riskRepo.getRisk(handle.db, guildId, user))?.score).toBe(30);
    expect((await riskRepo.topRisk(handle.db, guildId)).length).toBe(1);
  });

  it('mirrors bans', async () => {
    const guildId = fakeId();
    const a = fakeId();
    const b = fakeId();
    await banRepo.recordBan(handle.db, { guildId, userId: a, reason: 'spam', moderatorId: null });
    expect(await banRepo.bannedAmong(handle.db, guildId, [a, b])).toEqual([a]);
    await banRepo.replaceGuildBans(handle.db, guildId, [{ userId: b, reason: null }]);
    expect(await banRepo.bannedAmong(handle.db, guildId, [a, b])).toEqual([b]);
    await banRepo.removeBan(handle.db, guildId, b);
    expect(await banRepo.bannedAmong(handle.db, guildId, [a, b])).toEqual([]);
  });
});
