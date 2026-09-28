import { type AntiNukeConfig, type AntiRaidConfig, DEFAULT_GUILD_CONFIG } from '@quill/shared/config';
import { describe, expect, it } from 'vitest';
import { evaluateJoin, nameSkeleton } from '../antiraid/evaluate.js';
import { assessThreat, evaluateAntiNuke, resolveTrust } from './engine.js';
import { SCENARIOS, simulate } from './simulate.js';

const strict: AntiNukeConfig = { ...DEFAULT_GUILD_CONFIG.antinuke, enabled: true };
const threshold: AntiNukeConfig = { ...strict, mode: 'threshold' };

describe('resolveTrust', () => {
  const base = {
    ownerId: '1',
    botId: '2',
    extraOwners: new Set(['3']),
    whitelist: new Map([['4', new Set(['ban' as const])]]),
    action: 'ban' as const,
  };
  it('ranks owner, self, extra owner, whitelist, others', () => {
    expect(resolveTrust({ ...base, actorId: '1' })).toBe('owner');
    expect(resolveTrust({ ...base, actorId: '2' })).toBe('self');
    expect(resolveTrust({ ...base, actorId: '3' })).toBe('extra_owner');
    expect(resolveTrust({ ...base, actorId: '4' })).toBe('whitelisted');
    expect(resolveTrust({ ...base, actorId: '4', action: 'kick' })).toBe('untrusted');
    expect(resolveTrust({ ...base, actorId: '9' })).toBe('untrusted');
  });
});

describe('evaluateAntiNuke', () => {
  const input = (extra: Partial<Parameters<typeof evaluateAntiNuke>[0]> = {}) => ({
    action: 'channel_delete' as const,
    trust: 'untrusted' as const,
    config: strict,
    actionCount: 1,
    recent: [{ action: 'channel_delete' as const, at: 0 }],
    dangerous: false,
    raidMode: false,
    ...extra,
  });

  it('punishes the first unwhitelisted action in strict mode (Olympus)', () => {
    const d = evaluateAntiNuke(input());
    expect(d.punish).toBe(true);
    expect(d.punishment).toBe('ban');
    expect(d.revert).toBe(true);
  });

  it('never punishes the owner or QUILL itself', () => {
    expect(evaluateAntiNuke(input({ trust: 'owner', actionCount: 50 })).punish).toBe(false);
    expect(evaluateAntiNuke(input({ trust: 'self', actionCount: 50 })).punish).toBe(false);
  });

  it('respects limits in threshold mode and halves them in raid mode', () => {
    expect(evaluateAntiNuke(input({ config: threshold, actionCount: 2 })).punish).toBe(false);
    expect(evaluateAntiNuke(input({ config: threshold, actionCount: 3 })).punish).toBe(true);
    expect(evaluateAntiNuke(input({ config: threshold, actionCount: 2, raidMode: true })).punish).toBe(true);
  });

  it('lets whitelisted users act but catches betrayal (anti-betray)', () => {
    expect(evaluateAntiNuke(input({ trust: 'whitelisted', actionCount: 5 })).punish).toBe(false);
    const betray = evaluateAntiNuke(input({ trust: 'whitelisted', actionCount: 7 }));
    expect(betray.punish).toBe(true);
    expect(betray.reason).toMatch(/anti-betray/);
  });

  it('exempts extra owners unless monitored', () => {
    expect(evaluateAntiNuke(input({ trust: 'extra_owner', actionCount: 50 })).punish).toBe(false);
    const monitored = { ...strict, antiBetray: { ...strict.antiBetray, monitorExtraOwners: true } };
    expect(evaluateAntiNuke(input({ trust: 'extra_owner', actionCount: 50, config: monitored })).punish).toBe(
      true,
    );
  });

  it('punishes dangerous actions even under the limit (threshold mode)', () => {
    const d = evaluateAntiNuke(
      input({
        config: threshold,
        action: 'role_update',
        dangerous: true,
        recent: [{ action: 'role_update', at: 0, dangerous: true }],
      }),
    );
    expect(d.punish).toBe(true);
  });

  it('does nothing when anti-nuke or the module is disabled', () => {
    expect(evaluateAntiNuke(input({ config: { ...strict, enabled: false } })).punish).toBe(false);
    const off = {
      ...strict,
      modules: { ...strict.modules, channel_delete: { ...strict.modules.channel_delete, enabled: false } },
    };
    expect(evaluateAntiNuke(input({ config: off })).punish).toBe(false);
  });

  it('scores combined destructive activity higher', () => {
    const mixed = assessThreat(
      [
        { action: 'channel_delete', at: 0 },
        { action: 'role_delete', at: 1 },
        { action: 'ban', at: 2 },
      ],
      strict,
    );
    const single = assessThreat(
      [
        { action: 'channel_delete', at: 0 },
        { action: 'channel_delete', at: 1 },
        { action: 'channel_delete', at: 2 },
      ],
      strict,
    );
    expect(mixed.destructiveKinds).toBe(3);
    expect(mixed.score).toBeGreaterThan(single.score);
  });
});

