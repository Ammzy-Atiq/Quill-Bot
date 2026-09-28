import type { CustomWordMatchMode, WordCategory } from '@quill/shared/wordlists';

export type Severity = 1 | 2 | 3 | 4 | 5;

export interface WordEntry {
  /** Stable id: `<category>:<slug>` (used by `automod.words.disabledTermIds`). */
  id: string;
  term: string;
  category: WordCategory | 'custom';
  severity: Severity;
  /**
   * exact     – whole word, folded but never repetition-collapsed
   * boundary  – whole word/phrase, sees through repetition (`fuuuck`)
   * substring – anywhere, even inside other words and across separators (`motherfucker`, `fu.ck`)
   * regex     – custom words only
   */
  match: CustomWordMatchMode;
  /** ISO-639-1 language code or `multi`. */
  lang: string;
}

export function slugify(term: string): string {
  return term
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
