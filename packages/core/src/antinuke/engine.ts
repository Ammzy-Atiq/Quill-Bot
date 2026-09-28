import {
  type AntiNukeAction,
  type AntiNukePunishment,
  THREAT_LEVELS,
  type ThreatLevel,
} from '@quill/shared/actions';
import type { AntiNukeConfig } from '@quill/shared/config';

/** How much each protected action contributes to an actor's threat score. */
export const THREAT_WEIGHTS: Record<AntiNukeAction, number> = {
  ban: 8,
  kick: 6,
  prune: 30,
  bot_add: 15,
  guild_update: 8,
  vanity_update: 25,
  member_role_update: 12,
  member_timeout: 4,
  channel_create: 3,
  channel_delete: 12,
  channel_update: 3,
  role_create: 3,
  role_delete: 12,
  role_update: 5,
  webhook_create: 8,
  webhook_update: 4,
  webhook_delete: 4,
  emoji_delete: 3,
  integration_create: 10,
  automod_rule_delete: 10,
  mention_everyone: 6,
};

/** Actions that destroy structure — mixing several of them is the signature of a nuke. */
const DESTRUCTIVE: ReadonlySet<AntiNukeAction> = new Set([
  'ban',
  'kick',
  'prune',
  'channel_delete',
  'role_delete',
  'webhook_create',
  'mention_everyone',
  'vanity_update',
  'member_role_update',
]);

export type TrustLevel = 'owner' | 'self' | 'extra_owner' | 'whitelisted' | 'untrusted';

export interface TrustInput {
  actorId: string;
  ownerId: string;
  botId: string;
  extraOwners: ReadonlySet<string>;
  /** userId → whitelisted actions */
  whitelist: ReadonlyMap<string, ReadonlySet<AntiNukeAction>>;
  action: AntiNukeAction;
}

/** Olympus-style trust: owner > QUILL itself > extra owners > per-action whitelist > everyone else. */
export function resolveTrust(input: TrustInput): TrustLevel {
  if (input.actorId === input.ownerId) return 'owner';
  if (input.actorId === input.botId) return 'self';
  if (input.extraOwners.has(input.actorId)) return 'extra_owner';
  if (input.whitelist.get(input.actorId)?.has(input.action)) return 'whitelisted';
  return 'untrusted';
}

export interface RecentAction {
  action: AntiNukeAction;
  at: number;
  /** Granted dangerous permissions / touched a protected object. */
  dangerous?: boolean;
}

export interface AntiNukeInput {
  action: AntiNukeAction;
  trust: TrustLevel;
  config: AntiNukeConfig;
  /** Same-action events by this actor inside the module window, INCLUDING this one. */
  actionCount: number;
  /** All protected actions by this actor inside the threat window, INCLUDING this one. */
  recent: readonly RecentAction[];
  /** This event granted dangerous permissions or hit a protected channel. */
  dangerous: boolean;
  raidMode: boolean;
}

export interface ThreatAssessment {
  score: number;
  level: ThreatLevel;
  /** Distinct destructive action types in the window. */
  destructiveKinds: number;
}

export interface AntiNukeDecision {
  punish: boolean;
  punishment: AntiNukePunishment;
  revert: boolean;
  emergency: boolean;
  threat: ThreatAssessment;
  /** Effective limit that applied (after raid tightening / anti-betray). */
  limit: number;
  reason: string;
}

const levelRank = (level: ThreatLevel) => THREAT_LEVELS.indexOf(level);

export function assessThreat(recent: readonly RecentAction[], config: AntiNukeConfig): ThreatAssessment {
  let score = 0;
  const kinds = new Set<AntiNukeAction>();
  for (const event of recent) {
    score += THREAT_WEIGHTS[event.action] * (event.dangerous ? 2 : 1);
    if (DESTRUCTIVE.has(event.action)) kinds.add(event.action);
  }
  if (kinds.size >= 3) score *= 1.5;
  else if (kinds.size === 2) score *= 1.2;
  score = Math.round(score);
  const t = config.threat;
  const level: ThreatLevel =
    score >= t.critical
      ? 'critical'
      : score >= t.high
        ? 'high'
        : score >= t.suspicious
          ? 'suspicious'
          : 'normal';
  return { score, level, destructiveKinds: kinds.size };
}

/**
 * Pure anti-nuke decision for one audit-log event.
 *
 * - Owner / QUILL itself are never punished.
 * - Extra owners are exempt unless anti-betray monitors them.
 * - Whitelisted actors (for this action) are only punished when they exceed limit × anti-betray
 *   multiplier, or when their combined activity reaches the critical threat level.
 * - Everyone else: strict mode punishes the first protected action; threshold mode punishes
 *   once the per-action limit inside the window is exceeded. Raid mode halves limits.
 */
export function evaluateAntiNuke(input: AntiNukeInput): AntiNukeDecision {
  const { config, action } = input;
  const module = config.modules[action];
  const threat = assessThreat(input.recent, config);
  const punishment = module.punishment ?? config.punishment;
  const none = (reason: string, limit = module.limit): AntiNukeDecision => ({
    punish: false,
    punishment,
    revert: false,
    emergency: false,
    threat,
    limit,
    reason,
  });

  if (!config.enabled || !module.enabled) return none('module disabled');
  if (input.trust === 'owner' || input.trust === 'self') return none('trusted (owner)');

  let limit = module.limit;
  if (input.raidMode) limit = Math.floor(limit / 2);

  const critical = levelRank(threat.level) >= levelRank('critical');
  const emergencyAt = config.autoEmergency.enabled
    ? levelRank(config.autoEmergency.level)
    : Number.POSITIVE_INFINITY;
  const emergency = levelRank(threat.level) >= emergencyAt;

  let punish = false;
  let reason = '';
  if (input.trust === 'extra_owner' && !config.antiBetray.monitorExtraOwners) {
    return { ...none('extra owner'), emergency: false };
  }
  if (input.trust === 'extra_owner' || input.trust === 'whitelisted') {
    if (!config.antiBetray.enabled) return none('whitelisted');
    const betrayLimit = Math.max(1, limit) * config.antiBetray.multiplier;
    limit = betrayLimit;
    if (input.actionCount > betrayLimit) {
      punish = true;
      reason = `Trusted user exceeded ${betrayLimit} ${action} actions (anti-betray)`;
    } else if (critical) {
      punish = true;
      reason = 'Trusted user reached a critical threat level (anti-betray)';
    }
  } else if (config.mode === 'strict') {
    punish = true;
    reason = `Unwhitelisted ${action.replace(/_/g, ' ')}`;
  } else if (input.actionCount > limit) {
    punish = true;
    reason = `${action.replace(/_/g, ' ')} limit exceeded (${input.actionCount}/${limit} in ${module.windowSeconds}s)`;
  } else if (critical || input.dangerous) {
    punish = true;
    reason = critical ? 'Critical threat level' : `Dangerous ${action.replace(/_/g, ' ')}`;
  }

  return {
    punish,
    punishment,
    revert: punish && config.revert,
    emergency: emergency && (punish || input.trust === 'untrusted'),
    threat,
    limit,
    reason: reason || 'within limits',
  };
}
