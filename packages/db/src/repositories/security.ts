import type { ThreatLevel } from '@quill/shared';
import { and, desc, eq, lt, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  backupServers,
  emergencyStates,
  incidents,
  memberPullJobs,
  securityEvents,
  snapshots,
} from '../schema/index.js';
import { nextCounter } from './guilds.js';

export type IncidentRow = typeof incidents.$inferSelect;
export type SecurityEventRow = typeof securityEvents.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type EmergencyRow = typeof emergencyStates.$inferSelect;
export type BackupServerRow = typeof backupServers.$inferSelect;
export type PullJobRow = typeof memberPullJobs.$inferSelect;

// ── incidents ────────────────────────────────────────────────────────────────
export async function openIncident(
  db: Database,
  input: {
    guildId: string;
    actorId: string | null;
    module: 'antinuke' | 'antiraid';
    threatLevel: ThreatLevel;
  },
): Promise<IncidentRow> {
  const incidentNumber = await nextCounter(db, input.guildId, 'incident');
  const [row] = await db
    .insert(incidents)
    .values({ ...input, incidentNumber, status: 'open', summary: {} })
    .returning();
  return row!;
}

export async function updateIncident(
  db: Database,
  id: number,
  patch: Partial<Pick<IncidentRow, 'status' | 'threatLevel' | 'summary' | 'endedAt'>>,
): Promise<void> {
  await db.update(incidents).set(patch).where(eq(incidents.id, id));
}

export async function getIncident(
  db: Database,
  guildId: string,
  number: number,
): Promise<IncidentRow | undefined> {
  return db.query.incidents.findFirst({
    where: and(eq(incidents.guildId, guildId), eq(incidents.incidentNumber, number)),
  });
}

export async function listIncidents(db: Database, guildId: string, limit = 10): Promise<IncidentRow[]> {
  return db
    .select()
    .from(incidents)
    .where(eq(incidents.guildId, guildId))
    .orderBy(desc(incidents.startedAt))
    .limit(limit);
}

// ── security events ──────────────────────────────────────────────────────────
export async function recordSecurityEvent(
  db: Database,
  input: {
    guildId: string;
    incidentId?: number | null;
    module: string;
    action: string;
    actorId: string | null;
    targetId: string | null;
    severity: number;
    trust: string | null;
    details?: Record<string, unknown>;
    response?: Record<string, unknown>;
  },
): Promise<SecurityEventRow> {
  const [row] = await db
    .insert(securityEvents)
    .values({
      ...input,
      incidentId: input.incidentId ?? null,
      details: input.details ?? {},
      response: input.response ?? {},
    })
    .returning();
  return row!;
}

export async function incidentEvents(
  db: Database,
  incidentId: number,
  limit = 50,
): Promise<SecurityEventRow[]> {
  return db
    .select()
    .from(securityEvents)
    .where(eq(securityEvents.incidentId, incidentId))
    .orderBy(securityEvents.createdAt)
    .limit(limit);
}

export async function recentSecurityEvents(
  db: Database,
  guildId: string,
  limit = 20,
): Promise<SecurityEventRow[]> {
  return db
    .select()
    .from(securityEvents)
    .where(eq(securityEvents.guildId, guildId))
    .orderBy(desc(securityEvents.createdAt))
    .limit(limit);
}

// ── snapshots ────────────────────────────────────────────────────────────────
export async function saveSnapshot(
  db: Database,
  input: {
    guildId: string;
    kind: 'auto' | 'manual' | 'pre_emergency';
    label: string | null;
    createdBy: string | null;
    roleCount: number;
    channelCount: number;
    data: Record<string, unknown>;
  },
): Promise<SnapshotRow> {
  const sizeBytes = Buffer.byteLength(JSON.stringify(input.data));
  const [row] = await db
    .insert(snapshots)
    .values({ ...input, sizeBytes })
    .returning();
  return row!;
}

export async function listSnapshots(db: Database, guildId: string, limit = 25) {
  return db
    .select({
      id: snapshots.id,
      kind: snapshots.kind,
      label: snapshots.label,
      createdBy: snapshots.createdBy,
      roleCount: snapshots.roleCount,
      channelCount: snapshots.channelCount,
      sizeBytes: snapshots.sizeBytes,
      createdAt: snapshots.createdAt,
    })
    .from(snapshots)
    .where(eq(snapshots.guildId, guildId))
    .orderBy(desc(snapshots.createdAt))
    .limit(limit);
}

export async function getSnapshot(
  db: Database,
  guildId: string,
  id: number,
): Promise<SnapshotRow | undefined> {
  return db.query.snapshots.findFirst({ where: and(eq(snapshots.guildId, guildId), eq(snapshots.id, id)) });
}

