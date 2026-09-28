/** Built-in word list categories (packages/core/data/wordlists/<category>.json). */
export const WORD_CATEGORIES = [
  'profanity',
  'sexual',
  'slur_racial',
  'slur_lgbtq',
  'slur_ableist',
  'insult',
  'self_harm',
  'violence',
  'extremism',
  'drugs',
] as const;
export type WordCategory = (typeof WORD_CATEGORIES)[number];

export const WORD_CATEGORY_LABELS: Record<WordCategory, string> = {
  profanity: 'Profanity',
  sexual: 'Sexual content',
  slur_racial: 'Racial / ethnic / religious slurs',
  slur_lgbtq: 'LGBTQ+ slurs',
  slur_ableist: 'Ableist slurs',
  insult: 'Insults & harassment',
  self_harm: 'Self-harm encouragement',
  violence: 'Violence & threats',
  extremism: 'Extremism & hate',
  drugs: 'Drugs',
};

/** Categories enabled for a fresh server. */
export const DEFAULT_ENABLED_WORD_CATEGORIES: readonly WordCategory[] = [
  'sexual',
  'slur_racial',
  'slur_lgbtq',
  'slur_ableist',
  'insult',
  'self_harm',
  'violence',
  'extremism',
];

export const WORD_MATCH_MODES = ['exact', 'boundary', 'substring'] as const;
export type WordMatchMode = (typeof WORD_MATCH_MODES)[number];

/** Custom words may also be regular expressions. */
export const CUSTOM_WORD_MATCH_MODES = [...WORD_MATCH_MODES, 'regex'] as const;
export type CustomWordMatchMode = (typeof CUSTOM_WORD_MATCH_MODES)[number];
