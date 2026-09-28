import { describe, expect, it } from 'vitest';
import { applyLeet, collapse1, collapse2, foldText, normalize, normalizeTerm } from './normalize.js';

const display = (s: string) => normalize(s).display;

describe('foldText', () => {
  it('folds fullwidth, math and circled letters (NFKC)', () => {
    expect(foldText('ｆｕｃｋ').text).toBe('fuck');
    expect(foldText('𝐟𝐮𝐜𝐤').text).toBe('fuck');
    expect(foldText('ⓕⓤⓒⓚ').text).toBe('fuck');
  });

  it('maps Cyrillic / Greek homoglyphs', () => {
    expect(foldText('fцck').text).toBe('fuck');
    expect(foldText('ѕhіt').text).toBe('shit');
    expect(foldText('ΗΕLLΟ').text).toBe('hello');
  });

  it('maps emoji letters and small caps', () => {
    expect(foldText('🅵🆄🅲🅺').text).toBe('fuck');
    expect(foldText('🇫🇺🇨🇰').text).toBe('fuck');
    expect(foldText('ꜰᴜᴄᴋ').text.replace('ꜰ', 'f')).toBe('fuck');
  });

  it('strips invisible characters and zalgo', () => {
    expect(foldText('f​u‍c⁠k').text).toBe('fuck');
    expect(foldText('f̷̢̛u̸͉͊c̵̰̈k̶̳͝').text).toBe('fuck');
    expect(foldText('crème brûlée').text).toBe('creme brulee');
  });

  it('respects disabled stages', () => {
    expect(
      foldText('fцck', {
        unicode: true,
        invisible: true,
        zalgo: true,
        confusables: false,
        leetspeak: true,
        separators: true,
        repetition: true,
      }).text,
    ).toBe('fцck');
  });
});

describe('leetspeak', () => {
  it('reads digits only inside words', () => {
    expect(applyLeet('sh1t').primary).toBe('shit');
    expect(applyLeet('2024').primary).toBe('2024');
    expect(applyLeet('n1gg3r').primary).toBe('nigger');
  });

  it('reads symbols in the middle and @/$ at the start', () => {
    expect(applyLeet('$h!t').primary).toBe('shit');
    expect(applyLeet('@ss').primary).toBe('ass');
    expect(applyLeet('hello!').primary).toBe('hello!');
    expect(applyLeet('(um)').primary).toBe('(um)');
    expect(applyLeet('a$$').primary).toBe('ass');
    expect(applyLeet('a$$hole').primary).toBe('asshole');
    expect(applyLeet('b!tch').primary).toBe('bitch');
  });

  it('offers an alternate reading for ambiguous characters', () => {
    const r = applyLeet('ki11');
    expect(r.primary).toBe('kiii');
    expect(r.alternate).toBe('kill');
  });
});

describe('normalize', () => {
  it('joins single-letter runs', () => {
    expect(display('f u c k you')).toBe('fuck you');
    expect(display('f.u.c.k')).toBe('fuck');
    expect(display('f_u_c_k')).toBe('fuck');
  });

  it('collapses repetition', () => {
    expect(collapse1('fuuuuck')).toBe('fuck');
    expect(collapse2('fuuuuck')).toBe('fuuck');
    expect(display('fuuuuuck')).toBe('fuck');
  });

  it('ignores mentions, urls and keeps custom emoji names', () => {
    const n = normalize('<@123456789012345678> hi <:bitch:123456789012345678> https://x.com/shit');
    expect(n.display).toBe('hi bitch');
  });

  it('keeps chunk offsets aligned with the original', () => {
    const text = 'hello   w0rld';
    const n = normalize(text);
    expect(n.chunks.map((c) => text.slice(c.start, c.end))).toEqual(['hello', 'w0rld']);
  });

  it('produces an alternate variant for ambiguous leet', () => {
    const n = normalize('k1ll yourself');
    expect(n.variants).toHaveLength(2);
    expect(n.variants[0]!.tokens.map((t) => t.text)).toEqual(['kill', 'yourself']);
    expect(n.variants[1]!.tokens.map((t) => t.text)).toEqual(['klll', 'yourself']);
  });

  it('normalizes terms the same way as messages', () => {
    expect(normalizeTerm('Kill Yourself')).toMatchObject({
      text: 'kill yourself',
      c1: 'kil yourself',
      words: 2,
    });
    expect(normalizeTerm('nigger').c1).toBe('niger');
  });
});
