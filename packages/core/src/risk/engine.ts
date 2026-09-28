import type { RiskConfig, RiskLadderStep } from '@quill/shared/config';

/** Persisted per (guild, member). */
export interface RiskState {
  score: number;
  /** Epoch ms of the last update (decay is computed lazily from here). */
  updatedAt: number;
  /** Highest ladder threshold already applied — prevents repeating the same step. */
  lastStepThreshold: number;
  lastViolationAt: number | null;
}

export interface RiskViolation {
  severity: 1 | 2 | 3 | 4 | 5;
  /** From the detector's response config (0 = adds no risk). */
  pointsMultiplier: number;
  detector: string;
}

export interface RiskContext {
  now: number;
  accountCreatedAt: number;
  /** Passed QUILL verification in this server. */
  verified: boolean;
  /** Flagged as a likely alt account at verification. */
  altSuspect: boolean;
}

export interface RiskDecision {
  state: RiskState;
  /** Score before this update (after decay). */
  previousScore: number;
  added: number;
  /** Ladder step to execute now (the highest newly crossed step), if any. */
  step: RiskLadderStep | null;
  trustMultiplier: number;
  repeat: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const emptyRiskState = (now: number): RiskState => ({
  score: 0,
  updatedAt: now,
  lastStepThreshold: 0,
  lastViolationAt: null,
});

/** Exponential decay: the score halves every `halfLifeHours`. */
export function decayScore(score: number, updatedAt: number, now: number, halfLifeHours: number): number {
  if (score <= 0 || now <= updatedAt) return Math.max(0, score);
  const halfLives = (now - updatedAt) / (halfLifeHours * HOUR);
  const decayed = score * 0.5 ** halfLives;
  return decayed < 0.01 ? 0 : decayed;
}

/** Account age / verification / alt suspicion change how fast risk grows. */
export function trustMultiplier(ctx: RiskContext, config: RiskConfig): number {
  let multiplier = 1;
  const ageDays = (ctx.now - ctx.accountCreatedAt) / DAY;
  if (config.trust.newAccountDays > 0 && ageDays < config.trust.newAccountDays) {
    multiplier *= config.trust.newAccountMultiplier;
  }
  if (ctx.verified) multiplier *= config.trust.verifiedMultiplier;
  if (ctx.altSuspect) multiplier *= config.trust.altSuspectMultiplier;
  return multiplier;
}

/**
 * Points for one message: the strongest violation counts fully, every additional violation in
 * the same message adds 25% (one slur aimed at someone trips both the word filter and the
 * harassment detector — that is one offence, not two).
 */
export function basePoints(violations: readonly RiskViolation[], config: RiskConfig): number {
  const points = violations
    .map((v) => (config.severityPoints[v.severity - 1] ?? 0) * v.pointsMultiplier)
    .sort((a, b) => b - a);
  return points.reduce((sum, p, i) => sum + (i === 0 ? p : p * 0.25), 0);
}

/**
 * Pure risk update. Decays the stored score, adds points for the new violations and
 * decides which ladder step (if any) to execute.
 *
 * Steps re-arm when the score decays back below them, so a member who behaves for a
 * while and then relapses climbs the ladder again from where their score is.
 */
export function evaluateRisk(
  previous: RiskState | null,
  violations: readonly RiskViolation[],
  config: RiskConfig,
  ctx: RiskContext,
): RiskDecision {
  const prev = previous ?? emptyRiskState(ctx.now);
  const decayed = decayScore(prev.score, prev.updatedAt, ctx.now, config.halfLifeHours);
  const ladder = config.ladder;

  const highestReached = ladder.filter((s) => s.threshold <= decayed).at(-1)?.threshold ?? 0;
  let lastStepThreshold = Math.min(prev.lastStepThreshold, highestReached);

  const repeat =
    prev.lastViolationAt !== null && ctx.now - prev.lastViolationAt < config.repeatWindowMinutes * 60_000;
  const trust = trustMultiplier(ctx, config);
  const added =
    violations.length === 0
      ? 0
      : basePoints(violations, config) * trust * (repeat ? config.repeatMultiplier : 1);
  const score = decayed + added;

  let step: RiskLadderStep | null = null;
  if (config.enabled && added > 0) {
    const crossed = ladder.filter((s) => s.threshold > lastStepThreshold && s.threshold <= score);
    step = crossed.at(-1) ?? null;
    if (step) lastStepThreshold = step.threshold;
  }

  return {
    state: {
      score: Math.round(score * 100) / 100,
      updatedAt: ctx.now,
      lastStepThreshold,
      lastViolationAt: violations.length > 0 ? ctx.now : prev.lastViolationAt,
    },
    previousScore: Math.round(decayed * 100) / 100,
    added: Math.round(added * 100) / 100,
    step,
    trustMultiplier: trust,
    repeat,
  };
}

/** Human-friendly risk level for display. */
export function riskLevel(score: number, config: RiskConfig): 'low' | 'elevated' | 'high' | 'critical' {
  const thresholds = config.ladder.map((s) => s.threshold);
  const max = thresholds.at(-1) ?? 100;
  if (score >= max) return 'critical';
  if (score >= (thresholds[Math.floor(thresholds.length / 2)] ?? max / 2)) return 'high';
  if (score >= (thresholds[0] ?? 10)) return 'elevated';
  return 'low';
}