describe('red-team simulations', () => {
  it.each(SCENARIOS.map((s) => s.key))('%s is caught on the first event in strict mode', (key) => {
    const scenario = SCENARIOS.find((s) => s.key === key)!;
    const result = simulate(scenario, strict);
    expect(result.caughtAt).toBe(1);
    expect(result.damageBeforeCatch).toBe(0);
  });

  it('threshold mode catches a channel wipe within the limit', () => {
    const result = simulate(SCENARIOS.find((s) => s.key === 'channel_wipe')!, threshold);
    expect(result.caughtAt).toBe(3); // limit 2 → the third deletion is punished
  });

  it('a compromised whitelisted admin is caught by anti-betray', () => {
    const result = simulate(SCENARIOS.find((s) => s.key === 'channel_wipe')!, strict, 'whitelisted');
    expect(result.caughtAt).not.toBeNull();
    expect(result.caughtAt!).toBeLessThanOrEqual(7);
  });

  it('a full nuke escalates to critical and triggers emergency mode', () => {
    const result = simulate(SCENARIOS.find((s) => s.key === 'full_nuke')!, strict);
    expect(result.peakThreat.level).toBe('critical');
    expect(result.emergencyAt).not.toBeNull();
  });
});

describe('anti-raid', () => {
  const cfg: AntiRaidConfig = {
    ...DEFAULT_GUILD_CONFIG.antiraid,
    enabled: true,
    minAccountAgeDays: 3,
    requireAvatar: true,
  };
  const join = (extra: Partial<Parameters<typeof evaluateJoin>[0]> = {}) =>
    evaluateJoin({
      config: cfg,
      now: Date.UTC(2026, 0, 10),
      joinsInWindow: 1,
      accountCreatedAt: Date.UTC(2020, 0, 1),
      hasAvatar: true,
      username: 'alice',
      recentJoinNames: [],
      raidModeActive: false,
      ...extra,
    });

  it('starts raid mode on a join spike', () => {
    expect(join({ joinsInWindow: 10 }).startRaid).toBe(true);
    expect(join({ joinsInWindow: 3 }).startRaid).toBe(false);
  });

  it('filters new, avatar-less and look-alike accounts', () => {
    expect(join({ accountCreatedAt: Date.UTC(2026, 0, 9) }).filtered).toBe(true);
    expect(join({ hasAvatar: false }).filtered).toBe(true);
    expect(join({ username: 'raider_123', recentJoinNames: ['raider_456', 'raider_789'] }).filtered).toBe(
      true,
    );
    expect(join().filtered).toBe(false);
  });

  it('skeletons usernames', () => {
    expect(nameSkeleton('Rаider_123')).toBe('raider');
  });
});
