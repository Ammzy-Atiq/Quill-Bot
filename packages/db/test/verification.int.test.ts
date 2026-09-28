/**
 * Verification repository against a real Postgres. Skipped unless TEST_DATABASE_URL is set.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import * as banRepo from '../src/repositories/bans.js';
import * as caseRepo from '../src/repositories/cases.js';
import * as guildRepo from '../src/repositories/guilds.js';
import * as repo from '../src/repositories/verification.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const fakeId = () => String(10n ** 17n + BigInt(randomInt(1, 2 ** 47)));
const hash = () => randomBytes(32).toString('hex');

suite('verification repository (integration)', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, { max: 2 });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('sessions are single-use and complete once', async () => {
    const input = {
      guildId: fakeId(),
      userId: fakeId(),
      nonce: hash().slice(0, 16),
      expiresAt: new Date(Date.now() + 900_000),
    };
    const session = await repo.createSession(handle.db, input);
    expect(session?.status).toBe('pending');
    expect(await repo.createSession(handle.db, input)).toBeNull(); // reused token nonce

    const result = {
      verdict: 'pass' as const,
      confidence: 1,
      reasons: [],
      linkedUserIds: [],
      backupConsent: true,
    };
    expect(await repo.completeSession(handle.db, session!.id, result)).toBe(true);
    expect(await repo.completeSession(handle.db, session!.id, result)).toBe(false);
    expect(await repo.failSession(handle.db, session!.id, 'failed')).toBe(false);
    const stored = await repo.getSession(handle.db, session!.id);
    expect(stored).toMatchObject({ status: 'completed', verdict: 'pass', backupConsent: true });
    expect(stored?.completedAt).toBeInstanceOf(Date);
  });

  it('finds alts through shared device / network hashes and keeps the strongest link', async () => {
    const [main, alt, neighbour, stranger] = [fakeId(), fakeId(), fakeId(), fakeId()];
    const device = hash();
    const ip = hash();
    const prefix = hash();
    const base = { signals: {}, asn: 13335, country: 'DE', isProxy: false };
    await repo.insertFingerprint(handle.db, {
      ...base,
      userId: alt,
      ipHash: ip,
      ipPrefixHash: prefix,
      deviceHash: device,
    });
    await repo.insertFingerprint(handle.db, {
      ...base,
      userId: neighbour,
      ipHash: hash(),
      ipPrefixHash: prefix,
      deviceHash: hash(),
    });
    await repo.insertFingerprint(handle.db, {
      ...base,
      userId: stranger,
      ipHash: hash(),
      ipPrefixHash: hash(),
      deviceHash: hash(),
    });

    const candidates = await repo.findLinkCandidates(handle.db, {
      userId: main,
      ipHash: ip,
      ipPrefixHash: prefix,
      deviceHash: device,
      sinceDays: 180,
    });
    expect(candidates.map((c) => c.userId)).toEqual([alt, neighbour]); // strongest first, stranger excluded
    expect(candidates[0]?.signals.sort()).toEqual(['device', 'ip', 'ip_prefix']);
    expect(candidates[1]?.signals).toEqual(['ip_prefix']);

    await repo.upsertIdentityLink(handle.db, main, alt, 0.97, ['device', 'ip']);
    await repo.upsertIdentityLink(handle.db, alt, main, 0.4, ['ip_prefix']); // weaker, reversed pair
    const links = await repo.linkedAccounts(handle.db, main);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ userId: alt, confidence: 0.97 });
    expect([...links[0]!.signals].sort()).toEqual(['device', 'ip', 'ip_prefix']);
    expect((await repo.linkedAccounts(handle.db, alt))[0]?.userId).toBe(main);
  });

  it('reports standing in the guild and bans across opted-in servers', async () => {
    const guildId = fakeId();
    const otherGuild = fakeId();
    const privateGuild = fakeId();
    const [banned, timedOut, clean] = [fakeId(), fakeId(), fakeId()];
    await banRepo.recordBan(handle.db, { guildId, userId: banned, reason: 'raid', moderatorId: null });
    await caseRepo.createCase(handle.db, {
      guildId,
      userId: timedOut,
      moderatorId: null,
      source: 'automod',
      type: 'timeout',
      reason: 'spam',
    });
    const standing = await repo.standingInGuild(handle.db, guildId, [banned, timedOut, clean]);
    expect(standing.get(banned)).toEqual({ banned: true, punished: false });
    expect(standing.get(timedOut)).toEqual({ banned: false, punished: true });
    expect(standing.get(clean)).toEqual({ banned: false, punished: false });

    await guildRepo.saveGuildSettings(handle.db, {
      guildId: otherGuild,
      config: { verification: { network: { shareSignals: true } } },
      expectedVersion: 0,
      updatedBy: fakeId(),
    });
    await banRepo.recordBan(handle.db, {
      guildId: otherGuild,
      userId: clean,
      reason: null,
      moderatorId: null,
    });
    await banRepo.recordBan(handle.db, {
      guildId: privateGuild,
      userId: clean,
      reason: null,
      moderatorId: null,
    });
    const network = await repo.networkBanCounts(handle.db, [clean, banned], guildId);
    expect(network.get(clean)).toBe(1); // the private guild did not opt in
    expect(network.get(banned)).toBe(0);
  });

  it('tracks guild verification status, SSO identity, backup consent and flagged reviews', async () => {
    const guildId = fakeId();
    const [member, flagged] = [fakeId(), fakeId()];
    await repo.setGuildVerification(handle.db, {
      guildId,
      userId: member,
      status: 'verified',
      method: 'oauth',
      backupConsent: true,
    });
    await repo.setGuildVerification(handle.db, {
      guildId,
      userId: flagged,
      status: 'flagged',
      method: 'oauth',
    });
    expect(await repo.backupConsentingUserIds(handle.db, guildId)).toEqual([member]);
    expect((await repo.listFlagged(handle.db, guildId)).map((r) => r.verification.userId)).toEqual([flagged]);

    // A later status change without backupConsent keeps the earlier consent.
    await repo.setGuildVerification(handle.db, {
      guildId,
      userId: member,
      status: 'verified',
      method: 'sso',
    });
    expect(await repo.getGuildVerification(handle.db, guildId, member)).toMatchObject({
      method: 'sso',
      backupConsent: true,
    });

    await repo.touchVerifiedIdentity(handle.db, member);
    await repo.touchVerifiedIdentity(handle.db, member);
    expect((await repo.getVerifiedIdentity(handle.db, member))?.verificationCount).toBe(2);
  });

  it('deletes a user’s verification data and revokes their guild verifications', async () => {
    const userId = fakeId();
    const other = fakeId();
    const guildId = fakeId();
    await repo.insertFingerprint(handle.db, {
      userId,
      ipHash: hash(),
      ipPrefixHash: hash(),
      deviceHash: hash(),
      signals: { timezone: 'Europe/Istanbul' },
      asn: null,
      country: null,
      isProxy: false,
    });
    await repo.upsertIdentityLink(handle.db, userId, other, 0.9, ['device']);
    await repo.upsertOAuthGrant(handle.db, {
      userId,
      accessTokenEnc: 'v1.enc',
      refreshTokenEnc: 'v1.enc',
      scopes: ['identify', 'guilds.join'],
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await repo.touchVerifiedIdentity(handle.db, userId);
    await repo.createSession(handle.db, {
      guildId,
      userId,
      nonce: hash().slice(0, 16),
      expiresAt: new Date(),
    });
    await repo.setGuildVerification(handle.db, {
      guildId,
      userId,
      status: 'verified',
      method: 'oauth',
      backupConsent: true,
    });

    const counts = await repo.deleteUserData(handle.db, userId);
    expect(counts).toEqual({
      fingerprints: 1,
      identityLinks: 1,
      oauthGrants: 1,
      verifiedIdentities: 1,
      sessions: 1,
      guildVerificationsRevoked: 1,
    });
    expect(await repo.getOAuthGrant(handle.db, userId)).toBeUndefined();
    expect(await repo.getGuildVerification(handle.db, guildId, userId)).toMatchObject({
      status: 'revoked',
      backupConsent: false,
    });
  });
});
