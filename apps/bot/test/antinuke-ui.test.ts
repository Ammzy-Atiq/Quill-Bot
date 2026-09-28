import { SCENARIOS } from '@quill/core';
import { ANTINUKE_ACTIONS, DEFAULT_GUILD_CONFIG } from '@quill/shared';
import type { Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { simulationCard } from '../src/modules/antinuke/antinuke-command.js';
import { auditCard } from '../src/modules/antinuke/audit.js';
import { type IncidentView, incidentCard } from '../src/modules/antinuke/cards.js';
import { antinukePanel } from '../src/modules/antinuke/panel.js';
import { whitelistPanel } from '../src/modules/antinuke/trust-command.js';
import { emptySummary } from '../src/modules/antinuke/types.js';
import { assertV2 } from '../src/ui/limits.js';

const guild = {
  id: '100000000000000001',
  name: 'Test Server',
  ownerId: '100000000000000009',
} as unknown as Guild;
const target = '200000000000000002';
const app = {
  logo: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  db: {},
  trust: {
    get: async () => ({
      extraOwners: new Set(['300000000000000001']),
      whitelist: new Map([[target, new Set(ANTINUKE_ACTIONS)]]),
    }),
  },
  client: {
    users: {
      fetch: async () => ({
        bot: true,
        displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/2.png',
      }),
    },
  },
} as unknown as App;

function worstIncident(module: 'antinuke' | 'antiraid'): IncidentView {
  const summary = emptySummary();
  summary.trust = 'whitelisted';
  summary.threatScore = 9999;
  summary.counts = Object.fromEntries(ANTINUKE_ACTIONS.map((a) => [a, 999]));
  summary.punishment = {
    type: 'quarantine',
    ok: true,
    error: null,
    caseNumber: 12345,
    previousRoles: ['1', '2'],
    quarantineRoleId: '3',
    bot: false,
  };
  summary.reverts = { reverted: 120, failed: 30, skipped: 12 };
  summary.emergency = true;
  summary.timeline = Array.from({ length: 14 }, (_, i) => ({
    at: Date.now() + i,
    text: `${'x'.repeat(400)} ${i}`,
  }));
  summary.notes = ['n'.repeat(150), 'o'.repeat(150), 'p'.repeat(150)];
  if (module === 'antiraid') {
    summary.raid = {
      reason: 'Join spike — 500 joins in 10s',
      joins: 500,
      actioned: 499,
      action: 'Kick',
      endsAt: Date.now() + 60_000,
      endedAt: null,
      invitesPaused: true,
    };
  }
  return {
    id: 1,
    number: 42,
    module,
    actorId: module === 'antinuke' ? '200000000000000001' : null,
    status: 'contained',
    threatLevel: 'critical',
    startedAt: new Date(),
    endedAt: null,
    summary,
  };
}

describe('Anti-Nuke UI stays within Components V2 limits', () => {
  it('incident card (worst case) — log, DM and raid variants', () => {
    for (const module of ['antinuke', 'antiraid'] as const) {
      for (const dm of [false, true]) {
        const stats = assertV2([incidentCard(app, worstIncident(module), { dm, guildName: 'Test Server' })]);
        expect(stats.hasAccentColor).toBe(false);
      }
    }
  });

  it('DM variant has no buttons (they cannot work outside the server)', () => {
    const json = JSON.stringify(incidentCard(app, worstIncident('antinuke'), { dm: true }).toJSON());
    expect(json).not.toContain('"custom_id"');
  });

  it('simulation cards for every scenario and "all"', () => {
    for (const key of ['all', ...SCENARIOS.map((s) => s.key)]) {
      assertV2([simulationCard(DEFAULT_GUILD_CONFIG.antinuke, key)]);
      assertV2([simulationCard({ ...DEFAULT_GUILD_CONFIG.antinuke, mode: 'threshold' }, key)]);
    }
  });

  it('audit card with many findings', () => {
    const checks = Array.from({ length: 18 }, (_, i) => ({
      level: (['high', 'medium', 'low', 'ok'] as const)[i % 4]!,
      text: `Finding ${i} ${'y'.repeat(150)}`,
    }));
    assertV2([auditCard(app, guild, { score: 12, grade: 'F', checks })]);
  });

  it('anti-nuke panel and whitelist panel', async () => {
    const panel = assertV2([await antinukePanel(app, guild, '200000000000000001', DEFAULT_GUILD_CONFIG)]);
    expect(panel.components).toBeLessThanOrEqual(40);
    assertV2([await whitelistPanel(app, guild, '200000000000000001', target)]);
  });
});
