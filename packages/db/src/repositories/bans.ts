import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../client.js';
import { guildBans } from '../schema/index.js';

/** Mirror of Discord bans — used by the website's ban-evasion checks. */
export async function recordBan(
  db: Database,
  input: { guildId: string; userId: string; reason: string | null; moderatorId: string | null },
): Promise<void> {
  await db
    .insert(guildBans)
    .values(input)
    .onConflictDoUpdate({
      target: [guildBans.guildId, guildBans.userId],
      set: { reason: input.reason, moderatorId: input.moderatorId },
    });
}

export async function removeBan(db: Database, guildId: string, userId: string): Promise<void> {
  await db.delete(guildBans).where(and(eq(guildBans.guildId, guildId), eq(guildBans.userId, userId)));
}

export async function bannedAmong(db: Database, guildId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: guildBans.userId })
    .from(guildBans)
    .where(and(eq(guildBans.guildId, guildId), inArray(guildBans.userId, userIds)));
  return rows.map((r) => r.userId);
}

/** Replaces the mirror for a guild (initial sync after joining). */
export async function replaceGuildBans(
  db: Database,
  guildId: string,
  bans: Array<{ userId: string; reason: string | null }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(guildBans).where(eq(guildBans.guildId, guildId));
    for (let i = 0; i < bans.length; i += 500) {
      const chunk = bans
        .slice(i, i + 500)
        .map((b) => ({ guildId, userId: b.userId, reason: b.reason, moderatorId: null }));
      if (chunk.length > 0) await tx.insert(guildBans).values(chunk).onConflictDoNothing();
    }
  });
}
