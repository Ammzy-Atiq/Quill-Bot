import { DEFAULT_GUILD_CONFIG, type RiskConfig } from '@quill/shared/config';
import { describe, expect, it } from 'vitest';
import { decayScore, evaluateRisk, type RiskContext, type RiskViolation, trustMultiplier } from './engine.js';

const config: RiskConfig = DEFAULT_GUILD_CONFIG.risk;
const HOUR = 3_600_000;
const OLD_ACCOUNT = Date.UTC(2020, 0, 1);
const ctx = (now: number, extra: Partial<RiskContext> = {}): RiskContext => ({
  now,
  accountCreatedAt: OLD_ACCOUNT,
  verified: false,
  altSuspect: false,
  ...extra,
});
const v = (severity: RiskViolation['severity'], pointsMultiplier = 1): RiskViolation => ({
  severity,
  pointsMultiplier,
  detector: 'words',
});

describe('risk engine', () => {
  it('halves the score every half-life', () => {
    expect(decayScore(40, 0, 24 * HOUR, 24)).toBeCloseTo(20);
    expect(decayScore(40, 0, 48 * HOUR, 24)).toBeCloseTo(10);
  });

  it('adds severity points and applies the first ladder step', () => {
    const now = Date.UTC(2026, 0, 1);
    const d = evaluateRisk(null, [v(3)], config, ctx(now)); // 12 points
    expect(d.added).toBe(12);
    expect(d.step?.action.type).toBe('warn');
    expect(d.state.lastStepThreshold).toBe(10);
  });

  it('counts extra violations in one message at half value', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(evaluateRisk(null, [v(3), v(3), v(3)], config, ctx(now)).added).toBe(24);
  });

  it('escalates with repeat offences and does not repeat a step', () => {
    let now = Date.UTC(2026, 0, 1);
    let d = evaluateRisk(null, [v(3)], config, ctx(now)); // 12 → warn
    now += 60_000;
    d = evaluateRisk(d.state, [v(3)], config, ctx(now)); // +18 (repeat ×1.5) → 30 → timeout 10m
    expect(d.repeat).toBe(true);
    expect(d.step?.action).toEqual({ type: 'timeout', durationSeconds: 600 });
    now += 60_000;
    d = evaluateRisk(d.state, [v(1)], config, ctx(now)); // +4.5 → ~34.5, no new step
    expect(d.step).toBeNull();
  });

  it('jumps straight to the highest crossed step', () => {
    const now = Date.UTC(2026, 0, 1);
    const d = evaluateRisk(null, [v(5, 2)], config, ctx(now)); // 100 points
    expect(d.step?.action.type).toBe('ban');
  });

  it('re-arms steps after the score decays', () => {
    let now = Date.UTC(2026, 0, 1);
    let d = evaluateRisk(null, [v(3)], config, ctx(now)); // warn at 10
    now += 7 * 24 * HOUR; // score decays to ~0.1
    d = evaluateRisk(d.state, [v(3)], config, ctx(now));
    expect(d.step?.action.type).toBe('warn');
  });

  it('applies trust multipliers', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(trustMultiplier(ctx(now, { accountCreatedAt: now - HOUR }), config)).toBe(1.5);
    expect(trustMultiplier(ctx(now, { verified: true }), config)).toBe(0.8);
    expect(trustMultiplier(ctx(now, { altSuspect: true }), config)).toBe(2);
  });

  it('never acts when the risk engine is disabled', () => {
    const now = Date.UTC(2026, 0, 1);
    const d = evaluateRisk(null, [v(5, 5)], { ...config, enabled: false }, ctx(now));
    expect(d.step).toBeNull();
    expect(d.state.score).toBeGreaterThan(0);
  });
});
