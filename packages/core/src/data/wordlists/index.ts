import type { WordCategory } from '@quill/shared/wordlists';
import { parseWordlist } from '../../wordlist/parse.js';
import type { WordEntry } from '../../wordlist/types.js';
import drugs from './drugs.js';
import extremism from './extremism.js';
import insult from './insult.js';
import profanity from './profanity.js';
import selfHarm from './self_harm.js';
import sexual from './sexual.js';
import slurAbleist from './slur_ableist.js';
import slurLgbtq from './slur_lgbtq.js';
import slurRacial from './slur_racial.js';
import violence from './violence.js';

/** Raw sources per category (see wordlist/parse.ts for the format). */
export const WORDLIST_SOURCES: Record<WordCategory, string> = {
  profanity,
  sexual,
  slur_racial: slurRacial,
  slur_lgbtq: slurLgbtq,
  slur_ableist: slurAbleist,
  insult,
  self_harm: selfHarm,
  violence,
  extremism,
  drugs,
};

let cache: WordEntry[] | null = null;

/** Every built-in entry (parsed once, then cached). */
export function builtinWordlist(): WordEntry[] {
  if (!cache) {
    cache = (Object.keys(WORDLIST_SOURCES) as WordCategory[]).flatMap((category) =>
      parseWordlist(category, WORDLIST_SOURCES[category]),
    );
  }
  return cache;
}
