import type { GuildConfigInput } from '@quill/shared';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, snowflake, updatedAt } from './columns.js';

/** Every guild QUILL has joined (rows are kept after leaving; purged by retention). */
export const guilds = pgTable('guilds', {
  id: snowflake('id').primaryKey(),
  name: text('name').notNull().default(''),
  ownerId: snowflake('owner_id').notNull(),
  memberCount: integer('member_count').notNull().default(0),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Per-guild configuration, stored SPARSE (only overridden values).
 * Expand with `parseGuildConfig` from @quill/shared. `version` increments on every write
 * and is used for optimistic concurrency + cache invalidation.
 */
export const guildSettings = pgTable('guild_settings', {
  guildId: snowflake('guild_id').primaryKey(),
  config: jsonb('config').$type<GuildConfigInput>().notNull().default({}),
  version: integer('version').notNull().default(1),
  updatedBy: snowflake('updated_by'),
  updatedAt: updatedAt(),
});

/** Atomic per-guild counters (case numbers, incident numbers...). */
export const guildCounters = pgTable(
  'guild_counters',
  {
    guildId: snowflake('guild_id').notNull(),
    key: varchar('key', { length: 32 }).notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.key] })],
);

/** Who changed which setting (bot command or dashboard). */
export const configAudit = pgTable(
  'config_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    userId: snowflake('user_id').notNull(),
    source: varchar('source', { length: 16 }).notNull(),
    path: text('path').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    createdAt: createdAt(),
  },
  (t) => [index('config_audit_guild_idx').on(t.guildId, t.createdAt)],
);

/**
 * Anti-Nuke trust entries (Olympus-style):
 * - kind `extra_owner`: may configure anti-nuke & whitelist, exempt from anti-nuke.
 * - kind `whitelist`: exempt only for the listed `permissions` (AntiNukeAction keys).
 */
export const trustEntries = pgTable(
  'trust_entries',
  {
    id: serial('id').primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    userId: snowflake('user_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull().$type<'extra_owner' | 'whitelist'>(),
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    note: text('note'),
    addedBy: snowflake('added_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('trust_entries_unique').on(t.guildId, t.userId, t.kind)],
);
