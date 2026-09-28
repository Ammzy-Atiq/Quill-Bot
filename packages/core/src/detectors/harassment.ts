import type { WordHit } from '../matcher/word-matcher.js';
import type { Severity } from '../wordlist/types.js';
import type { DetectorContext, MessageInput, RecentMessage, Violation } from './types.js';

const HOSTILE_CATEGORIES = new Set([
  'insult',
  'slur_racial',
  'slur_lgbtq',
  'slur_ableist',
  'sexual',
  'profanity',
]);
const THREAT_CATEGORIES = new Set(['violence', 'self_harm']);
const SECOND_PERSON = new Set(['you', 'u', 'ur', 'your', 'youre', 'yo', 'thou', 'ya', 'yall', 'ye']);

const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/;
const STREET_RE =
  /\b\d{1,5}\s+(?:[a-z]+\s){1,3}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|place|pl)\b/i;
/** Phrases that tie personal data to a person ("his ip is …", "she lives at …", "dox"). */
const PERSON_DOX_RE =
  /\b(?:his|her|their|your|ur|this\s+(?:guy|kid|girl|dude)(?:'?s)?)\s+(?:ip|ip\s+address|address|home\s+address|real\s+name|phone(?:\s+number)?|location)\b|\bdox+(?:ed|ing)?\b|\b(?:he|she|they)\s+lives?\s+(?:at|on)\b/i;
const DATA_WORD_RE = /\b(?:ip|address|lives?|phone|number)\b/i;
const PRIVATE_IP_RE = /^(?:10\.|127\.|0\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/;

/** True when the message is phrased at someone ("you're a …") even without a mention. */
export function isSecondPerson(ctx: DetectorContext): boolean {
  return (ctx.normalized.variants[0]?.tokens ?? []).some(
    (t) => SECOND_PERSON.has(t.c1) || SECOND_PERSON.has(t.text),
  );
}

const bump = (severity: number): Severity => Math.min(5, severity + 1) as Severity;

/** Harassment: hostile words aimed at a person, threats, doxxing, repeated targeting. */
export function detectHarassment(
  input: MessageInput,
  hits: readonly WordHit[],
  ctx: DetectorContext,
): Violation[] {
  const cfg = ctx.config.harassment;
  if (!cfg.enabled) return [];
  const out: Violation[] = [];
  const targeted = input.targetUserIds.length > 0 || isSecondPerson(ctx);

  if (cfg.targetedInsults && targeted) {
    const hostile = hits.filter((h) => HOSTILE_CATEGORIES.has(h.entry.category));
    if (hostile.length > 0) {
      const top = Math.max(...hostile.map((h) => h.entry.severity));
      out.push({
        detector: 'harassment',
        category: 'targeted',
        severity: bump(top),
        reason: 'Targeted harassment',
        evidence: hostile.map((h) => h.evidence).slice(0, 5),
        flags: ['targeted'],
      });
    }
  }

  if (cfg.threats && targeted) {
    const threats = hits.filter((h) => THREAT_CATEGORIES.has(h.entry.category));
    if (threats.length > 0) {
      out.push({
        detector: 'harassment',
        category: 'threat',
        severity: bump(Math.max(...threats.map((h) => h.entry.severity))),
        reason: 'Threat aimed at a member',
        evidence: threats.map((h) => h.evidence).slice(0, 5),
        flags: ['targeted', 'threat'],
      });
    }
  }

  if (cfg.dox) {
    const text = input.content;
    const ip = IPV4_RE.exec(text)?.[0];
    const personalData =
      (ip && !PRIVATE_IP_RE.test(ip) ? ip : null) ?? STREET_RE.exec(text)?.[0] ?? PHONE_RE.exec(text)?.[0];
    const aboutPerson =
      PERSON_DOX_RE.test(text) || (input.targetUserIds.length > 0 && DATA_WORD_RE.test(text));
    if (personalData && aboutPerson) {
      out.push({
        detector: 'harassment',
        category: 'dox',
        severity: 4,
        reason: 'Sharing personal information (doxxing)',
        evidence: ['[redacted personal data]'],
        flags: ['dox'],
      });
    }
  }

  if (input.targetUserIds.length > 0) {
    const windowStart = ctx.now - cfg.repeatedTargeting.windowSeconds * 1000;
    for (const target of input.targetUserIds) {
      const previous = ctx.history.filter(
        (m: RecentMessage) => m.at >= windowStart && m.hostile && m.targets.includes(target),
      ).length;
      const current = hits.some((h) => HOSTILE_CATEGORIES.has(h.entry.category)) ? 1 : 0;
      if (current && previous + current >= cfg.repeatedTargeting.count) {
        out.push({
          detector: 'harassment',
          category: 'repeated',
          severity: 3,
          reason: 'Repeatedly targeting a member',
          evidence: [`<@${target}> ×${previous + current}`],
          flags: ['targeted'],
        });
        break;
      }
    }
  }

  return out.sort((a, b) => b.severity - a.severity).slice(0, 2);
}
