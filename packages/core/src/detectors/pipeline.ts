import type { AutomodConfig, DetectorKey } from '@quill/shared/config';
import type { WordHit } from '../matcher/word-matcher.js';
import { detectHarassment } from './harassment.js';
import { detectLinks } from './links.js';
import { evaluatePolicies } from './policies.js';
import { detectScam } from './scam.js';
import { detectSpam } from './spam.js';
import { extractInviteCodes, extractUrls, fnv1a } from './text.js';
import { detectToxicity, toxicityScore } from './toxicity.js';
import type { DetectionResult, DetectorContext, MessageInput, RecentMessage, Violation } from './types.js';
import { detectWords, findWordHits } from './words.js';

const HOSTILE = new Set([
  'insult',
  'slur_racial',
  'slur_lgbtq',
  'slur_ableist',
  'violence',
  'self_harm',
  'extremism',
]);

function exempt(v: Violation, input: MessageInput, ctx: DetectorContext): boolean {
  if (v.detector === 'policy') return false;
  const cfg = ctx.config[v.detector as DetectorKey] as AutomodConfig['spam'];
  return (
    cfg.exemptChannelIds.includes(input.channelId) ||
    cfg.exemptRoleIds.some((r) => ctx.memberRoleIds.includes(r))
  );
}

/**
 * Runs every AutoMod detector over one message. Pure: the caller supplies config, matchers,
 * the author's recent history and scam data, and executes the resulting actions.
 */
export function runDetectors(input: MessageInput, ctx: DetectorContext): DetectionResult {
  const text = [input.content, ...input.extraText].join('\n');
  const urls = extractUrls(text);
  const invites = extractInviteCodes(text);
  const hits: WordHit[] = ctx.config.words.enabled ? findWordHits(ctx) : [];

  const needsAllHits = ctx.config.toxicity.enabled || ctx.config.ai.enabled;
  const allHits = needsAllHits ? ctx.builtin.match(ctx.normalized) : hits;
  const toxicity = toxicityScore(input, allHits, ctx);

  const contentKey = ctx.normalized.variants[0]?.c1.text.trim() ?? '';
  const record: RecentMessage = {
    at: ctx.now,
    channelId: input.channelId,
    hash: fnv1a(contentKey || input.attachments.map((a) => `${a.name}:${a.size}`).join('|')),
    links: urls.length + invites.length,
    attachments: input.attachments.length,
    targets: input.targetUserIds.slice(0, 5),
    hostile: hits.some((h) => HOSTILE.has(h.entry.category)),
  };

  const candidates: Array<Violation | null> = [
    detectWords(hits, ctx),
    ...detectSpam(input, record, ctx),
    ...detectLinks(input, urls, ctx),
    ...detectScam(input, urls, record, ctx),
    ...detectHarassment(input, hits, ctx),
    detectToxicity(toxicity, ctx),
    ...evaluatePolicies(input, urls, ctx),
  ];
  const violations = candidates.filter((v): v is Violation => v !== null && !exempt(v, input, ctx));

  const borderline =
    violations.length === 0
      ? toxicity >= 0.25 || allHits.length > 0
      : violations.every((v) => v.severity <= 2);

  return { violations, wordHits: hits, toxicity, borderline, record };
}
