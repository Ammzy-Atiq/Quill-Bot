import { DEFAULT_GUILD_CONFIG, TEMPLATE_KEYS } from '@quill/shared';
import type { Guild, GuildMember, Message } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { actionFromOptions } from '../src/lib/actions.js';
import { automodLogCard } from '../src/modules/automod/cards.js';
import { automodPanel } from '../src/modules/automod/panel.js';
import { assertV2 } from '../src/ui/limits.js';
import { fillTemplate, renderTemplate } from '../src/ui/templates.js';

const app = { logo: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } as unknown as App;
const guild = { id: '100000000000000001', name: 'Test Server' } as unknown as Guild;

describe('AutoMod UI stays within Components V2 limits', () => {
  it('panel', () => {
    const stats = assertV2([automodPanel(app, guild, '200000000000000001', DEFAULT_GUILD_CONFIG)]);
    expect(stats.components).toBeLessThanOrEqual(40);
  });

  it('log card with many violations and a long message', () => {
    const member = {
      id: '200000000000000001',
      user: { tag: 'someone', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png' },
    } as unknown as GuildMember;
    const message = {
      channelId: '300000000000000001',
      url: 'https://discord.com/channels/1/2/3',
      content: 'x'.repeat(3000),
      createdAt: new Date(),
    } as unknown as Message<true>;
    const violations = Array.from({ length: 8 }, (_, i) => ({
      detector: 'words' as const,
      category: 'insult',
      severity: 3 as const,
      reason: `Reason ${i}`,
      evidence: ['a'.repeat(200), 'b', 'c', 'd', 'e'],
      flags: [],
    }));
    expect(() =>
      assertV2([
        automodLogCard({
          message,
          member,
          violations,
          shadow: false,
          deleted: true,
          action: { label: 'Timeout 1h', ok: false, error: 'the member is above QUILL' },
          risk: { before: 10, after: 40, added: 30 },
          caseNumber: 12,
          ai: 'flagged · harassment · 91%',
        }),
      ]),
    ).not.toThrow();
  });

  it.each(TEMPLATE_KEYS)('template %s renders', (key) => {
    const container = renderTemplate(app, DEFAULT_GUILD_CONFIG, key, {
      server: 'Test',
      user: '<@1>',
      reason: 'test',
      action: 'Timeout 1h',
      case: 1,
      channel: '<#1>',
      duration: '15m',
      score: 30,
      detector: 'words',
    });
    expect(() => assertV2([container])).not.toThrow();
  });
});

describe('helpers', () => {
  it('fills template variables and keeps unknown ones', () => {
    expect(fillTemplate('Hi {user}, {unknown} in {server}', { user: 'Bob', server: 'QG' })).toBe(
      'Hi Bob, {unknown} in QG',
    );
  });

  it('builds actions from options', () => {
    expect(actionFromOptions('timeout', '2h')).toEqual({ type: 'timeout', durationSeconds: 7200 });
    expect(actionFromOptions('ban', '1d')).toEqual({ type: 'ban', deleteMessageSeconds: 86_400 });
    expect(actionFromOptions('kick')).toEqual({ type: 'kick' });
    expect(() => actionFromOptions('timeout', 'soon')).toThrow();
  });
});
