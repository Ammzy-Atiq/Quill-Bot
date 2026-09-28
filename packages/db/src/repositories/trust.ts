import type { AntiNukeAction } from '@quill/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { trustEntries } from '../schema/index.js';

export type TrustEntryRow = typeof trustEntries.$inferSelect;

export async function listTrustEntries(db: Database, guildId: string): Promise<TrustEntryRow[]> {
  return db.select().from(trustEntries).where(eq(trustEntries.guildId, guildId));
}

export async function upsertWhitelist(
  db: Database,
  input: {
    guildId: string;
    userId: string;
    permissions: AntiNukeAction[];
    addedBy: string;
    note?: string | null;
  },
): Promise<TrustEntryRow> {
  const [row] = await db
    .insert(trustEntries)
    .values({ ...input, kind: 'whitelist', note: input.note ?? null })
    .onConflictDoUpdate({
      target: [trustEntries.guildId, trustEntries.userId, trustEntries.kind],
      set: { permissions: input.permissions, addedBy: input.addedBy },
    })
    .returning();
  return row!;
}

export async function addExtraOwner(
  db: Database,
  input: { guildId: string; userId: string; addedBy: string },
): Promise<TrustEntryRow> {
  const [row] = await db
    .insert(trustEntries)
    .values({ ...input, kind: 'extra_owner', permissions: [] })
    .onConflictDoUpdate({
      target: [trustEntries.guildId, trustEntries.userId, trustEntries.kind],
      set: { addedBy: input.addedBy },
    })
    .returning();
  return row!;
}

export async function removeTrustEntry(
  db: Database,
  guildId: string,
  userId: string,
  kind: 'extra_owner' | 'whitelist',
): Promise<boolean> {
  const rows = await db
    .delete(trustEntries)
    .where(
      and(eq(trustEntries.guildId, guildId), eq(trustEntries.userId, userId), eq(trustEntries.kind, kind)),
    )
    .returning({ id: trustEntries.id });
  return rows.length > 0;
}

export async function clearWhitelist(db: Database, guildId: string): Promise<number> {
  const rows = await db
    .delete(trustEntries)
    .where(and(eq(trustEntries.guildId, guildId), eq(trustEntries.kind, 'whitelist')))
    .returning({ id: trustEntries.id });
  return rows.length;
}
