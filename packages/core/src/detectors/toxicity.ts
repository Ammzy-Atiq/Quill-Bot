import type { WordHit } from '../matcher/word-matcher.js';
import { isSecondPerson } from './harassment.js';
import { capsRatio } from './text.js';
import type { DetectorContext, MessageInput, Violation } from './types.js';

const CATEGORY_WEIGHT: Record<string, number> = {
  slur_racial: 1,
  slur_lgbtq: 1,
  slur_ableist: 0.8,
  extremism: 1,
  self_harm: 1,
  violence: 0.9,
  insult: 0.7,
  sexual: 0.6,
  profanity: 0.35,
  drugs: 0.2,
  custom: 0.6,
};

/**
 * Cheap heuristic toxicity score (0–1) from word hits (all categories, before filters),
 * aggression markers (caps, "!!!") and whether it is aimed at someone.
 */
export function toxicityScore(
  input: MessageInput,
  allHits: readonly WordHit[],
  ctx: DetectorContext,
): number {
  let score = 0;
  for (const hit of allHits) {
    score += (CATEGORY_WEIGHT[hit.entry.category] ?? 0.5) * (hit.entry.severity / 5) * 0.6;
  }
  if (score === 0) return 0;
  const caps = capsRatio(input.content);
  if (caps.letters >= 12 && caps.ratio > 0.7) score += 0.1;
  if (/!{3,}/.test(input.content)) score += 0.05;
  if (input.targetUserIds.length > 0 || isSecondPerson(ctx)) score *= 1.35;
  return Math.min(1, Math.round(score * 100) / 100);
}

export function detectToxicity(score: number, ctx: DetectorContext): Violation | null {
  const cfg = ctx.config.toxicity;
  if (!cfg.enabled || score < cfg.threshold) return null;
  return {
    detector: 'toxicity',
    category: 'toxicity',
    severity: score >= 0.9 ? 4 : score >= 0.8 ? 3 : 2,
    reason: 'Toxic message',
    evidence: [`toxicity ${Math.round(score * 100)}%`],
    flags: [],
  };
}
