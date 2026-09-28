/**
 * Validates the built-in word lists:
 *  - every entry parses, normalizes to something and has a unique id
 *  - no two entries compile to the same pattern (normalized duplicates)
 *  - `substring` entries never occur inside ordinary English words (Scunthorpe check)
 *  - reports boundary entries that could safely be upgraded to `substring`
 *  - prints counts per category
 *
 *   pnpm wordlist:validate            (exit code 1 on errors)
 *   pnpm wordlist:validate --suggest  (also list substring-upgrade candidates)
 */
import { createRequire } from 'node:module';
import { builtinWordlist } from '../src/data/wordlists/index.js';
import { collapse1, normalizeTerm } from '../src/normalizer/normalize.js';

const require = createRequire(import.meta.url);
const dictionary = require('an-array-of-english-words') as string[];

const entries = builtinWordlist();
const errors: string[] = [];
const warnings: string[] = [];

// 1. ids + normalization
const ids = new Map<string, string>();
const compiled = new Map<string, string>();
for (const entry of entries) {
  if (ids.has(entry.id)) errors.push(`duplicate id ${entry.id} ("${entry.term}" and "${ids.get(entry.id)}")`);
  ids.set(entry.id, entry.term);
  const norm = normalizeTerm(entry.term);
  if (!norm.text) {
    errors.push(`${entry.id}: normalizes to an empty string`);
    continue;
  }
  const key = `${entry.match}:${entry.match === 'substring' ? norm.compact : norm.c1}`;
  const previous = compiled.get(key);
  if (previous && !previous.startsWith(`${entry.category}:`)) {
    warnings.push(`${entry.id} duplicates ${previous} (same normalized pattern, different category)`);
  } else if (previous) {
    errors.push(`${entry.id} duplicates ${previous} (same normalized pattern)`);
  }
  compiled.set(key, entry.id);
}

// 2. Scunthorpe check for substring entries against the English dictionary
const dictCompact = dictionary.map((w) => ({ word: w, compact: collapse1(w.toLowerCase()) }));
const substringEntries = entries.filter((e) => e.match === 'substring');
for (const entry of substringEntries) {
  const needle = normalizeTerm(entry.term).compact;
  const victims = dictCompact.filter(
    (d) => d.compact.includes(needle) && !d.word.includes(entry.term.toLowerCase()),
  );
  const innocent = dictCompact.filter((d) => d.compact.includes(needle)).map((d) => d.word);
  // words that contain the literal term are usually inflections (fucking, bitchy) and fine;
  // anything else is a potential false positive
  if (victims.length > 0) {
    errors.push(
      `${entry.id}: substring "${needle}" appears inside innocent words: ${victims
        .slice(0, 8)
        .map((v) => v.word)
        .join(', ')}`,
    );
  } else if (innocent.length > 0) {
    warnings.push(
      `${entry.id}: also matches ${innocent.slice(0, 6).join(', ')}${innocent.length > 6 ? '…' : ''} (review)`,
    );
  }
}

// 3. suggestions
if (process.argv.includes('--suggest')) {
  const dictSet = dictCompact.map((d) => d.compact).join('\n');
  for (const entry of entries) {
    if (entry.match !== 'boundary') continue;
    const norm = normalizeTerm(entry.term);
    if (norm.words !== 1 || norm.compact.length < 4) continue;
    if (!dictSet.includes(norm.compact)) console.log(`suggest substring: ${entry.id}`);
  }
}

// 4. report
const counts = new Map<string, number>();
for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
console.log('\nQUILL GUARD word lists');
for (const [category, count] of counts) console.log(`  ${category.padEnd(14)} ${count}`);
console.log(`  ${'TOTAL'.padEnd(14)} ${entries.length}`);
const langs = new Map<string, number>();
for (const entry of entries) langs.set(entry.lang, (langs.get(entry.lang) ?? 0) + 1);
console.log(`  languages: ${[...langs].map(([l, n]) => `${l}=${n}`).join(' ')}`);

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✖ ${e}`);
if (errors.length > 0) {
  console.log(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log('\n✔ word lists valid');
