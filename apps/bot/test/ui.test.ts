import { ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { cid, lockedId, parseCid } from '../src/framework/custom-id.js';
import { Registry } from '../src/framework/registry.js';
import { formatDuration, parseDuration } from '../src/lib/format.js';
import { MODULES } from '../src/modules/index.js';
import { Card } from '../src/ui/card.js';
import { assertV2, measureV2, V2LimitError } from '../src/ui/limits.js';
import { confirmCard, errorCard } from '../src/ui/presets.js';

describe('Card (Components V2)', () => {
  it('never sets an accent colour', () => {
    const container = Card.create()
      .header({ title: 'Hello', thumbnail: 'https://example.com/logo.png', subtitle: 'World' })
      .text('Body')
      .buttons(new ButtonBuilder().setCustomId('qg:x:y').setLabel('Go').setStyle(ButtonStyle.Primary))
      .footer('footer')
      .build();
    const json = container.toJSON() as { accent_color?: number };
    expect(json.accent_color).toBeUndefined();
    expect(measureV2([container]).hasAccentColor).toBe(false);
  });

  it('counts nested components like Discord', () => {
    const container = Card.create()
      .header({ title: 'T', thumbnail: 'https://example.com/a.png' }) // section(1) + text(1) + thumbnail(1)
      .text('x') // 1
      .build(); // + container(1)
    expect(measureV2([container]).components).toBe(5);
  });

  it('rejects accent colours and oversized messages', () => {
    const coloured = new ContainerBuilder()
      .setAccentColor(0xff0000)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('x'));
    expect(() => assertV2([coloured])).toThrow(V2LimitError);
    const huge = Card.create().text('a'.repeat(2500)).text('b'.repeat(2500)).build();
    expect(() => assertV2([huge])).toThrow(/Too much text/);
  });

  it('builds preset cards within limits', () => {
    expect(() => assertV2([errorCard('Oops', 'Something failed')])).not.toThrow();
    expect(() =>
      assertV2([
        confirmCard({
          title: 'Sure?',
          body: 'Really',
          confirmId: 'qg:a:b',
          cancelId: 'qg:a:c',
          danger: true,
        }),
      ]),
    ).not.toThrow();
  });
});

describe('custom ids', () => {
  it('round-trips and locks to a user', () => {
    const id = lockedId('123456789012345678', 'setup', 'toggle', 'automod');
    expect(parseCid(id)).toEqual({ handlerId: 'setup:toggle', args: ['123456789012345678', 'automod'] });
    expect(parseCid('other:thing')).toBeNull();
  });

  it('rejects colons and long ids', () => {
    expect(() => cid('a', 'b', 'c:d')).toThrow();
    expect(() => cid('a', 'b', 'x'.repeat(120))).toThrow();
  });
});

describe('registry', () => {
  it('loads every module without duplicate commands or handlers', () => {
    const registry = new Registry(MODULES);
    const json = registry.commandJson();
    expect(json.length).toBeGreaterThan(0);
    for (const command of json) {
      expect(command.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(command.description.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('durations', () => {
  it('parses and formats', () => {
    expect(parseDuration('10m')).toBe(600);
    expect(parseDuration('1h30m')).toBe(5400);
    expect(parseDuration('2d')).toBe(172_800);
    expect(parseDuration('15')).toBe(900);
    expect(parseDuration('abc')).toBeNull();
    expect(formatDuration(5400)).toBe('1h 30m');
  });
});
