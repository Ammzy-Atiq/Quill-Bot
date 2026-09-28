import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, snowflake, updatedAt } from './columns.js';

/**
 * One verification attempt. Created by the website when a valid token is opened
 * (see @quill/shared signVerificationToken), completed after OAuth + fingerprint.
 */
export const verificationSessions = pgTable(
  'verification_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: snowflake('guild_id').notNull(),
    userId: snowflake('user_id').notNull(),
    /** Token nonce — a token can only be used once. */
    nonce: varchar('nonce', { length: 64 }).notNull().unique(),
    status: varchar('status', { length: 16 })
      .notNull()
      .default('pending')
      .$type<'pending' | 'completed' | 'expired' | 'failed'>(),
    verdict: varchar('verdict', { length: 8 }).$type<'pass' | 'flag' | 'block'>(),
    confidence: real('confidence'),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    linkedUserIds: jsonb('linked_user_ids').$type<string[]>().notNull().default([]),
    backupConsent: boolean('backup_consent').notNull().default(false),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('verification_sessions_guild_user_idx').on(t.guildId, t.userId)],
);

/** Verification status of a member in a guild. */
export const guildVerifications = pgTable(
  'guild_verifications',
  {
    guildId: snowflake('guild_id').notNull(),
    userId: snowflake('user_id').notNull(),
    status: varchar('status', { length: 16 })
      .notNull()
      .$type<'verified' | 'flagged' | 'denied' | 'revoked'>(),
    method: varchar('method', { length: 16 }).notNull().$type<'oauth' | 'simple' | 'sso' | 'manual'>(),
    sessionId: uuid('session_id'),
    reviewedBy: snowflake('reviewed_by'),
    /** Member agreed to be re-added to this guild's backup servers (guilds.join). */
    backupConsent: boolean('backup_consent').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] }), index('guild_verifications_user_idx').on(t.userId)],
);

/** Global QUILL identity (enables SSO: verify once, trusted everywhere that opts in). */
export const verifiedIdentities = pgTable('verified_identities', {
  userId: snowflake('user_id').primaryKey(),
  firstVerifiedAt: timestamp('first_verified_at', { withTimezone: true }).notNull().defaultNow(),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
  verificationCount: integer('verification_count').notNull().default(1),
  /** Users sharing a cluster are the same person with high confidence. */
  clusterId: uuid('cluster_id'),
  flags: jsonb('flags').$type<Record<string, unknown>>().notNull().default({}),
});

/**
 * Device/network fingerprints. PRIVACY: never store raw IPs — only HMAC hashes
 * (`hmacHash(ip, HASH_PEPPER)`) and coarse, non-identifying signals.
 */
export const fingerprints = pgTable(
  'fingerprints',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: snowflake('user_id').notNull(),
    ipHash: varchar('ip_hash', { length: 64 }).notNull(),
    ipPrefixHash: varchar('ip_prefix_hash', { length: 64 }).notNull(),
    deviceHash: varchar('device_hash', { length: 64 }).notNull(),
    /** Coarse signals: timezone, language, platform, screen bucket, browser family. */
    signals: jsonb('signals').$type<Record<string, string | number | boolean>>().notNull().default({}),
    asn: integer('asn'),
    country: varchar('country', { length: 2 }),
    isProxy: boolean('is_proxy').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('fingerprints_user_idx').on(t.userId),
    index('fingerprints_ip_idx').on(t.ipHash),
    index('fingerprints_device_idx').on(t.deviceHash),
    index('fingerprints_prefix_idx').on(t.ipPrefixHash),
  ],
);

/** Alt-account graph: two accounts linked by shared fingerprint signals. userA < userB. */
export const identityLinks = pgTable(
  'identity_links',
  {
    userA: snowflake('user_a').notNull(),
    userB: snowflake('user_b').notNull(),
    confidence: real('confidence').notNull(),
    signals: text('signals').array().notNull().default(sql`'{}'::text[]`),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userA, t.userB] }), index('identity_links_b_idx').on(t.userB)],
);

/** Discord OAuth grants (identify + guilds.join). Tokens are AES-256-GCM encrypted. */
export const oauthGrants = pgTable('oauth_grants', {
  userId: snowflake('user_id').primaryKey(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
