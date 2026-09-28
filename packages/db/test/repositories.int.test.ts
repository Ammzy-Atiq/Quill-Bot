/**
 * Integration tests against a real Postgres. Skipped unless TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgres://quill:quill@localhost:5432/quill_test pnpm test
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import * as caseRepo from '../src/repositories/cases.js';
import * as guildRepo from '../src/repositories/guilds.js';
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
});
