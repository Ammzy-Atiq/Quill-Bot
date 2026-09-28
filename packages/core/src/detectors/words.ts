import { WORD_CATEGORY_LABELS, type WordCategory } from '@quill/shared/wordlists';
import type { WordHit } from '../matcher/word-matcher.js';
import { normalizeTerm } from '../normalizer/normalize.js';
import type { Severity, WordEntry } from '../wordlist/types.js';
import type { DetectorContext, Violation } from './types.js';

/** Normalized forms of the server allowlist (both folded and collapsed spellings). */
export function allowlistSet(words: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const word of words) {
    const n = normalizeTerm(word);
    if (n.text) set.add(n.text);
    if (n.c1) set.add(n.c1);
  }
  return set;
}

export function effectiveSeverity(entry: WordEntry, ctx: DetectorContext): Severity {
  if (entry.category === 'custom') return entry.severity;
  const override = ctx.config.words.categories[entry.category as WordCategory]?.severity;
  return (override ?? entry.severity) as Severity;
}

/** Runs the built-in + custom word matchers with the server's filters. */
export function findWordHits(ctx: DetectorContext): WordHit[] {
  const cfg = ctx.config.words;
  const disabled = new Set(cfg.disabledTermIds);
  const allowlist = allowlistSet(cfg.allowlist);
  const filter = (entry: WordEntry) => {
    if (disabled.has(entry.id)) return false;
    if (entry.category !== 'custom') {
      const category = cfg.categories[entry.category as WordCategory];
      if (!category?.enabled) return false;
    }
    return effectiveSeverity(entry, ctx) >= cfg.minSeverity;
  };
  const hits = ctx.builtin.match(ctx.normalized, { filter, allowlist });
  if (ctx.custom) hits.push(...ctx.custom.match(ctx.normalized, { filter, allowlist }));
  return hits;
}

/**
 * Word filter: one violation per message with the strongest hit.
 * Deliberate evasion (the plain text only matched after normalization) adds +1 severity.
 */
export function detectWords(hits: readonly WordHit[], ctx: DetectorContext): Violation | null {
  if (!ctx.config.words.enabled || hits.length === 0) return null;
  let top = hits[0]!;
  let topSeverity = effectiveSeverity(top.entry, ctx);
  for (const hit of hits) {
    const severity = effectiveSeverity(hit.entry, ctx);
    if (severity > topSeverity) {
      top = hit;
      topSeverity = severity;
    }
  }
  const obfuscated = hits.some((h) => h.obfuscated);
  const severity = Math.min(5, topSeverity + (obfuscated && topSeverity >= 2 ? 1 : 0)) as Severity;
  const label =
    top.entry.category === 'custom'
      ? 'Blocked word'
      : `Blocked word · ${WORD_CATEGORY_LABELS[top.entry.category as WordCategory]}`;
  return {
    detector: 'words',
    category: top.entry.category,
    severity,
    reason: obfuscated ? `${label} (filter evasion)` : label,
    evidence: [...new Set(hits.map((h) => h.evidence || h.entry.term))].slice(0, 10),
    flags: obfuscated ? ['obfuscated'] : [],
  };
}
