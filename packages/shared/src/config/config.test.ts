import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GUILD_CONFIG,
  getAtPath,
  parseGuildConfig,
  setAtPath,
  unsetAtPath,
  validateGuildConfig,
} from './index.js';

describe('guild config', () => {
  it('expands an empty config with defaults', () => {
    const { config, invalidModules } = parseGuildConfig({});
    expect(invalidModules).toEqual([]);
    expect(config.automod.enabled).toBe(true);
    expect(config.automod.words.categories.slur_racial.enabled).toBe(true);
    expect(config.automod.words.categories.profanity.enabled).toBe(false);
    expect(config.automod.scam.response.immediate).toEqual({ type: 'timeout', durationSeconds: 86_400 });
    expect(config.antinuke.enabled).toBe(false);
    expect(config.antinuke.mode).toBe('strict');
    expect(config.antinuke.modules.channel_delete.limit).toBe(2);
    expect(config.risk.ladder.length).toBeGreaterThan(0);
    expect(config.verification.mode).toBe('oauth');
  });

  it('keeps nested defaults when a parent object is partially provided', () => {
    const { config } = parseGuildConfig({ automod: { scam: { enabled: false } } });
    expect(config.automod.scam.enabled).toBe(false);
    expect(config.automod.scam.response.immediate).toEqual({ type: 'timeout', durationSeconds: 86_400 });
    expect(config.automod.spam.enabled).toBe(true);
  });

  it('falls back to defaults for an invalid module only', () => {
    const { config, invalidModules } = parseGuildConfig({
      automod: { spam: { maxMentions: -5 } },
      antinuke: { enabled: true },
    });
    expect(invalidModules).toEqual(['automod']);
    expect(config.automod.spam.maxMentions).toBe(DEFAULT_GUILD_CONFIG.automod.spam.maxMentions);
    expect(config.antinuke.enabled).toBe(true);
  });

  it('sorts the risk ladder by threshold', () => {
    const { config } = parseGuildConfig({
      risk: {
        ladder: [
          { threshold: 50, action: { type: 'kick' } },
          { threshold: 5, action: { type: 'warn' } },
        ],
      },
    });
    expect(config.risk.ladder.map((s) => s.threshold)).toEqual([5, 50]);
  });

  it('edits sparse configs by path', () => {
    let raw: Record<string, unknown> = {};
    raw = setAtPath(raw, ['automod', 'spam', 'enabled'], false);
    expect(getAtPath(raw, ['automod', 'spam', 'enabled'])).toBe(false);
    expect(validateGuildConfig(raw).ok).toBe(true);
    raw = unsetAtPath(raw, ['automod', 'spam', 'enabled']);
    expect(raw).toEqual({});
  });

  it('rejects invalid values with a readable error', () => {
    const result = validateGuildConfig({ antinuke: { punishment: 'explode' } });
    expect(result.ok).toBe(false);
  });
});
