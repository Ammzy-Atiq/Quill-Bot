import { z } from 'zod';
import { ANTINUKE_ACTIONS, ANTINUKE_PUNISHMENTS, type AntiNukeAction, THREAT_LEVELS } from '../actions.js';
import { NullableSnowflake, SnowflakeList } from './common.js';

/** Default per-action limits (used in threshold mode and for anti-betray monitoring). */
export const DEFAULT_ANTINUKE_LIMITS: Record<AntiNukeAction, { limit: number; windowSeconds: number }> = {
  ban: { limit: 3, windowSeconds: 10 },
  kick: { limit: 3, windowSeconds: 10 },
  prune: { limit: 0, windowSeconds: 60 },
  bot_add: { limit: 0, windowSeconds: 60 },
  guild_update: { limit: 2, windowSeconds: 30 },
  vanity_update: { limit: 0, windowSeconds: 60 },
  member_role_update: { limit: 2, windowSeconds: 10 },
  member_timeout: { limit: 5, windowSeconds: 10 },
  channel_create: { limit: 4, windowSeconds: 10 },
  channel_delete: { limit: 2, windowSeconds: 10 },
  channel_update: { limit: 5, windowSeconds: 10 },
  role_create: { limit: 4, windowSeconds: 10 },
  role_delete: { limit: 2, windowSeconds: 10 },
  role_update: { limit: 4, windowSeconds: 10 },
  webhook_create: { limit: 2, windowSeconds: 10 },
  webhook_update: { limit: 4, windowSeconds: 10 },
  webhook_delete: { limit: 3, windowSeconds: 10 },
  emoji_delete: { limit: 3, windowSeconds: 10 },
  integration_create: { limit: 1, windowSeconds: 30 },
  automod_rule_delete: { limit: 1, windowSeconds: 30 },
  mention_everyone: { limit: 1, windowSeconds: 30 },
};

const moduleSchema = (action: AntiNukeAction) =>
  z
    .object({
      enabled: z.boolean().default(true),
      /** Max actions allowed inside the window (0 = none allowed). */
      limit: z.number().int().min(0).max(100).default(DEFAULT_ANTINUKE_LIMITS[action].limit),
      windowSeconds: z.number().int().min(1).max(3600).default(DEFAULT_ANTINUKE_LIMITS[action].windowSeconds),
      /** Per-module punishment override; null = global punishment. */
      punishment: z.enum(ANTINUKE_PUNISHMENTS).nullable().default(null),
    })
    .prefault({});

const modulesShape = Object.fromEntries(ANTINUKE_ACTIONS.map((a) => [a, moduleSchema(a)])) as {
  [K in AntiNukeAction]: ReturnType<typeof moduleSchema>;
};

export const AntiNukeConfigSchema = z
  .object({
    /** Off until the owner runs /antinuke enable (Olympus style). */
    enabled: z.boolean().default(false),
    /**
     * strict    = any non-whitelisted protected action is punished immediately (Olympus behaviour).
     * threshold = non-whitelisted actors are punished once they exceed the module limit.
     */
    mode: z.enum(['strict', 'threshold']).default('strict'),
    punishment: z.enum(ANTINUKE_PUNISHMENTS).default('ban'),
    /** What to do with a bot added by a non-whitelisted member. */
    botAddAction: z.enum(['kick', 'ban']).default('kick'),
    modules: z.object(modulesShape).prefault({}),
    /** Undo the destructive action (unban, re-create channel/role, delete webhook, roll back edits). */
    revert: z.boolean().default(true),
    /** Anti-betray: whitelisted users are still punished if they exceed limit × multiplier. */
    antiBetray: z
      .object({
        enabled: z.boolean().default(true),
        multiplier: z.number().min(1).max(20).default(3),
        /** Also monitor extra owners (never the real owner). */
        monitorExtraOwners: z.boolean().default(false),
      })
      .prefault({}),
    /** Threat score window + thresholds for Normal/Suspicious/High/Critical. */
    threat: z
      .object({
        windowSeconds: z.number().int().min(10).max(600).default(60),
        suspicious: z.number().min(1).default(20),
        high: z.number().min(1).default(40),
        critical: z.number().min(1).default(70),
      })
      .prefault({}),
    /** Automatically enter emergency mode when the threat level reaches this. */
    autoEmergency: z
      .object({
        enabled: z.boolean().default(true),
        level: z.enum(THREAT_LEVELS).default('critical'),
      })
      .prefault({}),
    emergency: z
      .object({
        /** Users (besides owner / extra owners) allowed to trigger emergency mode. Max 5. */
        authorizedUserIds: z.array(z.string()).max(5).default([]),
        /** Roles to strip dangerous permissions from; empty = every role with dangerous permissions. */
        protectedRoleIds: z.array(z.string()).max(25).default([]),
        /** Deny Send Messages for @everyone in every text channel while active. */
        lockChannels: z.boolean().default(false),
        /** Pause invites (Discord incident actions) while active. */
        pauseInvites: z.boolean().default(true),
      })
      .prefault({}),
    /** Role given to quarantined actors (created on demand when null). */
    quarantineRoleId: NullableSnowflake,
    maxExtraOwners: z.number().int().min(1).max(10).default(3),
    /** Take automatic server snapshots every N hours (0 = off). */
    snapshotIntervalHours: z.number().int().min(0).max(168).default(12),
    snapshotRetention: z.number().int().min(1).max(50).default(10),
    /** Channels whose deletion is always critical. */
    protectedChannelIds: SnowflakeList,
  })
  .prefault({});
export type AntiNukeConfig = z.infer<typeof AntiNukeConfigSchema>;
