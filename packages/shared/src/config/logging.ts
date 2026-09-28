import { z } from 'zod';
import { NullableSnowflake, SnowflakeList } from './common.js';

export const LOG_CATEGORIES = [
  'automod',
  'antinuke',
  'antiraid',
  'verification',
  'moderation',
  'members',
  'config',
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  automod: 'AutoMod',
  antinuke: 'Anti-Nuke',
  antiraid: 'Anti-Raid',
  verification: 'Verification',
  moderation: 'Moderation',
  members: 'Member joins & leaves',
  config: 'Configuration changes',
};

const channelsShape = Object.fromEntries(LOG_CATEGORIES.map((c) => [c, NullableSnowflake])) as {
  [K in LogCategory]: typeof NullableSnowflake;
};

export const LoggingConfigSchema = z
  .object({
    /** Used for every category without its own channel. */
    defaultChannelId: NullableSnowflake,
    channels: z.object(channelsShape).prefault({}),
    /** Messages in these channels are never logged. */
    ignoreChannelIds: SnowflakeList,
  })
  .prefault({});
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

export const GeneralConfigSchema = z
  .object({
    /** Roles (besides Manage Server) allowed to change AutoMod / Verification / logging settings. */
    managerRoleIds: SnowflakeList,
    /** Roles allowed to use QUILL moderation commands (besides the matching Discord permission). */
    modRoleIds: SnowflakeList,
  })
  .prefault({});
export type GeneralConfig = z.infer<typeof GeneralConfigSchema>;
