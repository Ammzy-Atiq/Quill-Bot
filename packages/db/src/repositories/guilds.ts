import type { GuildConfigInput } from '@quill/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { configAudit, guildCounters, guildSettings, guilds } from '../schema/index.js';

export interface GuildInfo {
  id: string;
  name: string;
  ownerId: string;
  memberCount: number;
}

export async function upsertGuild(db: Database, guild: GuildInfo): Promise<void> {
  await db
    .insert(guilds)
    .values({ ...guild, leftAt: null })
    .onConflictDoUpdate({
      target: guilds.id,
      set: { name: guild.name, ownerId: guild.ownerId, memberCount: guild.memberCount, leftAt: null },
    });
}

export async function markGuildLeft(db: Database, guildId: string): Promise<void> {
  await db.update(guilds).set({ leftAt: new Date() }).where(eq(guilds.id, guildId));
}

export interface StoredSettings {
  config: GuildConfigInput;
  version: number;
}

/** Returns the SPARSE stored config (expand with parseGuildConfig). */
export async function getGuildSettings(db: Database, guildId: string): Promise<StoredSettings> {
  const row = await db.query.guildSettings.findFirst({ where: eq(guildSettings.guildId, guildId) });
  return row ? { config: row.config, version: row.version } : { config: {}, version: 0 };
}

export class ConfigVersionConflictError extends Error {
  constructor() {
    super('The configuration was changed by someone else. Reload and try again.');
  }
}

/**
 * Saves a sparse config with optimistic concurrency: pass the version you read.
 * Returns the new version. Throws ConfigVersionConflictError on a concurrent write.
 */
export async function saveGuildSettings(
  db: Database,
  input: { guildId: string; config: GuildConfigInput; expectedVersion: number; updatedBy: string },
): Promise<number> {
  if (input.expectedVersion === 0) {
    const inserted = await db
      .insert(guildSettings)
      .values({ guildId: input.guildId, config: input.config, version: 1, updatedBy: input.updatedBy })
      .onConflictDoNothing()
      .returning({ version: guildSettings.version });
    if (inserted[0]) return inserted[0].version;
    throw new ConfigVersionConflictError();
  }
  const updated = await db
    .update(guildSettings)
    .set({ config: input.config, version: sql`${guildSettings.version} + 1`, updatedBy: input.updatedBy })
    .where(and(eq(guildSettings.guildId, input.guildId), eq(guildSettings.version, input.expectedVersion)))
    .returning({ version: guildSettings.version });
  if (!updated[0]) throw new ConfigVersionConflictError();
  return updated[0].version;
}

/** Atomically increments and returns a per-guild counter (e.g. `case`, `incident`). */
export async function nextCounter(db: Database, guildId: string, key: string): Promise<number> {
  const rows = await db
    .insert(guildCounters)
    .values({ guildId, key, value: 1 })
    .onConflictDoUpdate({
      target: [guildCounters.guildId, guildCounters.key],
      set: { value: sql`${guildCounters.value} + 1` },
    })
    .returning({ value: guildCounters.value });
  return rows[0]!.value;
}

export async function recordConfigChange(
  db: Database,
  entry: {
    guildId: string;
    userId: string;
    source: 'bot' | 'dashboard';
    path: string;
    oldValue: unknown;
    newValue: unknown;
  },
): Promise<void> {
  await db.insert(configAudit).values({
    ...entry,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
  });
}
