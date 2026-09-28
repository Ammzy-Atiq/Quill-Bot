import { and, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  cases,
  fingerprints,
  guildBans,
  guildSettings,
  guildVerifications,
  identityLinks,
  oauthGrants,
  verificationSessions,
  verifiedIdentities,
} from '../schema/index.js';

/**
 * Verification data shared by the website (OAuth flow, fingerprints, alt graph) and the bot
 * (reviews, SSO, simple mode, member backups). Privacy: fingerprints hold HMAC hashes only and
 * OAuth tokens arrive here already encrypted (`encryptSecret`).
 */

export type SessionRow = typeof verificationSessions.$inferSelect;
export type GuildVerificationRow = typeof guildVerifications.$inferSelect;
export type VerifiedIdentityRow = typeof verifiedIdentities.$inferSelect;
export type FingerprintRow = typeof fingerprints.$inferSelect;
export type OAuthGrantRow = typeof oauthGrants.$inferSelect;

export type Verdict = 'pass' | 'flag' | 'block';
export type GuildVerificationStatus = GuildVerificationRow['status'];
export type VerificationMethod = GuildVerificationRow['method'];
export type LinkSignal = 'device' | 'ip' | 'ip_prefix';

const DAY = 86_400_000;

// ── sessions ─────────────────────────────────────────────────────────────────

/** Creates a session for a verification token. Returns null when the token nonce was already used. */
export async function createSession(
  db: Database,
  input: { guildId: string; userId: string; nonce: string; expiresAt: Date },
): Promise<SessionRow | null> {
  const [row] = await db
    .insert(verificationSessions)
    .values(input)
    .onConflictDoNothing({ target: verificationSessions.nonce })
    .returning();
  return row ?? null;
}

export async function getSession(db: Database, id: string): Promise<SessionRow | undefined> {
  return db.query.verificationSessions.findFirst({ where: eq(verificationSessions.id, id) });
}

/** Completes a pending session. Returns false when it was not pending (already used / failed). */
export async function completeSession(
  db: Database,
  id: string,
  result: {
    verdict: Verdict;
    confidence: number;
    reasons: string[];
    linkedUserIds: string[];
    backupConsent: boolean;
  },
): Promise<boolean> {
  const rows = await db
    .update(verificationSessions)
    .set({ ...result, status: 'completed', completedAt: new Date() })
    .where(and(eq(verificationSessions.id, id), eq(verificationSessions.status, 'pending')))
    .returning({ id: verificationSessions.id });
  return rows.length > 0;
}

export async function failSession(db: Database, id: string, status: 'expired' | 'failed'): Promise<boolean> {
  const rows = await db
    .update(verificationSessions)
    .set({ status })
    .where(and(eq(verificationSessions.id, id), eq(verificationSessions.status, 'pending')))
    .returning({ id: verificationSessions.id });
  return rows.length > 0;
}

// ── OAuth grants ─────────────────────────────────────────────────────────────

/** Stores (or replaces) a user's encrypted OAuth grant; clears a previous revocation. */
export async function upsertOAuthGrant(
  db: Database,
  input: {
    userId: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    scopes: string[];
    expiresAt: Date;
  },
): Promise<void> {
  await db
    .insert(oauthGrants)
    .values(input)
    .onConflictDoUpdate({
      target: oauthGrants.userId,
      set: {
        accessTokenEnc: input.accessTokenEnc,
        refreshTokenEnc: input.refreshTokenEnc,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        revokedAt: null,
        updatedAt: new Date(),
      },
    });
}

export async function getOAuthGrant(db: Database, userId: string): Promise<OAuthGrantRow | undefined> {
  return db.query.oauthGrants.findFirst({ where: eq(oauthGrants.userId, userId) });
}

// ── fingerprints & alt graph ─────────────────────────────────────────────────

export async function insertFingerprint(
  db: Database,
  input: {
    userId: string;
    ipHash: string;
    ipPrefixHash: string;
    deviceHash: string;
    signals: Record<string, string | number | boolean>;
    asn: number | null;
    country: string | null;
    isProxy: boolean;
  },
): Promise<FingerprintRow> {
  const [row] = await db.insert(fingerprints).values(input).returning();
  return row!;
}

