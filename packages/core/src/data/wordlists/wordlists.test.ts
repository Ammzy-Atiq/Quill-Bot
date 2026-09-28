import { DEFAULT_ENABLED_WORD_CATEGORIES } from '@quill/shared/wordlists';
import { describe, expect, it } from 'vitest';
import { WordMatcher } from '../../matcher/word-matcher.js';
import { normalize } from '../../normalizer/normalize.js';
import { builtinWordlist } from './index.js';

const entries = builtinWordlist();
const matcher = new WordMatcher(entries);
const enabled = new Set<string>(DEFAULT_ENABLED_WORD_CATEGORIES);

/** Mirrors the default server config: default categories, severity ≥ 2. */
const defaultHits = (text: string) =>
  matcher
    .match(normalize(text), { filter: (e) => enabled.has(e.category) && e.severity >= 2 })
    .map((h) => `${h.entry.category}:${h.entry.term}`);

describe('built-in word lists', () => {
  it('ship more than 2000 terms across every category', () => {
    expect(entries.length).toBeGreaterThanOrEqual(2000);
    const categories = new Set(entries.map((e) => e.category));
    expect(categories.size).toBe(10);
  });

  it('have unique ids', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('default filter — no false positives on everyday chat', () => {
  const benign = [
    'I passed the class with an A, what an assignment',
    'We visited Scunthorpe and Essex last summer',
    'My therapist recommended grape juice and grapefruit',
    'The cocktail party was near the canal',
    'Hancock wrote an analysis of the document',
    'Look at that peacock in the cockpit photo',
    'shiitake mushrooms are great in soup',
    'Niger and Nigeria are neighbours',
    'He let out a snigger at the despicable villain',
    'The raccoon crawled out of the cocoon, said the tycoon',
    'Charles Dickens wrote Great Expectations',
    'button, butter, basement and bass guitar',
    'Pass the ball and press the button',
    'cucumber salad and a cumulative score',
    'the constitution and the title of the arsenal',
    'as I said, but why?',
    'ok kk see you tomorrow',
    'this hit hard, his hit was great',
    'I will kill this boss in one try',
    'gg ez that was a fun round',
    'my cat is so fluffy',
    'Homo sapiens evolved in Africa',
    'He is from Pakistan and she is from Japan',
    'Spice Girls were popular in the 90s',
    'the rapper dropped a new album',
    'please scrape the paint and drape the cloth',
    'I need to analyse the anal­ysis results', // soft hyphen inside a word
    'Let us grab a drink at the pub',
    'the knob on the door is broken',
    'Check out my new mongodb cluster',
    'That movie was a total bomb at the box office',
    'kill the process and restart the server',
    'she shot the photo with a fast shutter',
    'I am so dead after that exam lol',
    'the stupid printer jammed again',
    'That was a sick play',
    'I want to die of laughter',
    'what the hell is going on',
    'He is an idiot sometimes, haha',
    'nice! (um) I think that works',
    'email me at test@example.com',
    '2024-05-01 at 3pm',
    'Classic assassin build with the grass skin',
    'I love coffee and croissants',
    'the queen of england',
    'can we get a cracker and some cheese',
    'drag the slider to 69 percent',
  ];

  it.each(benign)('%s', (text) => {
    expect(defaultHits(text)).toEqual([]);
  });
});

describe('default filter — catches abuse and evasion', () => {
  const abusive: Array<[string, string]> = [
    ['you are a n1gg3r', 'slur_racial'],
    ['f.a.g.g.o.t', 'slur_lgbtq'],
    ['ｒｅｔａｒｄ', 'slur_ableist'],
    ['kys', 'self_harm'],
    ['k y s', 'self_harm'],
    ['go kill yourself', 'self_harm'],
    ['i know where you live', 'violence'],
    ['heil hitler', 'extremism'],
    ['send nudes', 'sexual'],
    ['you are worthless', 'insult'],
    ['trаnny', 'slur_lgbtq'], // Cyrillic а
    ['s p i c', 'slur_racial'],
    ['1488', 'extremism'],
    ['shoot up the school', 'violence'],
  ];

  it.each(abusive)('%s → %s', (text, category) => {
    expect(defaultHits(text).some((h) => h.startsWith(`${category}:`))).toBe(true);
  });
});
