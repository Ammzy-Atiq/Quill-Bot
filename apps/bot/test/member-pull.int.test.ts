/**
 * Worker member pull against a real Postgres with a fake Discord REST client.
 * Skipped unless TEST_DATABASE_URL is set.
 */
import { randomInt } from 'node:crypto';
import { createDb, type DbHandle, runMigrations, securityRepo, verificationRepo } from '@quill/db';
import { encryptSecret, parseEncryptionKey } from '@quill/shared';
import { Routes } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { createLogger } from '../src/logger.js';
import type { WorkerContext } from '../src/worker/jobs.js';
import { runMemberPull } from '../src/worker/member-pull.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const fakeId = () => String(10n ** 17n + BigInt(randomInt(1, 2 ** 47)));

suite('member pull (integration)', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, { max: 2 });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('re-adds consenting members with valid grants and reports progress', async () => {
    const env = loadEnv({ dryRun: true, source: { DATABASE_URL: url! } as NodeJS.ProcessEnv });
    const key = parseEncryptionKey(env.ENCRYPTION_KEY);
    const [source, target, owner] = [fakeId(), fakeId(), fakeId()];
    const [withGrant, noGrant, expired, noConsent] = [fakeId(), fakeId(), fakeId(), fakeId()];
    const db = handle.db;

    for (const userId of [withGrant, noGrant, expired]) {
      await verificationRepo.setGuildVerification(db, {
        guildId: source,
        userId,
        status: 'verified',
        method: 'oauth',
        backupConsent: true,
      });
    }
    await verificationRepo.setGuildVerification(db, {
      guildId: source,
      userId: noConsent,
      status: 'verified',
      method: 'oauth',
    });
    const grant = (token: string, expiresInMs: number) => ({
      accessTokenEnc: encryptSecret(token, key),
      refreshTokenEnc: encryptSecret(`refresh-${token}`, key),
      scopes: ['identify', 'guilds.join'],
      expiresAt: new Date(Date.now() + expiresInMs),
    });
    await verificationRepo.upsertOAuthGrant(db, { userId: withGrant, ...grant('token-a', 3_600_000) });
    await verificationRepo.upsertOAuthGrant(db, { userId: noConsent, ...grant('token-d', 3_600_000) });
    // Expired and no client secret configured → cannot refresh → skipped.
    await verificationRepo.upsertOAuthGrant(db, { userId: expired, ...grant('token-c', -60_000) });

    const job = await securityRepo.createPullJob(db, {
      sourceGuildId: source,
      targetGuildId: target,
      requestedBy: owner,
    });
    const puts: Array<{ route: string; body: unknown }> = [];
    const posts: string[] = [];
    const rest = {
      put: async (route: string, options: { body: unknown }) => {
        puts.push({ route, body: options.body });
        return { user: { id: route.split('/').pop() } };
      },
      post: async (route: string) => {
        posts.push(route);
        return route === Routes.userChannels() ? { id: 'dm-channel' } : {};
      },
    };
    const ctx = {
      env: { ...env, DISCORD_CLIENT_SECRET: undefined },
      logger: createLogger('error', false),
      db,
      rest,
      connection: null,
    } as unknown as WorkerContext;

    const counts = await runMemberPull(ctx, {
      jobId: job.id,
      sourceGuildId: source,
      targetGuildId: target,
      requestedBy: owner,
    });
    expect(counts).toEqual({ total: 3, added: 1, skipped: 2, failed: 0 });
    expect(puts).toEqual([
      { route: Routes.guildMember(target, withGrant), body: { access_token: 'token-a' } },
    ]);
    expect(posts).toEqual([Routes.userChannels(), Routes.channelMessages('dm-channel')]);
    expect(await securityRepo.getPullJob(db, job.id)).toMatchObject({
      status: 'done',
      total: 3,
      added: 1,
      skipped: 2,
    });
  });
});