export interface LinkCandidate {
  userId: string;
  signals: LinkSignal[];
  lastSeenAt: Date;
  /** One of the matching fingerprints came through a VPN / proxy. */
  viaProxy: boolean;
}

/**
 * Other accounts that shared this device, IP or network in the last `sinceDays` days.
 * Score each with `scoreIdentityLink(signals, …)` from `@quill/core`; prefix-only matches are weak
 * on their own (shared networks) — only store links that reach a meaningful confidence.
 */
export async function findLinkCandidates(
  db: Database,
  input: { userId: string; ipHash: string; ipPrefixHash: string; deviceHash: string; sinceDays: number },
): Promise<LinkCandidate[]> {
  const rows = await db
    .select({
      userId: fingerprints.userId,
      ipHash: fingerprints.ipHash,
      ipPrefixHash: fingerprints.ipPrefixHash,
      deviceHash: fingerprints.deviceHash,
      isProxy: fingerprints.isProxy,
      createdAt: fingerprints.createdAt,
    })
    .from(fingerprints)
    .where(
      and(
        ne(fingerprints.userId, input.userId),
        gt(fingerprints.createdAt, new Date(Date.now() - input.sinceDays * DAY)),
        or(
          eq(fingerprints.deviceHash, input.deviceHash),
          eq(fingerprints.ipHash, input.ipHash),
          eq(fingerprints.ipPrefixHash, input.ipPrefixHash),
        ),
      ),
    )
    .orderBy(desc(fingerprints.createdAt))
    .limit(500);

  const byUser = new Map<string, { signals: Set<LinkSignal>; lastSeenAt: Date; viaProxy: boolean }>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {
      signals: new Set<LinkSignal>(),
      lastSeenAt: row.createdAt,
      viaProxy: false,
    };
    if (row.deviceHash === input.deviceHash) entry.signals.add('device');
    if (row.ipHash === input.ipHash) entry.signals.add('ip');
    if (row.ipPrefixHash === input.ipPrefixHash) entry.signals.add('ip_prefix');
    if (row.createdAt > entry.lastSeenAt) entry.lastSeenAt = row.createdAt;
    entry.viaProxy ||= row.isProxy;
    byUser.set(row.userId, entry);
  }
  const strength = (s: Set<LinkSignal>) =>
    (s.has('device') ? 4 : 0) + (s.has('ip') ? 2 : 0) + (s.has('ip_prefix') ? 1 : 0);
  return [...byUser.entries()]
    .sort((a, b) => strength(b[1].signals) - strength(a[1].signals))
    .map(([userId, e]) => ({
      userId,
      signals: [...e.signals],
      lastSeenAt: e.lastSeenAt,
      viaProxy: e.viaProxy,
    }));
}

/** Records a link between two accounts (pair ordered automatically); keeps the strongest evidence. */
export async function upsertIdentityLink(
  db: Database,
  userX: string,
  userY: string,
  confidence: number,
  signals: readonly string[],
): Promise<void> {
  if (userX === userY) return;
  const [userA, userB] = userX < userY ? [userX, userY] : [userY, userX];
  await db
    .insert(identityLinks)
    .values({ userA, userB, confidence, signals: [...signals] })
    .onConflictDoUpdate({
      target: [identityLinks.userA, identityLinks.userB],
      set: {
        confidence: sql`greatest(${identityLinks.confidence}, excluded.confidence)`,
        signals: sql`array(select distinct unnest(${identityLinks.signals} || excluded.signals))`,
        lastSeenAt: new Date(),
      },
    });
}

