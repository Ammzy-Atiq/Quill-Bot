import type { ThreatLevel } from '@quill/shared';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, snowflake, updatedAt } from './columns.js';

/** An attack/incident: security events grouped by actor + time. */
export const incidents = pgTable(
  'incidents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    incidentNumber: integer('incident_number').notNull(),
    actorId: snowflake('actor_id'),
    module: varchar('module', { length: 16 }).notNull().$type<'antinuke' | 'antiraid'>(),
    threatLevel: varchar('threat_level', { length: 16 }).notNull().$type<ThreatLevel>(),
    status: varchar('status', { length: 16 })
      .notNull()
      .default('open')
      .$type<'open' | 'contained' | 'resolved'>(),
    /** Aggregates: counts per action, punishments applied, reverts done. */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('incidents_guild_number_unique').on(t.guildId, t.incidentNumber),
    index('incidents_guild_idx').on(t.guildId, t.startedAt),
  ],
);

/** Every security-relevant event with actor, action, severity and the response taken. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    incidentId: bigint('incident_id', { mode: 'number' }),
    module: varchar('module', { length: 16 }).notNull(),
    action: varchar('action', { length: 48 }).notNull(),
    actorId: snowflake('actor_id'),
    targetId: snowflake('target_id'),
    severity: smallint('severity').notNull().default(1),
    /** owner | extra_owner | whitelisted | untrusted | self */
    trust: varchar('trust', { length: 16 }),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    response: jsonb('response').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('security_events_guild_idx').on(t.guildId, t.createdAt),
    index('security_events_incident_idx').on(t.incidentId),
  ],
);

/** Serialized guild structure (roles, channels, overwrites, settings) for recovery. */
export const snapshots = pgTable(
  'snapshots',
  {
    id: serial('id').primaryKey(),
    guildId: snowflake('guild_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull().$type<'auto' | 'manual' | 'pre_emergency'>(),
    label: varchar('label', { length: 100 }),
    createdBy: snowflake('created_by'),
    roleCount: integer('role_count').notNull().default(0),
    channelCount: integer('channel_count').notNull().default(0),
    sizeBytes: integer('size_bytes').notNull().default(0),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('snapshots_guild_idx').on(t.guildId, t.createdAt)],
);

/** Emergency mode state, including the permissions QUILL removed (to restore later). */
export const emergencyStates = pgTable('emergency_states', {
  guildId: snowflake('guild_id').primaryKey(),
  active: boolean('active').notNull().default(false),
  reason: text('reason'),
  triggeredBy: snowflake('triggered_by'),
  automatic: boolean('automatic').notNull().default(false),
  /** { roles: [{ id, permissions }], channels: [{ id, overwrites }], invitesPaused } */
  previous: jsonb('previous').$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Backup servers registered by an owner for `guilds.join` member recovery. */
export const backupServers = pgTable(
  'backup_servers',
  {
    id: serial('id').primaryKey(),
    sourceGuildId: snowflake('source_guild_id').notNull(),
    targetGuildId: snowflake('target_guild_id').notNull(),
    ownerId: snowflake('owner_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('backup_servers_unique').on(t.sourceGuildId, t.targetGuildId)],
);

export const memberPullJobs = pgTable(
  'member_pull_jobs',
  {
    id: serial('id').primaryKey(),
    sourceGuildId: snowflake('source_guild_id').notNull(),
    targetGuildId: snowflake('target_guild_id').notNull(),
    requestedBy: snowflake('requested_by').notNull(),
    status: varchar('status', { length: 16 })
      .notNull()
      .default('queued')
      .$type<'queued' | 'running' | 'done' | 'failed'>(),
    total: integer('total').notNull().default(0),
    added: integer('added').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('member_pull_jobs_source_idx').on(t.sourceGuildId)],
);
