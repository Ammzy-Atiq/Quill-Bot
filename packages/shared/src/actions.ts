import { z } from 'zod';

/**
 * Punishments / responses the bot can execute against a member.
 * Used by the Risk Engine ladder, detector overrides, anti-raid and anti-nuke.
 */
export const ModActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('warn') }),
  z.object({
    type: z.literal('timeout'),
    durationSeconds: z
      .number()
      .int()
      .min(5)
      .max(28 * 24 * 60 * 60),
  }),
  z.object({ type: z.literal('quarantine') }),
  z.object({ type: z.literal('strip_roles') }),
  z.object({ type: z.literal('kick') }),
  z.object({ type: z.literal('softban') }),
  z.object({
    type: z.literal('ban'),
    deleteMessageSeconds: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60 * 60)
      .default(0),
  }),
]);
export type ModAction = z.infer<typeof ModActionSchema>;
export type ModActionType = ModAction['type'];

/** Severity order for comparing/escalating actions. */
export const MOD_ACTION_RANK: Record<ModActionType, number> = {
  none: 0,
  warn: 1,
  timeout: 2,
  quarantine: 3,
  strip_roles: 4,
  kick: 5,
  softban: 6,
  ban: 7,
};

/** Case log entry types (superset of ModActionType: includes reversals and notes). */
export const CASE_TYPES = [
  'warn',
  'timeout',
  'untimeout',
  'quarantine',
  'unquarantine',
  'strip_roles',
  'kick',
  'softban',
  'ban',
  'unban',
  'delete',
  'note',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_SOURCES = ['manual', 'automod', 'risk', 'antinuke', 'antiraid', 'verification'] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

/**
 * Anti-Nuke protected action keys. These double as the per-user whitelist flags
 * (Olympus-style per-action whitelisting).
 */
export const ANTINUKE_ACTIONS = [
  'ban',
  'kick',
  'prune',
  'bot_add',
  'guild_update',
  'vanity_update',
  'member_role_update',
  'member_timeout',
  'channel_create',
  'channel_delete',
  'channel_update',
  'role_create',
  'role_delete',
  'role_update',
  'webhook_create',
  'webhook_update',
  'webhook_delete',
  'emoji_delete',
  'integration_create',
  'automod_rule_delete',
  'mention_everyone',
] as const;
export type AntiNukeAction = (typeof ANTINUKE_ACTIONS)[number];

export const ANTINUKE_ACTION_LABELS: Record<AntiNukeAction, string> = {
  ban: 'Member bans',
  kick: 'Member kicks',
  prune: 'Member prune',
  bot_add: 'Bot additions',
  guild_update: 'Server settings',
  vanity_update: 'Vanity URL',
  member_role_update: 'Dangerous role grants',
  member_timeout: 'Member timeouts',
  channel_create: 'Channel creation',
  channel_delete: 'Channel deletion',
  channel_update: 'Channel / permission edits',
  role_create: 'Role creation',
  role_delete: 'Role deletion',
  role_update: 'Role edits',
  webhook_create: 'Webhook creation',
  webhook_update: 'Webhook edits',
  webhook_delete: 'Webhook deletion',
  emoji_delete: 'Emoji / sticker deletion',
  integration_create: 'Integrations',
  automod_rule_delete: 'AutoMod rule deletion',
  mention_everyone: '@everyone / @here',
};

/** Anti-Nuke punishments (Olympus default is `ban`). */
export const ANTINUKE_PUNISHMENTS = ['ban', 'kick', 'strip_roles', 'quarantine', 'alert'] as const;
export type AntiNukePunishment = (typeof ANTINUKE_PUNISHMENTS)[number];

export const THREAT_LEVELS = ['normal', 'suspicious', 'high', 'critical'] as const;
export type ThreatLevel = (typeof THREAT_LEVELS)[number];

/**
 * Permissions considered dangerous. Stored as permission flag names (discord.js
 * `PermissionFlagsBits` keys) so this package stays free of discord.js.
 */
export const DANGEROUS_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'BanMembers',
  'KickMembers',
  'ManageWebhooks',
  'MentionEveryone',
  'ModerateMembers',
  'ManageGuildExpressions',
] as const;
export type DangerousPermission = (typeof DANGEROUS_PERMISSIONS)[number];