/** All accounts linked to a user (either side of the pair), strongest first. */
export async function linkedAccounts(
  db: Database,
  userId: string,
  minConfidence = 0,
): Promise<Array<{ userId: string; confidence: number; signals: string[]; lastSeenAt: Date }>> {
  const rows = await db
    .select()
    .from(identityLinks)
    .where(
      and(
        or(eq(identityLinks.userA, userId), eq(identityLinks.userB, userId)),
        sql`${identityLinks.confidence} >= ${minConfidence}`,
      ),
    )
    .orderBy(desc(identityLinks.confidence))
    .limit(100);
  return rows.map((r) => ({
    userId: r.userA === userId ? r.userB : r.userA,
    confidence: r.confidence,
    signals: r.signals,
    lastSeenAt: r.lastSeenAt,
  }));
}

// ── standing (ban / punishment evasion) ──────────────────────────────────────

const PUNISHMENT_TYPES = ['ban', 'softban', 'kick', 'timeout', 'quarantine'] as const;

/**
 * Standing of accounts in one guild: banned (mirror of Discord bans) and punished (an active
 * ban/softban/kick/timeout/quarantine case in the last `punishedDays` days, default 30).
 */
export async function standingInGuild(
  db: Database,
  guildId: string,
  userIds: readonly string[],
  punishedDays = 30,
): Promise<Map<string, { banned: boolean; punished: boolean }>> {
  const out = new Map(userIds.map((id) => [id, { banned: false, punished: false }]));
  if (userIds.length === 0) return out;
  const ids = [...userIds];
  const [bans, punished] = await Promise.all([
    db
      .select({ userId: guildBans.userId })
      .from(guildBans)
      .where(and(eq(guildBans.guildId, guildId), inArray(guildBans.userId, ids))),
    db
      .selectDistinct({ userId: cases.userId })
      .from(cases)
      .where(
        and(
          eq(cases.guildId, guildId),
          inArray(cases.userId, ids),
          inArray(cases.type, [...PUNISHMENT_TYPES]),
          eq(cases.active, true),
          gt(cases.createdAt, new Date(Date.now() - punishedDays * DAY)),
        ),
      ),
  ]);
  for (const { userId } of bans) out.get(userId)!.banned = true;
  for (const { userId } of punished) out.get(userId)!.punished = true;
  return out;
}

/**
 * Bans of these accounts in OTHER guilds that opted into signal sharing
 * (`verification.network.shareSignals`). Only use when the verifying guild opted in too.
 */
export async function networkBanCounts(
  db: Database,
  userIds: readonly string[],
  excludeGuildId: string,
): Promise<Map<string, number>> {
  const out = new Map(userIds.map((id) => [id, 0]));
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: guildBans.userId, count: sql<number>`count(*)::int` })
    .from(guildBans)
    .innerJoin(guildSettings, eq(guildSettings.guildId, guildBans.guildId))
    .where(
      and(
        inArray(guildBans.userId, [...userIds]),
        ne(guildBans.guildId, excludeGuildId),
        sql`(${guildSettings.config} -> 'verification' -> 'network' ->> 'shareSignals') = 'true'`,
      ),
    )
    .groupBy(guildBans.userId);
  for (const row of rows) out.set(row.userId, row.count);
  return out;
}

// ── guild verification status & global identity ─────────────────────────────

