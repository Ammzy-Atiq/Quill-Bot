import type { AntiRaidConfig } from '@quill/shared/config';
import { foldText } from '../normalizer/normalize.js';

export interface JoinInput {
  config: AntiRaidConfig;
  now: number;
  /** Joins inside the join-rate window, INCLUDING this one. */
  joinsInWindow: number;
  accountCreatedAt: number;
  hasAvatar: boolean;
  username: string;
  /** Usernames of other members who joined inside the window. */
  recentJoinNames: readonly string[];
  raidModeActive: boolean;
}

export interface JoinDecision {
  /** Start raid mode now (join spike). */
  startRaid: boolean;
  /** Member failed the join filters (outside raid mode). */
  filtered: boolean;
  /** Member joined while raid mode is active. */
  duringRaid: boolean;
  reasons: string[];
}

/** Username skeleton for "bot farm" detection: folded, digits and separators removed. */
export function nameSkeleton(name: string): string {
  return foldText(name)
    .text.replace(/[^\p{L}]/gu, '')
    .slice(0, 12);
}

function similarNames(name: string, others: readonly string[]): number {
  const skeleton = nameSkeleton(name);
  if (skeleton.length < 3) return 0;
  const prefix = skeleton.slice(0, Math.max(3, Math.floor(skeleton.length * 0.6)));
  return others.filter((other) => {
    const o = nameSkeleton(other);
    return o === skeleton || (o.length >= 3 && o.startsWith(prefix));
  }).length;
}

/** Pure anti-raid evaluation for one member join. */
export function evaluateJoin(input: JoinInput): JoinDecision {
  const cfg = input.config;
  const reasons: string[] = [];
  if (!cfg.enabled) return { startRaid: false, filtered: false, duringRaid: false, reasons };

  const startRaid = !input.raidModeActive && input.joinsInWindow >= cfg.joinRate.count;
  if (startRaid) reasons.push(`${input.joinsInWindow} joins in ${cfg.joinRate.windowSeconds}s`);

  let filtered = false;
  const ageDays = (input.now - input.accountCreatedAt) / 86_400_000;
  if (cfg.minAccountAgeDays > 0 && ageDays < cfg.minAccountAgeDays) {
    filtered = true;
    reasons.push(`account is ${Math.max(0, Math.floor(ageDays))} day(s) old`);
  }
  if (cfg.requireAvatar && !input.hasAvatar) {
    filtered = true;
    reasons.push('no avatar');
  }
  if (cfg.similarNames && similarNames(input.username, input.recentJoinNames) >= 2) {
    filtered = true;
    reasons.push('look-alike username wave');
  }

  return { startRaid, filtered, duringRaid: input.raidModeActive || startRaid, reasons };
}
