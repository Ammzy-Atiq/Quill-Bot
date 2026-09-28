import { describe, expect, it } from 'vitest';
import { normalize } from '../normalizer/normalize.js';
import type { WordEntry } from '../wordlist/types.js';
import { AhoCorasick } from './aho-corasick.js';
import { WordMatcher } from './word-matcher.js';

const entry = (
  term: string,
  match: WordEntry['match'] = 'boundary',
  severity: WordEntry['severity'] = 3,
): WordEntry => ({
  id: `test:${term}`,
  term,
  category: 'profanity',
  severity,
  match,
  lang: 'en',
});

const matcher = new WordMatcher([
  entry('fuck', 'substring'),
  entry('shit'),
  entry('nigger'),
  entry('ass'),
  entry('butt'),
  entry('kill yourself'),
  entry('kkk'),
  entry('cunt'),
]);

const found = (text: string) =>
  matcher
    .match(normalize(text))
    .map((h) => h.entry.term)
    .sort();

describe('AhoCorasick', () => {
  it('finds overlapping patterns', () => {
    const ac = new AhoCorasick(['he', 'she', 'his', 'hers']);
    const hits = ac.search('ushers').map((m) => ['he', 'she', 'his', 'hers'][m.pattern]);
    expect(hits.sort()).toEqual(['he', 'hers', 'she']);
  });
});

describe('WordMatcher — catches evasion', () => {
  it.each([
    ['fuck', ['fuck']],
    ['FUCK', ['fuck']],
    ['f u c k', ['fuck']],
    ['f.u.c.k', ['fuck']],
    ['fuuuuuck', ['fuck']],
    ['ｆｕｃｋ', ['fuck']],
    ['fцck', ['fuck']],
    ['f​uck', ['fuck']],
    ['motherfucker', ['fuck']],
    ['fu ck', ['fuck']],
    ['sh1t', ['shit']],
    ['$h!t', ['shit']],
    ['shiiiiit', ['shit']],
    ['n1gg3r', ['nigger']],
    ['niiiggger', ['nigger']],
    ['n i g g e r', ['nigger']],
    ['kys, k1ll y0urself', ['kill yourself']],
    ['kill   yourself', ['kill yourself']],
    ['a$$', ['ass']],
    ['asssss', ['ass']],
    ['KKK rally', ['kkk']],
  ])('%s', (text, expected) => {
    expect(found(text)).toEqual(expected);
  });
});

describe('WordMatcher — avoids false positives', () => {
  it.each([
    'I live in Scunthorpe',
    'this hit hard',
    'his hit was great',
    'Niger is a country in West Africa',
    'as I said before',
    'but why',
    'classic assassin grass',
    'ok kk',
    'the shiitake mushrooms',
    '(um) I think so',
    'hello! how are you',
  ])('%s', (text) => {
    expect(found(text)).toEqual([]);
  });
});

describe('WordMatcher — options', () => {
  it('filters entries and honours the allowlist', () => {
    const n = normalize('shit and ass');
    expect(matcher.match(n, { filter: (e) => e.term !== 'shit' }).map((h) => h.entry.term)).toEqual(['ass']);
    expect(matcher.match(n, { allowlist: new Set(['shit']) }).map((h) => h.entry.term)).toEqual(['ass']);
  });

  it('reports evidence from the original text and obfuscation', () => {
    const [hit] = matcher.match(normalize('you are a sh1t'));
    expect(hit?.evidence).toBe('sh1t');
    expect(hit?.obfuscated).toBe(true);
  });

  it('supports regex custom words', () => {
    const custom = new WordMatcher([{ ...entry('bad\\s*word'), match: 'regex', category: 'custom' }]);
    expect(custom.match(normalize('this is a bad   word')).length).toBe(1);
  });
});
