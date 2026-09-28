import type { CustomWordMatchMode, WordCategory } from '@quill/shared/wordlists';
import { type Severity, slugify, type WordEntry } from './types.js';

/**
 * Word list source format (easy for humans and agents to edit):
 *
 *   # comment
 *   @severity 3          ← applies to following lines
 *   @match boundary      ← exact | boundary | substring
 *   @lang en
 *   some term
 *   another term | s=4 | m=substring | lang=es     ← per-line overrides
 */
export function parseWordlist(category: WordCategory, source: string): WordEntry[] {
  let severity: Severity = 3;
  let match: CustomWordMatchMode = 'boundary';
  let lang = 'en';
  const entries: WordEntry[] = [];

  source.split('\n').forEach((rawLine, lineNo) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    if (line.startsWith('@')) {
      const [directive, value] = line.slice(1).split(/\s+/, 2);
      if (directive === 'severity') severity = toSeverity(value, lineNo);
      else if (directive === 'match') match = toMatch(value, lineNo);
      else if (directive === 'lang') lang = value ?? 'en';
      else throw new Error(`${category}:${lineNo + 1}: unknown directive @${directive}`);
      return;
    }
    const [termPart, ...options] = line.split('|').map((p) => p.trim());
    const term = termPart ?? '';
    let entrySeverity = severity;
    let entryMatch = match;
    let entryLang = lang;
    for (const option of options) {
      const [key, value] = option.split('=').map((p) => p.trim());
      if (key === 's') entrySeverity = toSeverity(value, lineNo);
      else if (key === 'm') entryMatch = toMatch(value, lineNo);
      else if (key === 'lang') entryLang = value ?? lang;
      else throw new Error(`${category}:${lineNo + 1}: unknown option ${key}`);
    }
    entries.push({
      id: `${category}:${slugify(term)}`,
      term,
      category,
      severity: entrySeverity,
      match: entryMatch,
      lang: entryLang,
    });
  });
  return entries;
}

function toSeverity(value: string | undefined, lineNo: number): Severity {
  const n = Number(value);
  if (![1, 2, 3, 4, 5].includes(n)) throw new Error(`line ${lineNo + 1}: severity must be 1–5`);
  return n as Severity;
}

function toMatch(value: string | undefined, lineNo: number): CustomWordMatchMode {
  if (value === 'exact' || value === 'boundary' || value === 'substring') return value;
  throw new Error(`line ${lineNo + 1}: match must be exact, boundary or substring`);
}
