/** Small text helpers shared by the detectors (browser-safe, no dependencies). */

/** FNV-1a 32-bit hash as hex — stable across processes, good enough for duplicate detection. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const COMMON_TLDS =
  'com|net|org|gg|io|me|co|xyz|ru|info|link|shop|site|online|top|club|app|dev|ly|to|tk|ml|ga|cf|gq|cc|biz|us|uk|de|fr|in|pw|live|gift|gifts|store|fun|icu|click|vip|cloud|ws|su|lol|tv|am|fm|sh|so|ai|one|pro|xn--[a-z0-9-]+';

const URL_RE = /\bhttps?:\/\/[^\s<>()"'`]+/gi;
const BARE_DOMAIN_RE = new RegExp(
  `(?<![@\\p{L}\\p{N}_.-])((?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?\\.)+(?:${COMMON_TLDS}))(?![\\p{L}\\p{N}_-])(\\/[^\\s<>()"'\`]*)?`,
  'giu',
);

export interface FoundUrl {
  raw: string;
  /** Lowercase hostname without `www.`. */
  host: string;
  path: string;
}

/**
 * Parses host + path without the URL API, which would turn unicode hosts into punycode and
 * hide homograph attacks (`dіscord.com` with a Cyrillic `і`). Userinfo (`discord.com@evil.xyz`)
 * is skipped so the real host is reported.
 */
function toFound(raw: string): FoundUrl | null {
  const m = /^(?:https?:\/\/)?(?:[^@/?#\s]*@)?([^/:?#\s]+)(?::\d+)?([^?#\s]*)/i.exec(raw);
  if (!m?.[1]) return null;
  const host = m[1]
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!host.includes('.')) return null;
  return { raw, host, path: m[2] || '/' };
}

/** URLs with a scheme plus bare domains on common TLDs (`discord.gg/abc`, `free-nitro.xyz`). */
export function extractUrls(text: string): FoundUrl[] {
  const folded = text.normalize('NFKC');
  const found = new Map<string, FoundUrl>();
  for (const m of folded.matchAll(URL_RE)) {
    const url = toFound(m[0].replace(/[.,!?;:]+$/, ''));
    if (url) found.set(`${url.host}${url.path}`, url);
  }
  const withoutSchemes = folded.replace(URL_RE, ' ');
  for (const m of withoutSchemes.matchAll(BARE_DOMAIN_RE)) {
    const url = toFound(`${m[1]}${m[2] ?? ''}`);
    if (url) found.set(`${url.host}${url.path}`, url);
  }
  return [...found.values()];
}

/** Hosts that are / belong to Discord invite links. */
const INVITE_RES = [
  /discord(?:app)?\s*(?:\.|\(\.\)|\[\.\]|\s+dot\s+)\s*com\s*\/\s*invite\s*\/\s*([a-z0-9-]{2,32})/gi,
  /discord\s*(?:\.|\(\.\)|\[\.\]|\s+dot\s+|,)\s*(?:gg|io|me|li|link)\s*\/\s*([a-z0-9-]{2,32})/gi,
  /(?:dsc|invite)\s*\.\s*gg\s*\/\s*([a-z0-9-]{2,32})/gi,
];

/**
 * Discord invite codes, also when obfuscated: `discord . gg / code`, `discord(.)gg/code`,
 * `discord dot gg/code`, fullwidth characters, zero-width spaces.
 */
export function extractInviteCodes(text: string): string[] {
  const folded = text.normalize('NFKC').replace(/[​-‏⁠﻿]/g, '');
  const codes = new Set<string>();
  for (const re of INVITE_RES) {
    for (const m of folded.matchAll(re)) if (m[1]) codes.add(m[1]);
  }
  return [...codes];
}

export interface MaskedLink {
  text: string;
  url: string;
}

/** Markdown links `[text](url)`. */
export function extractMaskedLinks(text: string): MaskedLink[] {
  const out: MaskedLink[] = [];
  for (const m of text.matchAll(/\[([^\]\n]{1,200})\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/gi)) {
    out.push({ text: m[1]!, url: m[2]! });
  }
  return out;
}

export function countEmojis(text: string): number {
  const unicode = text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  const custom = text.match(/<a?:\w{2,32}:\d{17,20}>/g)?.length ?? 0;
  return unicode + custom;
}

/** Share of uppercase letters among letters (ignores mentions, emoji, URLs). */
export function capsRatio(text: string): { letters: number; ratio: number } {
  const cleaned = text.replace(/<[^>]+>/g, '').replace(/https?:\/\/\S+/g, '');
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return { letters: 0, ratio: 0 };
  const upper = letters.filter((ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase()).length;
  return { letters: letters.length, ratio: upper / letters.length };
}

export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, current[j - 1]! + 1, prev[j - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    prev = current;
  }
  return prev[b.length]!;
}

/** Hamming distance between two 64-bit hashes written as 16 hex chars. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i += 8) {
    let x = (Number.parseInt(a.slice(i, i + 8), 16) ^ Number.parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) {
      x &= x - 1;
      distance++;
    }
  }
  return distance;
}

export function hostMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return host === d || host.endsWith(`.${d}`);
}
