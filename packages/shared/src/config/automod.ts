import { z } from 'zod';
import { DEFAULT_ENABLED_WORD_CATEGORIES, WORD_CATEGORIES, type WordCategory } from '../wordlists.js';
import { detectorBase, NullableSnowflake, RateSchema, SnowflakeList } from './common.js';

const wordCategoryToggle = (enabled: boolean) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      /** Optional per-category severity override (1–5). */
      severity: z.number().int().min(1).max(5).nullable().default(null),
    })
    .prefault({});

const categoryShape = Object.fromEntries(
  WORD_CATEGORIES.map((c) => [c, wordCategoryToggle(DEFAULT_ENABLED_WORD_CATEGORIES.includes(c))]),
) as { [K in WordCategory]: ReturnType<typeof wordCategoryToggle> };

export const NormalizerConfigSchema = z
  .object({
    unicode: z.boolean().default(true),
    invisible: z.boolean().default(true),
    zalgo: z.boolean().default(true),
    confusables: z.boolean().default(true),
    leetspeak: z.boolean().default(true),
    separators: z.boolean().default(true),
    repetition: z.boolean().default(true),
  })
  .prefault({});
export type NormalizerConfig = z.infer<typeof NormalizerConfigSchema>;

export const WordsDetectorSchema = z
  .object({
    ...detectorBase(true),
    categories: z.object(categoryShape).prefault({}),
    /** Built-in term ids switched off for this server. */
    disabledTermIds: z.array(z.string().max(64)).max(5000).default([]),
    /** Words that must never be flagged (after normalisation). */
    allowlist: z.array(z.string().min(1).max(64)).max(1000).default([]),
    /**
     * Ignore hits below this severity. Default 2: severity-1 terms are mild words
     * ("stupid", "naked", gaming trash talk) that only count when a server lowers this.
     */
    minSeverity: z.number().int().min(1).max(5).default(2),
  })
  .prefault({});

export const SpamDetectorSchema = z
  .object({
    ...detectorBase(true),
    messageRate: RateSchema(7, 5),
    duplicates: RateSchema(3, 30),
    /** Same content in N different channels within the window — the #1 compromised-account signal. */
    crossChannel: z
      .object({
        channels: z.number().int().min(2).max(50).default(3),
        windowSeconds: z.number().int().min(5).max(600).default(30),
      })
      .prefault({}),
    maxMentions: z.number().int().min(1).max(100).default(6),
    maxEmojis: z.number().int().min(1).max(200).default(25),
    caps: z
      .object({
        enabled: z.boolean().default(true),
        minLength: z.number().int().min(5).max(2000).default(24),
        ratio: z.number().min(0.3).max(1).default(0.8),
      })
      .prefault({}),
    maxNewlines: z.number().int().min(3).max(200).default(30),
    attachments: RateSchema(8, 10),
  })
  .prefault({});

export const LinksDetectorSchema = z
  .object({
    ...detectorBase(false),
    invites: z
      .object({
        block: z.boolean().default(true),
        allowOwnServer: z.boolean().default(true),
        allowedGuildIds: SnowflakeList,
      })
      .prefault({}),
    /** off = allow all links, allowlist = only listed domains, blocklist = all except listed domains. */
    mode: z.enum(['off', 'allowlist', 'blocklist']).default('off'),
    domains: z.array(z.string().min(3).max(253)).max(1000).default([]),
    /** Flag markdown links whose visible text shows a different domain than the real target. */
    maskedLinks: z.boolean().default(true),
  })
  .prefault({});

export const ScamDetectorSchema = z
  .object({
    ...detectorBase(true, { immediate: { type: 'timeout', durationSeconds: 86_400 } }),
    phishingDomains: z.boolean().default(true),
    lookalikeDomains: z.boolean().default(true),
    phrases: z.boolean().default(true),
    imageHashes: z.boolean().default(true),
    /** Cross-channel link/image blast from one account → treat as compromised. */
    compromisedAccount: z.boolean().default(true),
  })
  .prefault({});

export const HarassmentDetectorSchema = z
  .object({
    ...detectorBase(true),
    targetedInsults: z.boolean().default(true),
    threats: z.boolean().default(true),
    dox: z.boolean().default(true),
    repeatedTargeting: RateSchema(4, 300),
  })
  .prefault({});

export const ToxicityDetectorSchema = z
  .object({
    ...detectorBase(false),
    /** 0–1 heuristic toxicity score needed to fire. */
    threshold: z.number().min(0.1).max(1).default(0.75),
  })
  .prefault({});

export const AI_PROVIDERS = ['anthropic', 'openai', 'openai_compatible', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AiDetectorSchema = z
  .object({
    ...detectorBase(false),
    /** borderline = only messages other detectors found suspicious; all = every message (costly). */
    mode: z.enum(['borderline', 'all']).default('borderline'),
    minMessageLength: z.number().int().min(1).max(2000).default(12),
    /** Minimum model confidence (0–1) to create a violation. */
    threshold: z.number().min(0.1).max(1).default(0.8),
    /** Hard cap of AI requests per calendar month (protects the owner's API bill). */
    monthlyRequestLimit: z.number().int().min(0).max(1_000_000).default(5000),
    perMinuteLimit: z.number().int().min(1).max(600).default(30),
  })
  .prefault({});

/** Mirror of the worst terms into Discord's native AutoMod (blocks before the message is posted). */
export const NativeSyncSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Built-in terms at or above this severity are mirrored (custom words always are). */
    minSeverity: z.number().int().min(1).max(5).default(4),
    /** Discord AutoMod rule QUILL manages (set by /automod native sync). */
    ruleId: NullableSnowflake,
    blockMessage: z.string().max(150).default('Blocked by QUILL GUARD.'),
  })
  .prefault({});
export type NativeSyncConfig = z.infer<typeof NativeSyncSchema>;

export const AutomodConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    native: NativeSyncSchema,
    normalizer: NormalizerConfigSchema,
    exempt: z
      .object({
        roleIds: SnowflakeList,
        channelIds: SnowflakeList,
        userIds: SnowflakeList,
        /** Members with Manage Messages bypass AutoMod. */
        manageMessagesBypass: z.boolean().default(true),
      })
      .prefault({}),
    words: WordsDetectorSchema,
    spam: SpamDetectorSchema,
    links: LinksDetectorSchema,
    scam: ScamDetectorSchema,
    harassment: HarassmentDetectorSchema,
    toxicity: ToxicityDetectorSchema,
    ai: AiDetectorSchema,
  })
  .prefault({});
export type AutomodConfig = z.infer<typeof AutomodConfigSchema>;

export const DETECTOR_KEYS = ['words', 'spam', 'links', 'scam', 'harassment', 'toxicity', 'ai'] as const;
export type DetectorKey = (typeof DETECTOR_KEYS)[number];

export const DETECTOR_LABELS: Record<DetectorKey, string> = {
  words: 'Word filter',
  spam: 'Spam',
  links: 'Links & advertising',
  scam: 'Scams & compromised accounts',
  harassment: 'Harassment',
  toxicity: 'Toxicity',
  ai: 'AI analysis (your API key)',
};
