import { DEFAULT_GUILD_CONFIG, type VerificationConfig } from '@quill/shared/config';
import { describe, expect, it } from 'vitest';
import { evaluateVerification, type LinkedAccount, scoreIdentityLink } from './evaluate.js';

const base: VerificationConfig = DEFAULT_GUILD_CONFIG.verification;
const OLD = new Date(Date.UTC(2020, 0, 1));
const link = (extra: Partial<LinkedAccount>): LinkedAccount => ({
  userId: '200000000000000001',
  confidence: 0.9,
  bannedHere: false,
  punishedHere: false,
  networkBans: 0,
  ...extra,
});
const input = (extra: Partial<Parameters<typeof evaluateVerification>[0]> = {}) => ({
  userId: '100000000000000001',
  accountCreatedAt: OLD,
  config: base,
  whitelisted: false,
  isProxy: false,
  linked: [] as LinkedAccount[],
  ...extra,
});

describe('scoreIdentityLink', () => {
  it('ranks device matches above shared IPs', () => {
    const device = scoreIdentityLink(['device'], { isProxy: false, lastSeenDaysAgo: 1 });
    const ip = scoreIdentityLink(['ip'], { isProxy: false, lastSeenDaysAgo: 1 });
    const both = scoreIdentityLink(['device', 'ip'], { isProxy: false, lastSeenDaysAgo: 1 });
    expect(device).toBeGreaterThan(ip);
    expect(both).toBeGreaterThan(device);
    expect(both).toBeLessThan(1);
  });

  it('discounts proxies and old sightings', () => {
    expect(scoreIdentityLink(['ip'], { isProxy: true, lastSeenDaysAgo: 1 })).toBeLessThan(0.2);
    expect(scoreIdentityLink(['device'], { isProxy: false, lastSeenDaysAgo: 200 })).toBeLessThan(
      scoreIdentityLink(['device'], { isProxy: false, lastSeenDaysAgo: 2 }),
    );
  });
});

describe('evaluateVerification', () => {
  it('passes a clean member', () => {
    expect(evaluateVerification(input())).toEqual({
      verdict: 'pass',
      confidence: 1,
      reasons: [],
      linkedUserIds: [],
    });
  });

  it('flags an alt of a banned member (default onMatch = flag)', () => {
    const r = evaluateVerification(input({ linked: [link({ bannedHere: true })] }));
    expect(r.verdict).toBe('flag');
    expect(r.reasons).toContain('alt_of_banned');
    expect(r.linkedUserIds).toEqual(['200000000000000001']);
  });

  it('blocks ban evasion when configured', () => {
    const config = { ...base, evasion: { ...base.evasion, onMatch: 'block' as const } };
    expect(evaluateVerification(input({ config, linked: [link({ bannedHere: true })] })).verdict).toBe(
      'block',
    );
  });

  it('ignores weak links below the confidence threshold', () => {
    const r = evaluateVerification(input({ linked: [link({ confidence: 0.3, bannedHere: true })] }));
    expect(r.verdict).toBe('pass');
  });

  it('applies the VPN policy and account age', () => {
    expect(evaluateVerification(input({ isProxy: true })).reasons).toContain('vpn_or_proxy');
    const config = { ...base, evasion: { ...base.evasion, minAccountAgeDays: 7 } };
    const young = evaluateVerification(
      input({ config, accountCreatedAt: new Date(Date.now() - 86_400_000) }),
    );
    expect(young.verdict).toBe('flag');
    expect(young.reasons).toContain('new_account');
  });

  it('always passes whitelisted members', () => {
    expect(
      evaluateVerification(input({ whitelisted: true, linked: [link({ bannedHere: true })] })).verdict,
    ).toBe('pass');
  });

  it('reports linked-but-clean alts without flagging', () => {
    const r = evaluateVerification(input({ linked: [link({})] }));
    expect(r.verdict).toBe('pass');
    expect(r.reasons).toEqual(['alt_linked']);
  });
});
