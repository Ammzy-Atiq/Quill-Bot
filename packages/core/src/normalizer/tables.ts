/**
 * Character tables for the normalizer.
 *
 * NFKC already folds fullwidth letters, mathematical alphanumerics, most enclosed/circled
 * letters, superscripts and ligatures. These tables cover what NFKC leaves behind:
 * cross-script homoglyphs (Cyrillic, Greek, Armenian, Cherokee…), small capitals, IPA and
 * "upside-down" letters, and emoji letter blocks.
 */

/** Target letter → characters that look like it (case-sensitive; applied before lowercasing). */
const CONFUSABLE_GROUPS: Record<string, string> = {
  a: 'АаɑαΑᴀɐⱥꭺᎪ∀ąǎȁȃ',
  b: 'ВвʙβΒƀɓᏴᗷƄЬьЪъ',
  c: 'СсϲᴄⅽⲥꮯᏟϹƈςℂ¢',
  d: 'ԁᴅⅾɗᎠᗪƊđ',
  e: 'ЕеЁёεΕᴇɛǝɘꭼᎬЄєƐ',
  f: 'ғϝƒꞙᖴ',
  g: 'ɡɢԌԍᏀɠǥ',
  h: 'НнΗһʜᎻᕼɦħ',
  i: 'ІіΙιɪӀӏᎥⅰǀ¡ıɨ',
  j: 'ЈјʝᎫϳ',
  k: 'КкΚκᴋᏦƙⱪ',
  l: 'ʟⅼℓᏞḷłƚ',
  m: 'МмΜᴍⅿᎷɱ',
  n: 'ΝηɴՌռᏁℕπΠ',
  o: 'ОоΟοᴏօՕ০੦ଠ๐ⲟᎾσø◯○⭕',
  p: 'РрΡρᴘᏢƿþ',
  q: 'ԛԚզǫɋ',
  r: 'ʀгГᏒɾɍꭱя',
  s: 'ЅѕꜱՏᏚƽʂ',
  t: 'ТтΤτᴛᎢƭŧ',
  u: 'υսᴜμЦцʋ∪ᑌ',
  v: 'ѵνᴠⅴᏙᐯ∨',
  w: 'ԜԝᴡωѡᎳ',
  x: 'ХхΧχⅹ×ᕁ',
  y: 'УуΥүҮʏγᎩƴ',
  z: 'ΖᴢᏃȥʐ',
};

/** Upside-down letters (ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz) mapped to the letter they depict. */
const UPSIDE_DOWN: Record<string, string> = {
  ɟ: 'f',
  ƃ: 'g',
  ɥ: 'h',
  ᴉ: 'i',
  ɾ: 'j',
  ʞ: 'k',
  ɹ: 'r',
  ʇ: 't',
  ʌ: 'v',
  ʍ: 'w',
  ʎ: 'y',
  ɔ: 'c',
  ɯ: 'm',
};

export const CONFUSABLES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [target, chars] of Object.entries(CONFUSABLE_GROUPS)) {
    for (const ch of chars) map.set(ch, target);
  }
  for (const [ch, target] of Object.entries(UPSIDE_DOWN)) map.set(ch, target);
  // Emoji letter blocks NFKC does not decompose.
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    map.set(String.fromCodePoint(0x1f1e6 + i), letter); // regional indicators 🇦–🇿
    map.set(String.fromCodePoint(0x1f170 + i), letter); // negative squared 🅰–🆉
    map.set(String.fromCodePoint(0x1f150 + i), letter); // negative circled 🅐–🅩
  }
  return map;
})();

/**
 * Leetspeak substitutions. The first letter is the primary reading; a second letter
 * (for ambiguous characters like `1`, `!`, `|`) produces an alternate variant.
 */
export const LEET: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['0', ['o']],
  ['1', ['i', 'l']],
  ['3', ['e']],
  ['4', ['a']],
  ['5', ['s']],
  ['6', ['g']],
  ['7', ['t']],
  ['8', ['b']],
  ['9', ['g']],
  ['@', ['a']],
  ['$', ['s']],
  ['!', ['i', 'l']],
  ['|', ['l', 'i']],
  ['+', ['t']],
  ['€', ['e']],
  ['¥', ['y']],
  ['(', ['c']],
  ['<', ['c']],
]);

/** Leet characters that are digits (mapped whenever the chunk contains a letter). */
export const LEET_DIGITS = new Set(['0', '1', '3', '4', '5', '6', '7', '8', '9']);

/**
 * Invisible / formatting characters removed before matching:
 * soft hyphen, combining grapheme joiner, Mongolian vowel separator, zero-width chars,
 * word joiner & invisible operators, bidi controls, BOM, variation selectors, Hangul fillers,
 * braille blank, tag characters, interlinear annotations.
 */
export const INVISIBLE_RE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: each code point (CGJ, Khmer inherent vowels, variation selectors) is removed on its own, never combined
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** Combining marks (diacritics, Zalgo). */
export const COMBINING_RE = /\p{M}/gu;

/** Discord syntax removed before word matching (mentions, channels, roles, timestamps, slash cmds). */
export const DISCORD_SYNTAX_RE = /<(?:@[!&]?\d{17,20}|#\d{17,20}|t:\d+(?::[tTdDfFR])?|\/[\w -]+:\d{17,20})>/g;

/** Custom emoji `<:name:id>` / `<a:name:id>` → keep the name (people hide words in emoji names). */
export const CUSTOM_EMOJI_RE = /<a?:(\w{2,32}):\d{17,20}>/g;

export const URL_RE = /\bhttps?:\/\/[^\s<>]+/gi;
