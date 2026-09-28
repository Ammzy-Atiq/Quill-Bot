import type { NormalizerConfig } from '@quill/shared/config';
import {
  COMBINING_RE,
  CONFUSABLES,
  CUSTOM_EMOJI_RE,
  DISCORD_SYNTAX_RE,
  INVISIBLE_RE,
  LEET,
  LEET_DIGITS,
  URL_RE,
} from './tables.js';

export type NormalizeOptions = NormalizerConfig;

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = {
  unicode: true,
  invisible: true,
  zalgo: true,
  confusables: true,
  leetspeak: true,
  separators: true,
  repetition: true,
};

/** A whitespace-delimited slice of the original message. */
export interface Chunk {
  text: string;
  start: number;
  end: number;
}

export interface Token {
  /** Folded token: NFKC, invisible/marks stripped, homoglyphs + leet mapped, lowercase. */
  text: string;
  /** Runs of 3+ identical characters collapsed to 2 (`fuuuck` → `fuuck`). */
  c2: string;
  /** Runs of 2+ identical characters collapsed to 1 (`fuuuck` → `fuck`). */
  c1: string;
  /** First and last chunk index the token came from (merged tokens can span chunks). */
  chunkStart: number;
  chunkEnd: number;
  /** True when produced by joining single letters (`f u c k`). */
  merged: boolean;
}

/** A searchable string plus a map from each character back to its token. */
export interface TextView {
  text: string;
  /** Token index for every character of `text` (-1 for separators). */
  tokenAt: Int32Array;
}

export interface NormalizedVariant {
  tokens: Token[];
  /** ` tok tok ` using folded tokens (exact matching). */
  raw: TextView;
  /** ` tok tok ` using c1 tokens. */
  c1: TextView;
  /** ` tok tok ` using c2 tokens. */
  c2: TextView;
  /** All tokens joined without separators, repetition-collapsed (substring matching). */
  compact: TextView;
}

export interface NormalizeStats {
  combiningMarks: number;
  invisibleChars: number;
  confusables: number;
  leet: number;
  mergedRuns: number;
}

export interface NormalizedText {
  original: string;
  chunks: Chunk[];
  /** Variant 0 uses the primary leet reading; variant 1 (if any) the alternate (`1` → `l`). */
  variants: NormalizedVariant[];
  /** Human readable normalized text (variant 0, c1 tokens). */
  display: string;
  stats: NormalizeStats;
}

const LETTER_RE = /\p{L}/u;
const WORDISH_RE = /[\p{L}\p{N}]/u;
const SPLIT_RE = /[^\p{L}\p{N}]+/u;
const WHITESPACE_CHUNK_RE = /\S+/gu;

export const collapse1 = (s: string) => s.replace(/(.)\1+/gu, '$1');
export const collapse2 = (s: string) => s.replace(/(.)\1{2,}/gu, '$1$1');

/** Same-length blanking keeps character offsets aligned with the original message. */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => ' '.repeat(m.length));
}

function preClean(text: string): string {
  let out = text.replace(CUSTOM_EMOJI_RE, (m, name: string) => ` ${name}`.padEnd(m.length, ' '));
  out = blank(out, DISCORD_SYNTAX_RE);
  out = blank(out, URL_RE);
  return out;
}

interface FoldResult {
  text: string;
  marks: number;
  invisible: number;
  confusables: number;
}

/** Unicode-level folding of one chunk (no leet yet). */
export function foldText(input: string, opts: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS): FoldResult {
  let s = input;
  let invisible = 0;
  let marks = 0;
  let confusables = 0;
  if (opts.unicode) s = s.normalize('NFKC');
  if (opts.invisible) {
    s = s.replace(INVISIBLE_RE, () => {
      invisible++;
      return '';
    });
  }
  if (opts.zalgo) {
    s = s.normalize('NFD').replace(COMBINING_RE, () => {
      marks++;
      return '';
    });
  }
  if (opts.confusables) {
    let mapped = '';
    for (const ch of s) {
      const target = CONFUSABLES.get(ch);
      if (target) {
        confusables++;
        mapped += target;
      } else mapped += ch;
    }
    s = mapped;
  }
  s = s.toLowerCase();
  if (opts.confusables) {
    let mapped = '';
    for (const ch of s) mapped += CONFUSABLES.get(ch) ?? ch;
    s = mapped;
  }
  return { text: s, marks, invisible, confusables };
}