/** Newest snapshot, optionally only among those taken before `before` (so a restore never uses one taken mid-attack). */
export async function latestSnapshot(
  db: Database,
  guildId: string,
  before?: Date,
): Promise<SnapshotRow | undefined> {
  return db.query.snapshots.findFirst({
    where: before
      ? and(eq(snapshots.guildId, guildId), lt(snapshots.createdAt, before))
      : eq(snapshots.guildId, guildId),
    orderBy: desc(snapshots.createdAt),
  });
}

export async function deleteSnapshot(db: Database, guildId: string, id: number): Promise<boolean> {
  const rows = await db
    .delete(snapshots)
    .where(and(eq(snapshots.guildId, guildId), eq(snapshots.id, id)))
    .returning({ id: snapshots.id });
  return rows.length > 0;
}

/** Keeps the newest `keep` automatic snapshots (manual snapshots are never pruned). */
export async function pruneAutoSnapshots(db: Database, guildId: string, keep: number): Promise<void> {
  const newest = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(and(eq(snapshots.guildId, guildId), eq(snapshots.kind, 'auto')))
    .orderBy(desc(snapshots.createdAt))
    .limit(keep);
  const ids = newest.map((r) => r.id);
  await db
    .delete(snapshots)
    .where(
      and(
        eq(snapshots.guildId, guildId),
        eq(snapshots.kind, 'auto'),
        ids.length > 0 ? notInArray(snapshots.id, ids) : sql`true`,
      ),
    );
}

// ── emergency mode ───────────────────────────────────────────────────────────
export async function getEmergency(db: Database, guildId: string): Promise<EmergencyRow | undefined> {
  return db.query.emergencyStates.findFirst({ where: eq(emergencyStates.guildId, guildId) });
}

export async function saveEmergency(
  db: Database,
  input: {
    guildId: string;
    active: boolean;
    reason: string | null;
    triggeredBy: string | null;
    automatic: boolean;
    previous: Record<string, unknown>;
    startedAt: Date | null;
    endedAt: Date | null;
  },
): Promise<void> {
  await db
    .insert(emergencyStates)
    .values(input)
    .onConflictDoUpdate({ target: emergencyStates.guildId, set: input });
}

// ── member backup (guilds.join) ──────────────────────────────────────────────

/** Registers `targetGuildId` as a backup server of `sourceGuildId` (idempotent). */
export async function addBackupServer(
  db: Database,
  input: { sourceGuildId: string; targetGuildId: string; ownerId: string },
): Promise<void> {
  await db
    .insert(backupServers)
    .values(input)
    .onConflictDoUpdate({
      target: [backupServers.sourceGuildId, backupServers.targetGuildId],
      set: { ownerId: input.ownerId },
    });
}

export async function removeBackupServer(
  db: Database,
  sourceGuildId: string,
  targetGuildId: string,
): Promise<boolean> {
  const rows = await db
    .delete(backupServers)
    .where(
      and(eq(backupServers.sourceGuildId, sourceGuildId), eq(backupServers.targetGuildId, targetGuildId)),
    )
    .returning({ id: backupServers.id });
  return rows.length > 0;
}

/** Backup servers of a source guild. */
export async function listBackupServers(db: Database, sourceGuildId: string): Promise<BackupServerRow[]> {
  return db.select().from(backupServers).where(eq(backupServers.sourceGuildId, sourceGuildId));
}

/** Source guilds that registered `targetGuildId` as their backup server. */
export async function listBackupSources(db: Database, targetGuildId: string): Promise<BackupServerRow[]> {
  return db.select().from(backupServers).where(eq(backupServers.targetGuildId, targetGuildId));
}

export async function getBackupLink(
  db: Database,
  sourceGuildId: string,
  targetGuildId: string,
): Promise<BackupServerRow | undefined> {
  return db.query.backupServers.findFirst({
    where: and(
      eq(backupServers.sourceGuildId, sourceGuildId),
      eq(backupServers.targetGuildId, targetGuildId),
    ),
  });
}

export async function createPullJob(
  db: Database,
  input: { sourceGuildId: string; targetGuildId: string; requestedBy: string },
): Promise<PullJobRow> {
  const [row] = await db.insert(memberPullJobs).values(input).returning();
  return row!;
}

export async function updatePullJob(
  db: Database,
  id: number,
  patch: Partial<Pick<PullJobRow, 'status' | 'total' | 'added' | 'skipped' | 'failed' | 'error'>>,
): Promise<void> {
  await db
    .update(memberPullJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(memberPullJobs.id, id));
}

export async function getPullJob(db: Database, id: number): Promise<PullJobRow | undefined> {
  return db.query.memberPullJobs.findFirst({ where: eq(memberPullJobs.id, id) });
}

/** Recent pull jobs into a backup server (newest first). */
export async function listPullJobs(db: Database, targetGuildId: string, limit = 10): Promise<PullJobRow[]> {
  return db
    .select()
    .from(memberPullJobs)
    .where(eq(memberPullJobs.targetGuildId, targetGuildId))
    .orderBy(desc(memberPullJobs.createdAt))
    .limit(limit);
}
