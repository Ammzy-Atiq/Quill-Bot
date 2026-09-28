import { z } from 'zod';
import { NullableSnowflake, SnowflakeList } from './common.js';

export const VERIFICATION_MODES = ['oauth', 'simple'] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

export const VerificationConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** oauth = website + Discord OAuth2 + fingerprint (full protection); simple = one-click button. */
    mode: z.enum(VERIFICATION_MODES).default('oauth'),
    verifiedRoleId: NullableSnowflake,
    unverifiedRoleId: NullableSnowflake,
    assignUnverifiedOnJoin: z.boolean().default(true),
    /** Kick members who have not verified after N minutes (0 = never). */
    kickUnverifiedAfterMinutes: z.number().int().min(0).max(10_080).default(0),
    panel: z
      .object({
        channelId: NullableSnowflake,
        messageId: NullableSnowflake,
      })
      .prefault({}),
    evasion: z
      .object({
        enabled: z.boolean().default(true),
        /** Check for alternate accounts of members punished in this server. */
        checkAlts: z.boolean().default(true),
        /** flag = hold for staff review, block = apply blockAction automatically. */
        onMatch: z.enum(['flag', 'block']).default('flag'),
        blockAction: z.enum(['ban', 'kick', 'none']).default('ban'),
        /** Confidence (0–1) needed before a match counts. */
        minConfidence: z.number().min(0.3).max(1).default(0.75),
        vpnPolicy: z.enum(['allow', 'flag', 'block']).default('flag'),
        /** Accounts younger than this are flagged (0 = off). */
        minAccountAgeDays: z.number().int().min(0).max(365).default(0),
      })
      .prefault({}),
    sso: z
      .object({
        /** Members already verified by QUILL elsewhere skip the website (still evasion-checked). */
        accept: z.boolean().default(true),
        maxAgeDays: z.number().int().min(1).max(365).default(90),
      })
      .prefault({}),
    network: z
      .object({
        /** Share ban/alt signals with other servers that also opt in. */
        shareSignals: z.boolean().default(false),
      })
      .prefault({}),
    backup: z
      .object({
        /** Ask verifying members to consent to being re-added to your backup server (guilds.join). */
        enabled: z.boolean().default(false),
      })
      .prefault({}),
    whitelistUserIds: SnowflakeList,
    whitelistRoleIds: SnowflakeList,
  })
  .prefault({});
export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;