const isAlnum = (ch: string | undefined) => ch !== undefined && WORDISH_RE.test(ch);

/**
 * Applies leetspeak to a folded chunk.
 * - digits are read as letters only when the chunk contains a letter (`2024` stays `2024`);
 * - runs of symbols are read as letters when they sit between word characters (`sh!t`,
 *   `a$$hole`), when `@`/`$` start a word (`@ss`, `$hit`), or for trailing `$` (`a$$`) —
 *   so ordinary punctuation (`hello!`, `(um)`) is left alone.
 * Returns the primary reading and, when ambiguous characters were used, an alternate reading.
 */
export function applyLeet(chunk: string): { primary: string; alternate: string | null; count: number } {
  if (!LETTER_RE.test(chunk)) return { primary: chunk, alternate: null, count: 0 };
  const chars = [...chunk];
  const use = new Array<boolean>(chars.length).fill(false);
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (!LEET.has(ch)) {
      i++;
      continue;
    }
    if (LEET_DIGITS.has(ch)) {
      use[i] = true;
      i++;
      continue;
    }
    // maximal run of leet symbols [i, j)
    let j = i;
    while (j < chars.length && LEET.has(chars[j]!) && !LEET_DIGITS.has(chars[j]!)) j++;
    const before = chars[i - 1];
    const after = chars[j];
    const run = chars.slice(i, j);
    const middle = isAlnum(before) && isAlnum(after);
    const leading = i === 0 && LETTER_RE.test(after ?? '') && run.every((c) => c === '@' || c === '$');
    const trailing = j === chars.length && isAlnum(before) && run.every((c) => c === '$');
    if (middle || leading || trailing) for (let k = i; k < j; k++) use[k] = true;
    i = j;
  }

  let primary = '';
  let alternate = '';
  let ambiguous = false;
  let count = 0;
  chars.forEach((ch, index) => {
    const readings = LEET.get(ch);
    if (use[index] && readings) {
      count++;
      primary += readings[0];
      if (readings.length > 1) {
        ambiguous = true;
        alternate += readings[1];
      } else alternate += readings[0];
    } else {
      primary += ch;
      alternate += ch;
    }
  });
  return { primary, alternate: ambiguous ? alternate : null, count };
}

function makeToken(text: string, chunkStart: number, chunkEnd: number, merged: boolean): Token {
  return { text, c2: collapse2(text), c1: collapse1(text), chunkStart, chunkEnd, merged };
}

/** Joins runs of ≥3 single-character tokens: `f u c k`, `f.u.c.k`, `n 1 g g a`. */
function mergeSingles(tokens: Token[]): { tokens: Token[]; runs: number } {
  const out: Token[] = [];
  let runs = 0;
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    while (j < tokens.length && [...tokens[j]!.text].length === 1) j++;
    if (j - i >= 3) {
      const text = tokens
        .slice(i, j)
        .map((t) => (LEET_DIGITS.has(t.text) ? (LEET.get(t.text)?.[0] ?? t.text) : t.text))
        .join('');
      out.push(makeToken(text, tokens[i]!.chunkStart, tokens[j - 1]!.chunkEnd, true));
      runs++;
      i = j;
    } else {
      out.push(tokens[i]!);
      i++;
    }
  }
  return { tokens: out, runs };
}

function boundaryView(tokens: Token[], pick: (t: Token) => string): TextView {
  let text = ' ';
  const owners: number[] = [-1];
  tokens.forEach((token, index) => {
    const value = pick(token);
    text += value;
    for (let k = 0; k < value.length; k++) owners.push(index);
    text += ' ';
    owners.push(-1);
  });
  return { text, tokenAt: Int32Array.from(owners) };
}

function compactView(tokens: Token[], collapse: boolean): TextView {
  let text = '';
  const owners: number[] = [];
  tokens.forEach((token, index) => {
    const value = collapse ? token.c1 : token.text;
    for (const unit of value.split('')) {
      if (collapse && text.length > 0 && text[text.length - 1] === unit) continue;
      text += unit;
      owners.push(index);
    }
  });
  return { text, tokenAt: Int32Array.from(owners) };
}

