import { OFFICIAL_DOMAINS, PROTECTED_BRANDS, SCAM_DOMAIN_WORDS, SCAM_PHRASES } from '../data/scam.js';
import { foldText } from '../normalizer/normalize.js';
import type { Severity } from '../wordlist/types.js';
import { extractInviteCodes, type FoundUrl, hammingHex, hostMatches, levenshtein } from './text.js';
import type { DetectorContext, MessageInput, RecentMessage, Violation } from './types.js';

const IMAGE_HASH_MAX_DISTANCE = 6;

export const isOfficialHost = (host: string) => OFFICIAL_DOMAINS.some((d) => hostMatches(host, d));

/** Folds a hostname the way scammers disguise brands: homoglyphs, leetspeak, `rn`→`m`, `vv`→`w`. */
export function hostSkeleton(host: string): string {
  return foldText(host)
    .text.replace(/0/g, 'o')
    .replace(/[1|!]/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w');
}

export interface DomainVerdict {
  severity: Severity;
  reason: string;
}

/** Classifies one hostname: known scam, homograph of an official domain, lookalike brand. */
export function classifyDomain(host: string, known: ReadonlySet<string>): DomainVerdict | null {
  for (const domain of known) {
    if (hostMatches(host, domain)) return { severity: 5, reason: 'Known scam link' };
  }
  const skeleton = hostSkeleton(host);
  if (isOfficialHost(host)) return null;
  // IDN homograph: looks exactly like an official domain once folded (dіscord.com with Cyrillic і)
  if (skeleton !== host && isOfficialHost(skeleton)) return { severity: 5, reason: 'Fake look-alike domain' };

  const labels = skeleton.split(/[.-]/).filter(Boolean);
  const joined = skeleton.replace(/[.-]/g, '');
  for (const brand of PROTECTED_BRANDS) {
    if (joined.includes(brand)) {
      if (
        SCAM_DOMAIN_WORDS.some(
          (w) => labels.includes(w) || joined.includes(`${brand}${w}`) || joined.includes(`${w}${brand}`),
        )
      ) {
        return { severity: 4, reason: `Fake ${brand} domain` };
      }
      continue;
    }
    for (const label of labels) {
      if (label.length < brand.length - 1) continue;
      const allowed = brand.length >= 7 ? 2 : 1;
      const distance = levenshtein(label, brand, allowed);
      if (distance > 0 && distance <= allowed) return { severity: 4, reason: `Look-alike of ${brand}` };
    }
  }
  return null;
}

const scamViolation = (
  severity: Severity,
  reason: string,
  evidence: string[],
  flags: string[] = [],
): Violation => ({
  detector: 'scam',
  category: flags.includes('compromised') ? 'compromised' : 'scam',
  severity,
  reason,
  evidence,
  flags,
});

/** Scams: phishing/look-alike domains, scam phrases, known scam images, compromised accounts. */
export function detectScam(
  input: MessageInput,
  urls: readonly FoundUrl[],
  record: RecentMessage,
  ctx: DetectorContext,
): Violation[] {
  const cfg = ctx.config.scam;
  if (!cfg.enabled) return [];
  const out: Violation[] = [];
  const hasLink = urls.length > 0 || extractInviteCodes(input.content).length > 0;
  const hasMedia = input.attachments.length > 0;

  if (cfg.phishingDomains || cfg.lookalikeDomains) {
    for (const url of urls) {
      const verdict = classifyDomain(url.host, cfg.phishingDomains ? ctx.scam.domains : new Set());
      if (!verdict) continue;
      if (verdict.reason === 'Known scam link' ? cfg.phishingDomains : cfg.lookalikeDomains) {
        out.push(scamViolation(verdict.severity, verdict.reason, [url.host]));
        break;
      }
    }
  }

  if (cfg.phrases) {
    const text = ctx.normalized.variants[0]?.c1.text ?? '';
    for (const phrase of SCAM_PHRASES) {
      if (phrase.needsLink && !hasLink && !hasMedia) continue;
      const match = phrase.re.exec(text);
      if (match) {
        out.push(scamViolation(phrase.severity, phrase.reason, [match[0].trim()]));
        break;
      }
    }
  }

  if (cfg.imageHashes && ctx.scam.imageHashes.length > 0) {
    for (const attachment of input.attachments) {
      if (!attachment.imageHash) continue;
      const hit = ctx.scam.imageHashes.find(
        (h) => hammingHex(h, attachment.imageHash!) <= IMAGE_HASH_MAX_DISTANCE,
      );
      if (hit) {
        out.push(scamViolation(5, 'Known scam image', [attachment.name]));
        break;
      }
    }
  }

  if (cfg.compromisedAccount) {
    // Same link/image blasted into several channels within a minute: the classic hacked-account pattern.
    const windowStart = ctx.now - 60_000;
    const blast = ctx.history.filter(
      (m) => m.at >= windowStart && m.hash === record.hash && (m.links > 0 || m.attachments > 0),
    );
    const channels = new Set([...blast.map((m) => m.channelId), input.channelId]);
    if ((hasLink || hasMedia) && channels.size >= Math.max(2, ctx.config.spam.crossChannel.channels)) {
      out.push(
        scamViolation(
          5,
          'Compromised account (link blast across channels)',
          [`${channels.size} channels`],
          ['compromised'],
        ),
      );
    }
    if (input.mentions.everyone && !input.canMentionEveryone && (hasLink || hasMedia)) {
      const newAccount = ctx.now - input.accountCreatedAt < 30 * 86_400_000;
      out.push(
        scamViolation(
          newAccount ? 5 : 4,
          '@everyone with a link from an account without permission',
          ['@everyone'],
          ['compromised'],
        ),
      );
    }
  }

  // Keep the strongest scam signal only.
  return out.sort((a, b) => b.severity - a.severity).slice(0, 1);
}
