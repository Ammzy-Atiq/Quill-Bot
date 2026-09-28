import type { CaseSource, CaseType, CustomWordMatchMode } from '@quill/shared';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, snowflake, updatedAt } from './columns.js';

/** Every moderation action (manual or automatic) becomes a numbered case. */
export const cases = pgTable(
  'cases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    /** Per-guild sequential number (#1, #2, ...), from guild_counters key `case`. */
    caseNumber: integer('case_number').notNull(),
    userId: snowflake('user_id').notNull(),
    /** Null = QUILL acted automatically. */
    moderatorId: snowflake('moderator_id'),
    source: varchar('source', { length: 16 }).notNull().$type<CaseSource>(),
    type: varchar('type', { length: 16 }).notNull().$type<CaseType>(),
    reason: text('reason').notNull().default(''),
    /** Detector evidence, matched terms, risk score, etc. */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    points: real('points').notNull().default(0),
    durationSeconds: integer('duration_seconds'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Warns expire / bans get lifted → inactive. */
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cases_guild_number_unique').on(t.guildId, t.caseNumber),
    index('cases_guild_user_idx').on(t.guildId, t.userId, t.createdAt),
  ],
);

/** Current (decaying) risk score per member. Hot copy lives in Redis. */
export const riskScores = pgTable(
  'risk_scores',
  {
    guildId: snowflake('guild_id').notNull(),
    userId: snowflake('user_id').notNull(),
    score: real('score').notNull().default(0),
    /** Highest ladder threshold already applied (prevents re-applying the same step). */
    lastStepThreshold: real('last_step_threshold').notNull().default(0),
    lastViolationAt: timestamp('last_violation_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

/** Server-specific words on top of the built-in lists. */
export const customWords = pgTable(
  'custom_words',
  {
    id: serial('id').primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    term: varchar('term', { length: 200 }).notNull(),
    match: varchar('match', { length: 16 }).notNull().$type<CustomWordMatchMode>(),
    severity: smallint('severity').notNull().default(3),
    createdBy: snowflake('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('custom_words_unique').on(t.guildId, t.term)],
);

/** Server policies: custom rules with their own trigger, severity and action (see core CustomPolicy). */
export const customPolicies = pgTable(
  'custom_policies',
  {
    id: serial('id').primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    createdBy: snowflake('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('custom_policies_unique').on(t.guildId, t.name)],
);

/** Mirror of Discord bans (all bots/mods), used for ban-evasion checks by the website. */
export const guildBans = pgTable(
  'guild_bans',
  {
    guildId: snowflake('guild_id').notNull(),
    userId: snowflake('user_id').notNull(),
    reason: text('reason'),
    moderatorId: snowflake('moderator_id'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] }), index('guild_bans_user_idx').on(t.userId)],
);

/** Encrypted bring-your-own AI provider key per guild. */
export const aiCredentials = pgTable('ai_credentials', {
  guildId: snowflake('guild_id').primaryKey(),
  provider: varchar('provider', { length: 32 }).notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  baseUrl: text('base_url'),
  /** AES-256-GCM payload from @quill/shared encryptSecret. Never log or display. */
  apiKeyEnc: text('api_key_enc').notNull(),
  createdBy: snowflake('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Known scam domains (built-in seed + staff reports). */
export const scamDomains = pgTable('scam_domains', {
  domain: varchar('domain', { length: 253 }).primaryKey(),
  source: varchar('source', { length: 16 }).notNull().default('builtin'),
  addedBy: snowflake('added_by'),
  createdAt: createdAt(),
});

/** Perceptual (dHash) hashes of known scam images. guildId null = global list. */
export const scamImageHashes = pgTable(
  'scam_image_hashes',
  {
    id: serial('id').primaryKey(),
    hash: varchar('hash', { length: 16 }).notNull(),
    label: varchar('label', { length: 100 }).notNull().default('scam image'),
    guildId: snowflake('guild_id'),
    addedBy: snowflake('added_by'),
    createdAt: createdAt(),
  },
  (t) => [index('scam_image_hash_idx').on(t.hash)],
);
