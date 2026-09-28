import {
  evidenceFor,
  type NormalizedText,
  type NormalizedVariant,
  normalizeTerm,
  type TextView,
} from '../normalizer/normalize.js';
import type { WordEntry } from '../wordlist/types.js';
import { AhoCorasick } from './aho-corasick.js';

type ViewKey = 'raw' | 'c1' | 'c2' | 'compact';

interface Pattern {
  entry: WordEntry;
  view: ViewKey;
  /** Text searched for in the view (boundary views are padded with spaces). */
  needle: string;
  /**
   * When the term contains doubled letters, collapsing can turn it into an innocent word
   * (`nigger` → `niger`, `butt` → `but`, `boobs` → `bobs`). Hits whose tokens spell exactly
   * this innocent form are ignored.
   */
  excludeExact: string | null;
}

export interface WordHit {
  entry: WordEntry;
  /** The part of the original message that triggered the hit. */
  evidence: string;
  /** How it was found: `raw`/`c1`/`c2` = whole word(s), `compact` = inside/across words, `regex`. */
  view: ViewKey | 'regex';
  /** True when the plain lowercase message did not contain the term (normalizer was needed). */
  obfuscated: boolean;
}

export interface MatchOptions {
  /** Return false to skip an entry (disabled category/term, severity floor…). */
  filter?: (entry: WordEntry) => boolean;
  /** Folded words that must never be flagged (server allowlist). */
  allowlist?: ReadonlySet<string>;
}

const MIN_COLLAPSED_LENGTH = 3;

function compile(entry: WordEntry): Pattern | null {
  const norm = normalizeTerm(entry.term);
  if (!norm.text) return null;
  if (entry.match === 'substring') {
    return norm.compact.length >= MIN_COLLAPSED_LENGTH
      ? { entry, view: 'compact', needle: norm.compact, excludeExact: null }
      : { entry, view: 'raw', needle: ` ${norm.text} `, excludeExact: null };
  }
  if (entry.match === 'exact') {
    return { entry, view: 'raw', needle: ` ${norm.text} `, excludeExact: null };
  }
  // boundary: prefer the fully collapsed form, fall back to c2, then exact.
  if (norm.c1 === norm.text) return { entry, view: 'c1', needle: ` ${norm.c1} `, excludeExact: null };
  if (norm.c1.replace(/ /g, '').length >= MIN_COLLAPSED_LENGTH) {
    return { entry, view: 'c1', needle: ` ${norm.c1} `, excludeExact: norm.c1 };
  }
  if (norm.c2 === norm.text) return { entry, view: 'c2', needle: ` ${norm.c2} `, excludeExact: null };
  if (norm.c2.replace(/ /g, '').length >= MIN_COLLAPSED_LENGTH) {
    return { entry, view: 'c2', needle: ` ${norm.c2} `, excludeExact: norm.c2 };
  }
  return { entry, view: 'raw', needle: ` ${norm.text} `, excludeExact: null };
}

function tokensInRange(view: TextView, start: number, end: number): number[] {
  const seen: number[] = [];
  for (let i = start; i < end; i++) {
    const t = view.tokenAt[i];
    if (t !== undefined && t >= 0 && seen[seen.length - 1] !== t) seen.push(t);
  }
  return seen;
}

/**
 * Multi-pattern word matcher. Build once per word list (built-in lists share one instance
 * across all servers; custom words get a small per-server instance), then call `match`.
 */
export class WordMatcher {
  private readonly patterns: Pattern[] = [];
  private readonly automata = new Map<ViewKey, { ac: AhoCorasick; index: number[] }>();
  private readonly regexes: Array<{ entry: WordEntry; re: RegExp }> = [];

  constructor(entries: readonly WordEntry[]) {
    for (const entry of entries) {
      if (entry.match === 'regex') {
        try {
          this.regexes.push({ entry, re: new RegExp(entry.term, 'iu') });
        } catch {
          // invalid custom regex: ignored (validated when the word is added)
        }
        continue;
      }
      const pattern = compile(entry);
      if (pattern) this.patterns.push(pattern);
    }
    const byView = new Map<ViewKey, number[]>();
    this.patterns.forEach((p, i) => {
      const list = byView.get(p.view) ?? [];
      list.push(i);
      byView.set(p.view, list);
    });
    for (const [view, index] of byView) {
      this.automata.set(view, { ac: new AhoCorasick(index.map((i) => this.patterns[i]!.needle)), index });
    }
  }

  get size(): number {
    return this.patterns.length + this.regexes.length;
  }

  match(normalized: NormalizedText, options: MatchOptions = {}): WordHit[] {
    const hits = new Map<string, WordHit>();
    const plain = normalized.original.toLowerCase();
    const allow = options.allowlist;

    normalized.variants.forEach((variant) => {
      for (const [view, { ac, index }] of this.automata) {
        const textView = variant[view];
        for (const m of ac.search(textView.text)) {
          const pattern = this.patterns[index[m.pattern]!]!;
          if (hits.has(pattern.entry.id)) continue;
          if (options.filter && !options.filter(pattern.entry)) continue;
          const tokens = tokensInRange(textView, m.start, m.end);
          if (tokens.length === 0) continue;
          if (!this.acceptSpan(variant, view, tokens)) continue;
          if (pattern.excludeExact !== null) {
            const spelled = tokens.map((t) => variant.tokens[t]!.text).join(' ');
            if (spelled === pattern.excludeExact) continue;
          }
          if (
            allow &&
            tokens.some((t) => allow.has(variant.tokens[t]!.c1) || allow.has(variant.tokens[t]!.text))
          ) {
            continue;
          }
          const evidence = evidenceFor(normalized, variant, tokens[0]!, tokens[tokens.length - 1]!);
          hits.set(pattern.entry.id, {
            entry: pattern.entry,
            evidence,
            view,
            obfuscated: !plain.includes(pattern.entry.term.toLowerCase()),
          });
        }
      }
    });

    if (this.regexes.length > 0) {
      const haystacks = [normalized.original, ...normalized.variants.map((v) => v.c1.text)];
      for (const { entry, re } of this.regexes) {
        if (hits.has(entry.id) || (options.filter && !options.filter(entry))) continue;
        for (const haystack of haystacks) {
          const found = re.exec(haystack);
          if (found) {
            hits.set(entry.id, {
              entry,
              evidence: found[0],
              view: 'regex',
              obfuscated: haystack !== normalized.original,
            });
            break;
          }
        }
      }
    }
    return [...hits.values()];
  }

  /**
   * Compact (substring) hits may span several tokens. Accept them only when the tokens came
   * from one original chunk (`fu.ck`, `f_u_c_k`) or are all tiny fragments (`fu ck`) — never
   * across normal words, so `this hit` does not become `shit`.
   */
  private acceptSpan(variant: NormalizedVariant, view: ViewKey, tokens: number[]): boolean {
    if (view !== 'compact' || tokens.length === 1) return true;
    const list = tokens.map((t) => variant.tokens[t]!);
    const sameChunk = list.every(
      (t) => t.chunkStart === list[0]!.chunkStart && t.chunkEnd === list[0]!.chunkEnd,
    );
    if (sameChunk) return true;
    return list.every((t) => [...t.text].length <= 2);
  }
}
