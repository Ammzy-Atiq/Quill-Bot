import type { AntiNukeAction, AntiNukePunishment } from '@quill/shared';
import type { AuditLogEvent } from 'discord.js';

export interface AuditChange {
  key: string;
  old?: unknown;
  new?: unknown;
}

/**
 * One protected action, kept in memory (per shard) for the actor's threat window so it can be
 * reverted — including retroactively, when a threshold is crossed on a later event.
 */
export interface EventRecord {
  action: AntiNukeAction;
  actorId: string;
  targetId: string | null;
  at: number;
  auditAction: AuditLogEvent | null;
  changes: AuditChange[];
  /** Permission-overwrite target for channel overwrite events (type 0 = role, 1 = member). */
  overwrite: { id: string; type: 0 | 1 } | null;
  /** The message to delete for @everyone abuse. */
  message: { channelId: string; messageId: string } | null;
  dangerous: boolean;
  /** Revert already attempted. */
  reverted: boolean;
}

export type RevertOutcome = 'reverted' | 'skipped' | 'failed';

export interface RevertResult {
  outcome: RevertOutcome;
  note: string;
}

export interface PunishmentRecord {
  type: AntiNukePunishment;
  ok: boolean;
  error: string | null;
  caseNumber: number | null;
  /** Roles removed by strip_roles / quarantine (for "Release"). */
  previousRoles: string[];
  quarantineRoleId: string | null;
  /** The actor is a bot (bots are banned or kicked, never stripped). */
  bot: boolean;
}

export interface TimelineEntry {
  at: number;
  text: string;
}

/** Stored in `incidents.summary`; everything an incident card needs besides the row columns. */
export interface IncidentSummary {
  trust: string | null;
  threatScore: number;
  counts: Partial<Record<string, number>>;
  punishment: PunishmentRecord | null;
  reverts: { reverted: number; failed: number; skipped: number };
  emergency: boolean;
  timeline: TimelineEntry[];
  /** The live log card, edited as the incident evolves. */
  log: { channelId: string; messageId: string } | null;
  notes: string[];
  raid?: RaidSummary;
}

export interface RaidSummary {
  reason: string;
  joins: number;
  actioned: number;
  action: string;
  endsAt: number | null;
  endedAt: number | null;
  invitesPaused: boolean;
}

export const emptySummary = (): IncidentSummary => ({
  trust: null,
  threatScore: 0,
  counts: {},
  punishment: null,
  reverts: { reverted: 0, failed: 0, skipped: 0 },
  emergency: false,
  timeline: [],
  log: null,
  notes: [],
});

/** Keeps the newest `max` timeline entries (cards stay under Discord's text limits). */
export function pushTimeline(summary: IncidentSummary, text: string, max = 14): void {
  summary.timeline.push({ at: Date.now(), text });
  if (summary.timeline.length > max) summary.timeline.splice(0, summary.timeline.length - max);
}
