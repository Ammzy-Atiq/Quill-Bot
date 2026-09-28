import type { CaseSource, CaseType } from '@quill/shared';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { cases } from '../schema/index.js';
import { nextCounter } from './guilds.js';

export type CaseRow = typeof cases.$inferSelect;

export interface NewCase {
  guildId: string;
  userId: string;
  moderatorId: string | null;
  source: CaseSource;
  type: CaseType;
  reason: string;
  details?: Record<string, unknown>;
  points?: number;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
}

export async function createCase(db: Database, input: NewCase): Promise<CaseRow> {
  const caseNumber = await nextCounter(db, input.guildId, 'case');
  const [row] = await db
    .insert(cases)
    .values({
      guildId: input.guildId,
      caseNumber,
      userId: input.userId,
      moderatorId: input.moderatorId,
      source: input.source,
      type: input.type,
      reason: input.reason.slice(0, 1000),
      details: input.details ?? {},
      points: input.points ?? 0,
      durationSeconds: input.durationSeconds ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  return row!;
}

export async function getCase(
  db: Database,
  guildId: string,
  caseNumber: number,
): Promise<CaseRow | undefined> {
  return db.query.cases.findFirst({
    where: and(eq(cases.guildId, guildId), eq(cases.caseNumber, caseNumber)),
  });
}

export async function listUserCases(
  db: Database,
  guildId: string,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<CaseRow[]> {
  return db
    .select()
    .from(cases)
    .where(and(eq(cases.guildId, guildId), eq(cases.userId, userId)))
    .orderBy(desc(cases.createdAt))
    .limit(opts.limit ?? 10)
    .offset(opts.offset ?? 0);
}

export async function countUserCases(db: Database, guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cases)
    .where(and(eq(cases.guildId, guildId), eq(cases.userId, userId)));
  return row?.count ?? 0;
}

/** Active (non-expired) warnings of a member. */
export async function countActiveWarnings(db: Database, guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cases)
    .where(
      and(
        eq(cases.guildId, guildId),
        eq(cases.userId, userId),
        eq(cases.type, 'warn'),
        eq(cases.active, true),
        or(isNull(cases.expiresAt), gt(cases.expiresAt, new Date())),
      ),
    );
  return row?.count ?? 0;
}

export async function updateCaseReason(
  db: Database,
  guildId: string,
  caseNumber: number,
  reason: string,
): Promise<CaseRow | undefined> {
  const [row] = await db
    .update(cases)
    .set({ reason: reason.slice(0, 1000) })
    .where(and(eq(cases.guildId, guildId), eq(cases.caseNumber, caseNumber)))
    .returning();
  return row;
}

export async function deactivateCase(db: Database, guildId: string, caseNumber: number): Promise<boolean> {
  const rows = await db
    .update(cases)
    .set({ active: false })
    .where(and(eq(cases.guildId, guildId), eq(cases.caseNumber, caseNumber)))
    .returning({ id: cases.id });
  return rows.length > 0;
}

/** Deactivates active cases of a type for a member (e.g. `ban` after an unban). */
export async function deactivateUserCases(db: Database, guildId: string, userId: string, type: CaseType) {
  await db
    .update(cases)
    .set({ active: false })
    .where(
      and(eq(cases.guildId, guildId), eq(cases.userId, userId), eq(cases.type, type), eq(cases.active, true)),
    );
}
