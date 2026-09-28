import type { VerificationConfig } from '@quill/shared/config';
import { VERIFICATION_REASON_CODES, type VerificationVerdict } from '@quill/shared/redis';

export type LinkSignal = 'device' | 'ip' | 'ip_prefix';

const SIGNAL_WEIGHT: Record<LinkSignal, { normal: number; proxy: number }> = {
  // A device fingerprint (FingerprintJS visitorId, hashed) is the strongest single signal.
  device: { normal: 0.85, proxy: 0.8 },
  // Same exact IP: strong, but households, schools and mobile carriers share IPs.
  ip: { normal: 0.55, proxy: 0.15 },
  // Same /24 or /48 network: weak on its own.
  ip_prefix: { normal: 0.2, proxy: 0.05 },
};

/**
 * Confidence (0–1) that two accounts belong to the same person.
 * Signals combine as a noisy-OR; older sightings count less.
 */
export function scoreIdentityLink(
  matches: readonly LinkSignal[],
  opts: { isProxy: boolean; lastSeenDaysAgo: number },
): number {
  const unique = [...new Set(matches)];
  if (unique.length === 0) return 0;
  let miss = 1;
  for (const signal of unique) {
    const weight = opts.isProxy ? SIGNAL_WEIGHT[signal].proxy : SIGNAL_WEIGHT[signal].normal;
    miss *= 1 - weight;
  }
  const recency = opts.lastSeenDaysAgo <= 30 ? 1 : opts.lastSeenDaysAgo <= 90 ? 0.85 : 0.7;
  return Math.min(0.99, Math.round((1 - miss) * recency * 1000) / 1000);
}

export interface LinkedAccount {
  userId: string;
  /** From scoreIdentityLink. */
  confidence: number;
  /** Currently banned in the guild being verified for. */
  bannedHere: boolean;
  /** Active timeout / quarantine / recent kick in this guild. */
  punishedHere: boolean;
  /** Bans in other guilds that opted into signal sharing. */
  networkBans: number;
}

export interface EvaluateVerificationInput {
  userId: string;
  accountCreatedAt: Date;
  config: VerificationConfig;
  whitelisted: boolean;
  isProxy: boolean;
  linked: readonly LinkedAccount[];
  now?: number;
}

export interface VerificationEvaluation {
  verdict: VerificationVerdict;
  /** 0–1 confidence of the strongest reason (1 when nothing suspicious). */
  confidence: number;
  /** Reason codes (VERIFICATION_REASON_CODES). */
  reasons: string[];
  /** Accounts linked above the configured confidence, strongest first. */
  linkedUserIds: string[];
}

const RANK: Record<VerificationVerdict, number> = { pass: 0, flag: 1, block: 2 };

/**
 * Decides pass / flag / block for a verification attempt. Pure — the website gathers the
 * inputs (fingerprint links, bans, cases) and calls this; the bot applies the verdict.
 */
export function evaluateVerification(input: EvaluateVerificationInput): VerificationEvaluation {
  const { config } = input;
  const now = input.now ?? Date.now();
  const strong = [...input.linked]
    .filter((l) => l.userId !== input.userId && l.confidence >= config.evasion.minConfidence)
    .sort((a, b) => b.confidence - a.confidence);
  const linkedUserIds = strong.map((l) => l.userId);

  if (input.whitelisted || !config.evasion.enabled) {
    return { verdict: 'pass', confidence: 1, reasons: [], linkedUserIds };
  }

  let verdict: VerificationVerdict = 'pass';
  let confidence = 0;
  const reasons: string[] = [];
  const raise = (to: VerificationVerdict, reason: string, reasonConfidence: number) => {
    if (RANK[to] > RANK[verdict]) verdict = to;
    reasons.push(reason);
    confidence = Math.max(confidence, reasonConfidence);
  };

  if (config.evasion.checkAlts) {
    const banned = strong.find((l) => l.bannedHere);
    if (banned) {
      raise(
        config.evasion.onMatch === 'block' ? 'block' : 'flag',
        VERIFICATION_REASON_CODES.ALT_OF_BANNED,
        banned.confidence,
      );
    }
    const punished = strong.find((l) => l.punishedHere && !l.bannedHere);
    if (punished) raise('flag', VERIFICATION_REASON_CODES.ALT_OF_PUNISHED, punished.confidence);
    if (config.network.shareSignals) {
      const network = strong.find((l) => l.networkBans > 0);
      if (network) raise('flag', VERIFICATION_REASON_CODES.NETWORK_SIGNAL, network.confidence * 0.8);
    }
    if (strong.length > 0 && reasons.length === 0) {
      reasons.push(VERIFICATION_REASON_CODES.ALT_LINKED);
    }
  }

  if (input.isProxy && config.evasion.vpnPolicy !== 'allow') {
    raise(
      config.evasion.vpnPolicy === 'block' ? 'block' : 'flag',
      VERIFICATION_REASON_CODES.VPN_OR_PROXY,
      0.6,
    );
  }

  const ageDays = (now - input.accountCreatedAt.getTime()) / 86_400_000;
  if (config.evasion.minAccountAgeDays > 0 && ageDays < config.evasion.minAccountAgeDays) {
    raise('flag', VERIFICATION_REASON_CODES.NEW_ACCOUNT, 0.5);
  }

  return { verdict, confidence: verdict === 'pass' ? 1 : confidence, reasons, linkedUserIds };
}