function buildVariant(tokens: Token[], opts: NormalizeOptions): NormalizedVariant {
  return {
    tokens,
    raw: boundaryView(tokens, (t) => t.text),
    c1: boundaryView(tokens, (t) => (opts.repetition ? t.c1 : t.text)),
    c2: boundaryView(tokens, (t) => (opts.repetition ? t.c2 : t.text)),
    compact: compactView(tokens, opts.repetition),
  };
}

/**
 * Normalizes a message for filtering. Pure and deterministic; runs in Node and browsers.
 *
 * Pipeline per whitespace chunk: NFKC → strip invisible characters → strip combining marks
 * (diacritics/Zalgo) → homoglyphs → lowercase → leetspeak → split on punctuation.
 * Then: join single-letter runs, build repetition-collapsed views.
 */
export function normalize(input: string, options: Partial<NormalizeOptions> = {}): NormalizedText {
  const opts = { ...DEFAULT_NORMALIZE_OPTIONS, ...options };
  const cleaned = preClean(input);
  const chunks: Chunk[] = [];
  const stats: NormalizeStats = {
    combiningMarks: 0,
    invisibleChars: 0,
    confusables: 0,
    leet: 0,
    mergedRuns: 0,
  };
  const primaryTokens: Token[] = [];
  const alternateTokens: Token[] = [];
  let hasAlternate = false;

  for (const match of cleaned.matchAll(WHITESPACE_CHUNK_RE)) {
    const start = match.index ?? 0;
    const text = input.slice(start, start + match[0].length);
    const chunkIndex = chunks.length;
    chunks.push({ text, start, end: start + match[0].length });

    const folded = foldText(match[0], opts);
    stats.combiningMarks += folded.marks;
    stats.invisibleChars += folded.invisible;
    stats.confusables += folded.confusables;

    let primary = folded.text;
    let alternate: string | null = null;
    if (opts.leetspeak) {
      const leet = applyLeet(folded.text);
      primary = leet.primary;
      alternate = leet.alternate;
      stats.leet += leet.count;
    }
    if (alternate !== null) hasAlternate = true;

    for (const part of primary.split(SPLIT_RE)) {
      if (part) primaryTokens.push(makeToken(part, chunkIndex, chunkIndex, false));
    }
    for (const part of (alternate ?? primary).split(SPLIT_RE)) {
      if (part) alternateTokens.push(makeToken(part, chunkIndex, chunkIndex, false));
    }
  }

  let tokensA = primaryTokens;
  let tokensB = alternateTokens;
  if (opts.separators) {
    const a = mergeSingles(primaryTokens);
    tokensA = a.tokens;
    stats.mergedRuns = a.runs;
    tokensB = mergeSingles(alternateTokens).tokens;
  }

  const variants = [buildVariant(tokensA, opts)];
  if (hasAlternate) variants.push(buildVariant(tokensB, opts));

  return {
    original: input,
    chunks,
    variants,
    display: tokensA.map((t) => (opts.repetition ? t.c1 : t.text)).join(' '),
    stats,
  };
}

/** Normalizes a single dictionary term exactly like message tokens (for building matchers). */
export function normalizeTerm(term: string, options: Partial<NormalizeOptions> = {}) {
  const result = normalize(term, { ...options, separators: false });
  const tokens = result.variants[0]?.tokens ?? [];
  const text = tokens.map((t) => t.text).join(' ');
  return {
    text,
    c1: tokens.map((t) => t.c1).join(' '),
    c2: tokens.map((t) => t.c2).join(' '),
    compact: result.variants[0]?.compact.text ?? '',
    words: tokens.length,
  };
}

/** Original message slice covered by tokens [from, to] of a variant. */
export function evidenceFor(
  normalized: NormalizedText,
  variant: NormalizedVariant,
  from: number,
  to: number,
) {
  const first = variant.tokens[from];
  const last = variant.tokens[to];
  if (!first || !last) return '';
  const a = normalized.chunks[first.chunkStart];
  const b = normalized.chunks[last.chunkEnd];
  if (!a || !b) return '';
  return normalized.original.slice(a.start, b.end);
}
