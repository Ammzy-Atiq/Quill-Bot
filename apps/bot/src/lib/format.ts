import { TimestampStyles, time } from 'discord.js';

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Escapes markdown so user content can't break card formatting. */
export function escapeMd(text: string): string {
  return text.replace(/([\\*_`~|>#\-[\]()])/g, '\\$1');
}

/** Inline code with backticks neutralised. */
export function code(text: string): string {
  return `\`${text.replace(/`/g, 'ˋ')}\``;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const units: Array<[string, number]> = [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ];
  const parts: string[] = [];
  let rest = Math.floor(seconds);
  for (const [label, size] of units) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${label}`);
      rest %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/**
 * Parses durations like `10m`, `1h30m`, `2d`, `45s`, `1w`. Returns seconds or null.
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60; // bare number = minutes
  const re = /(\d+)\s*(w|d|h|m|s)/g;
  const factor: Record<string, number> = { w: 604_800, d: 86_400, h: 3_600, m: 60, s: 1 };
  let total = 0;
  let consumed = '';
  for (const match of trimmed.matchAll(re)) {
    total += Number(match[1]) * factor[match[2]!]!;
    consumed += match[0];
  }
  if (total === 0 || consumed.replace(/\s/g, '') !== trimmed.replace(/\s/g, '')) return null;
  return total;
}

export const relative = (date: Date | number) =>
  time(date instanceof Date ? date : new Date(date), TimestampStyles.RelativeTime);
export const fullDate = (date: Date | number) =>
  time(date instanceof Date ? date : new Date(date), TimestampStyles.LongDateTime);

export function pluralize(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}

/** Snowflake → creation date. */
export function snowflakeDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
}