export async function setGuildVerification(
  db: Database,
  input: {
    guildId: string;
    userId: string;
    status: GuildVerificationStatus;
    method: VerificationMethod;
    sessionId?: string | null;
    reviewedBy?: string | null;
    backupConsent?: boolean;
  },
): Promise<void> {
  const values = {
    guildId: input.guildId,
    userId: input.userId,
    status: input.status,
    method: input.method,
    sessionId: input.sessionId ?? null,
    reviewedBy: input.reviewedBy ?? null,
    backupConsent: input.backupConsent ?? false,
  };
  await db
    .insert(guildVerifications)
    .values(values)
    .onConflictDoUpdate({
      target: [guildVerifications.guildId, guildVerifications.userId],
      set: {
        status: values.status,
        method: values.method,
        // Keep earlier values unless this write provides them.
        ...(input.sessionId !== undefined ? { sessionId: values.sessionId } : {}),
        ...(input.reviewedBy !== undefined ? { reviewedBy: values.reviewedBy } : {}),
        ...(input.backupConsent !== undefined ? { backupConsent: values.backupConsent } : {}),
        ...(input.status === 'verified' ? { verifiedAt: new Date() } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function getGuildVerification(
  db: Database,
  guildId: string,
  userId: string,
): Promise<GuildVerificationRow | undefined> {
  return db.query.guildVerifications.findFirst({
    where: and(eq(guildVerifications.guildId, guildId), eq(guildVerifications.userId, userId)),
  });
}

/** Flagged members waiting for a staff review (newest first) with their latest session. */
export async function listFlagged(db: Database, guildId: string, limit = 25) {
  return db
    .select({ verification: guildVerifications, session: verificationSessions })
    .from(guildVerifications)
    .leftJoin(verificationSessions, eq(verificationSessions.id, guildVerifications.sessionId))
    .where(and(eq(guildVerifications.guildId, guildId), eq(guildVerifications.status, 'flagged')))
    .orderBy(desc(guildVerifications.updatedAt))
    .limit(limit);
}

/** Verified members who consented to being re-added to this guild's backup servers. */
export async function backupConsentingUserIds(db: Database, guildId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: guildVerifications.userId })
    .from(guildVerifications)
    .where(
      and(
        eq(guildVerifications.guildId, guildId),
        eq(guildVerifications.status, 'verified'),
        eq(guildVerifications.backupConsent, true),
      ),
    );
  return rows.map((r) => r.userId);
}

/** Bumps the global QUILL identity after a passed verification (enables SSO). */
export async function touchVerifiedIdentity(db: Database, userId: string): Promise<void> {
  await db
    .insert(verifiedIdentities)
    .values({ userId })
    .onConflictDoUpdate({
      target: verifiedIdentities.userId,
      set: {
        lastVerifiedAt: new Date(),
        verificationCount: sql`${verifiedIdentities.verificationCount} + 1`,
      },
    });
}

export async function getVerifiedIdentity(
  db: Database,
  userId: string,
): Promise<VerifiedIdentityRow | undefined> {
  return db.query.verifiedIdentities.findFirst({ where: eq(verifiedIdentities.userId, userId) });
}

// ── data deletion ────────────────────────────────────────────────────────────

export interface DeletionCounts {
  fingerprints: number;
  identityLinks: number;
  oauthGrants: number;
  verifiedIdentities: number;
  sessions: number;
  guildVerificationsRevoked: number;
}

/**
 * Deletes a user's verification data (website `/data`, bot `/data delete`). Revoke the OAuth token
 * at Discord first (read it with `getOAuthGrant`). Cases and bans are server moderation records and stay.
 */
export async function deleteUserData(db: Database, userId: string): Promise<DeletionCounts> {
  return db.transaction(async (tx) => {
    const prints = await tx
      .delete(fingerprints)
      .where(eq(fingerprints.userId, userId))
      .returning({ id: fingerprints.id });
    const links = await tx
      .delete(identityLinks)
      .where(or(eq(identityLinks.userA, userId), eq(identityLinks.userB, userId)))
      .returning({ a: identityLinks.userA });
    const grants = await tx
      .delete(oauthGrants)
      .where(eq(oauthGrants.userId, userId))
      .returning({ id: oauthGrants.userId });
    const identities = await tx
      .delete(verifiedIdentities)
      .where(eq(verifiedIdentities.userId, userId))
      .returning({ id: verifiedIdentities.userId });
    const sessions = await tx
      .delete(verificationSessions)
      .where(eq(verificationSessions.userId, userId))
      .returning({ id: verificationSessions.id });
    const revoked = await tx
      .update(guildVerifications)
      .set({ status: 'revoked', sessionId: null, backupConsent: false, updatedAt: new Date() })
      .where(eq(guildVerifications.userId, userId))
      .returning({ guildId: guildVerifications.guildId });
    return {
      fingerprints: prints.length,
      identityLinks: links.length,
      oauthGrants: grants.length,
      verifiedIdentities: identities.length,
      sessions: sessions.length,
      guildVerificationsRevoked: revoked.length,
    };
  });
}
