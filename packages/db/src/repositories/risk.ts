import { and, desc, eq, gt } from 'drizzle-orm';
import type { Database } from '../client.js';
import { riskScores } from '../schema/index.js';

export type RiskRow = typeof riskScores.$inferSelect;

export async function getRisk(db: Database, guildId: string, userId: string): Promise<RiskRow | undefined> {
  return db.query.riskScores.findFirst({
    where: and(eq(riskScores.guildId, guildId), eq(riskScores.userId, userId)),
  });
}

export async function saveRisk(
  db: Database,
  row: {
    guildId: string;
    userId: string;
    score: number;
    lastStepThreshold: number;
    lastViolationAt: Date | null;
  },
): Promise<void> {
  await db
    .insert(riskScores)
    .values(row)
    .onConflictDoUpdate({
      target: [riskScores.guildId, riskScores.userId],
      set: {
        score: row.score,
        lastStepThreshold: row.lastStepThreshold,
        lastViolationAt: row.lastViolationAt,
      },
    });
}

export async function deleteRisk(db: Database, guildId: string, userId: string): Promise<void> {
  await db.delete(riskScores).where(and(eq(riskScores.guildId, guildId), eq(riskScores.userId, userId)));
}

/** Highest stored scores (not decayed — callers decay with evaluateRisk/decayScore). */
export async function topRisk(db: Database, guildId: string, limit = 10): Promise<RiskRow[]> {
  return db
    .select()
    .from(riskScores)
    .where(and(eq(riskScores.guildId, guildId), gt(riskScores.score, 0)))
    .orderBy(desc(riskScores.score))
    .limit(limit);
}
