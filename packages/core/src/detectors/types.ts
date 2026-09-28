import type { ModAction } from '@quill/shared/actions';
import type { AutomodConfig, CustomPolicyDefinition, DetectorKey } from '@quill/shared/config';
import type { WordHit, WordMatcher } from '../matcher/word-matcher.js';
import type { NormalizedText } from '../normalizer/normalize.js';
import type { Severity } from '../wordlist/types.js';

export interface MessageAttachment {
  name: string;
  contentType: string | null;
  size: number;
  url: string;
  /** 64-bit dHash (16 hex chars) computed by the bot for images, if available. */
  imageHash?: string | null;
}

/** Everything the detectors need about one message (built by the bot from a discord.js Message). */
export interface MessageInput {
  guildId: string;
  channelId: string;
  authorId: string;
  content: string;
  /** Embed titles/descriptions, sticker names, poll text, attachment file names… */
  extraText: string[];
  createdAt: number;
  mentions: { users: number; roles: number; everyone: boolean };
  /** Users this message is aimed at (reply target + mentioned users). */
  targetUserIds: string[];
  attachments: MessageAttachment[];
  accountCreatedAt: number;
  /** Author may ping @everyone/@here (then an @everyone attempt is not suspicious). */
  canMentionEveryone: boolean;
  /** Invite code → guild id (null = invalid/unknown), resolved by the bot. */
  inviteGuilds: Record<string, string | null>;
}

/** Compact record of a recent message from the same author (kept in Redis by the bot). */
export interface RecentMessage {
  at: number;
  channelId: string;
  /** Hash of the normalized content (duplicate detection). */
  hash: string;
  links: number;
  attachments: number;
  targets: string[];
  /** The message contained insults/slurs. */
  hostile: boolean;
}

export type ViolationSource = DetectorKey | 'policy';

export interface Violation {
  detector: ViolationSource;
  /** Detector-specific category, e.g. `slur_racial`, `duplicate`, `invite`, `phishing`. */
  category: string;
  severity: Severity;
  /** Short, member-facing reason. */
  reason: string;
  /** Offending snippets / domains / terms. */
  evidence: string[];
  /** Extra signals: `obfuscated`, `compromised`, `targeted`… */
  flags: string[];
  /** Custom policy overrides. */
  policyId?: number;
  policyAction?: ModAction | null;
  policyDelete?: boolean;
}

export interface CompiledPolicy {
  id: number;
  name: string;
  definition: CustomPolicyDefinition;
  /** Pre-built matcher for keyword triggers. */
  matcher?: WordMatcher;
  regex?: RegExp;
}

export interface ScamData {
  /** Known scam domains (lowercase, no `www.`). */
  domains: ReadonlySet<string>;
  /** Known scam image dHashes (16 hex chars). */
  imageHashes: readonly string[];
}

export interface DetectorContext {
  config: AutomodConfig;
  normalized: NormalizedText;
  /** Matcher for the built-in lists (shared by all servers). */
  builtin: WordMatcher;
  /** Matcher for this server's custom words (null if none). */
  custom: WordMatcher | null;
  /** Earlier messages by the same author, oldest first. */
  history: readonly RecentMessage[];
  now: number;
  scam: ScamData;
  policies: readonly CompiledPolicy[];
  /** Author role ids (for policy exemptions). */
  memberRoleIds: readonly string[];
}

export interface DetectionResult {
  violations: Violation[];
  /** Word hits (after filters) — reused by the harassment/toxicity detectors and logs. */
  wordHits: WordHit[];
  /** 0–1 heuristic toxicity score. */
  toxicity: number;
  /** Suspicious but below action thresholds — candidates for the AI second opinion. */
  borderline: boolean;
  /** Record to append to the author's history. */
  record: RecentMessage;
}
