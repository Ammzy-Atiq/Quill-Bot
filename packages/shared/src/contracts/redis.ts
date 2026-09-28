import { z } from 'zod';

/**
 * Redis pub/sub channels shared by the bot (all shards), the worker and the website.
 * Every message is JSON validated by the matching schema below.
 */
export const REDIS_CHANNELS = {
  /** A guild's config changed (bot command or dashboard). Every shard drops its cache. */
  configInvalidate: 'quill:config:invalidate',
  /** Website finished a verification; the shard owning the guild applies roles/actions. */
  verificationCompleted: 'quill:verification:completed',
  /** A user deleted their data or revoked OAuth; drop cached identity state. */
  identityRevoked: 'quill:identity:revoked',
  /** Custom word list / policy changed for a guild; rebuild matcher. */
  wordlistInvalidate: 'quill:wordlist:invalidate',
  /** Extra owners / whitelist changed for a guild. */
  trustInvalidate: 'quill:trust:invalidate',
  /** Staff reviewed a flagged verification on the dashboard; the bot applies the decision. */
  verificationReview: 'quill:verification:review',
} as const;

export const ConfigInvalidateMessage = z.object({
  guildId: z.string(),
  /** New `guild_settings.version`. */
  version: z.number().int(),
  source: z.enum(['bot', 'dashboard', 'worker']),
  /** Unique id of the publishing process; receivers skip their own messages. */
  origin: z.string().optional(),
});
export type ConfigInvalidateMessage = z.infer<typeof ConfigInvalidateMessage>;

export const VERIFICATION_VERDICTS = ['pass', 'flag', 'block'] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export const VerificationCompletedMessage = z.object({
  sessionId: z.string(),
  guildId: z.string(),
  userId: z.string(),
  verdict: z.enum(VERIFICATION_VERDICTS),
  /** Machine-readable reason codes, see VERIFICATION_REASON_CODES. */
  reasons: z.array(z.string()),
  /** 0–1 evasion confidence. */
  confidence: z.number().min(0).max(1),
  /** Other accounts linked to this user by fingerprint (possible alts). */
  linkedUserIds: z.array(z.string()),
  /** True when the website already added the member to the guild via guilds.join. */
  addedToGuild: z.boolean(),
  method: z.enum(['oauth', 'sso']),
});
export type VerificationCompletedMessage = z.infer<typeof VerificationCompletedMessage>;

export const VerificationReviewMessage = z.object({
  guildId: z.string(),
  userId: z.string(),
  decision: z.enum(['approve', 'deny', 'ban']),
  reviewerId: z.string(),
  reason: z.string().max(500).optional(),
});
export type VerificationReviewMessage = z.infer<typeof VerificationReviewMessage>;

export const IdentityRevokedMessage = z.object({ userId: z.string() });
export type IdentityRevokedMessage = z.infer<typeof IdentityRevokedMessage>;
export const WordlistInvalidateMessage = z.object({ guildId: z.string(), origin: z.string().optional() });
export type WordlistInvalidateMessage = z.infer<typeof WordlistInvalidateMessage>;
export const TrustInvalidateMessage = z.object({ guildId: z.string(), origin: z.string().optional() });
export type TrustInvalidateMessage = z.infer<typeof TrustInvalidateMessage>;

/** Reason codes produced by the verification evaluator (packages/core/src/verification). */
export const VERIFICATION_REASON_CODES = {
  ALT_OF_BANNED: 'alt_of_banned',
  ALT_OF_PUNISHED: 'alt_of_punished',
  ALT_LINKED: 'alt_linked',
  VPN_OR_PROXY: 'vpn_or_proxy',
  NEW_ACCOUNT: 'new_account',
  NETWORK_SIGNAL: 'network_signal',
  MANUAL_BLOCK: 'manual_block',
} as const;

/** BullMQ queue names (worker process). */
export const QUEUES = {
  restore: 'quill-restore',
  memberPull: 'quill-member-pull',
  maintenance: 'quill-maintenance',
} as const;

/** Redis key builders. Keep every key namespaced with `quill:`. */
export const redisKeys = {
  guildConfig: (guildId: string) => `quill:cfg:${guildId}`,
  risk: (guildId: string, userId: string) => `quill:risk:${guildId}:${userId}`,
  antinukeWindow: (guildId: string, actorId: string, action: string) =>
    `quill:an:${guildId}:${actorId}:${action}`,
  antinukeThreat: (guildId: string, actorId: string) => `quill:an:threat:${guildId}:${actorId}`,
  antinukeHandled: (guildId: string, actorId: string) => `quill:an:handled:${guildId}:${actorId}`,
  raidJoins: (guildId: string) => `quill:raid:joins:${guildId}`,
  raidMode: (guildId: string) => `quill:raid:mode:${guildId}`,
  spamRecent: (guildId: string, userId: string) => `quill:spam:${guildId}:${userId}`,
  aiUsage: (guildId: string, month: string) => `quill:ai:${guildId}:${month}`,
  aiMinute: (guildId: string) => `quill:ai:min:${guildId}`,
  verifySession: (sessionId: string) => `quill:verify:${sessionId}`,
  deletedObject: (guildId: string, objectId: string) => `quill:deleted:${guildId}:${objectId}`,
} as const;
