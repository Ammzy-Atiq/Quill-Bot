import type { AntiNukeAction } from '@quill/shared/actions';
import type { AntiNukeConfig } from '@quill/shared/config';
import { type AntiNukeDecision, evaluateAntiNuke, type RecentAction, type TrustLevel } from './engine.js';

export interface SimulatedEvent {
  action: AntiNukeAction;
  /** Milliseconds after the previous event. */
  delayMs: number;
  dangerous?: boolean;
}

export interface Scenario {
  key: string;
  name: string;
  description: string;
  events: SimulatedEvent[];
}

const repeat = (
  action: AntiNukeAction,
  count: number,
  delayMs: number,
  dangerous = false,
): SimulatedEvent[] => Array.from({ length: count }, () => ({ action, delayMs, dangerous }));

/** Red-team scenarios. They run through the real engine in dry-run — nothing touches Discord. */
export const SCENARIOS: Scenario[] = [
  {
    key: 'channel_wipe',
    name: 'Mass channel deletion',
    description: '15 channels deleted in ~6 seconds',
    events: repeat('channel_delete', 15, 400),
  },
  {
    key: 'role_wipe',
    name: 'Role wipe',
    description: '10 roles deleted in ~4 seconds',
    events: repeat('role_delete', 10, 400),
  },
  {
    key: 'ban_wave',
    name: 'Ban wave',
    description: '25 members banned in ~10 seconds',
    events: repeat('ban', 25, 400),
  },
  {
    key: 'webhook_spam',
    name: 'Webhook + @everyone spam',
    description: 'Webhooks created, then @everyone spam',
    events: [...repeat('webhook_create', 5, 300), ...repeat('mention_everyone', 10, 200)],
  },
  {
    key: 'malicious_bot',
    name: 'Malicious bot',
    description: 'A bot is added and immediately starts deleting channels',
    events: [{ action: 'bot_add', delayMs: 0 }, ...repeat('channel_delete', 8, 300)],
  },
  {
    key: 'privilege_escalation',
    name: 'Privilege escalation',
    description: '@everyone given Administrator, then an admin role handed out',
    events: [
      { action: 'role_update', delayMs: 0, dangerous: true },
      { action: 'member_role_update', delayMs: 500, dangerous: true },
      ...repeat('member_role_update', 4, 300, true),
    ],
  },
  {
    key: 'full_nuke',
    name: 'Full nuke',
    description: 'Vanity stolen, channels + roles deleted, members banned, webhooks spammed',
    events: [
      { action: 'vanity_update', delayMs: 0 },
      ...repeat('channel_delete', 6, 250),
      ...repeat('role_delete', 6, 250),
      ...repeat('ban', 10, 200),
      ...repeat('webhook_create', 3, 200),
      ...repeat('mention_everyone', 5, 150),
    ],
  },
  {
    key: 'slow_nuke',
    name: 'Slow nuke',
    description: 'One channel deleted every 8 seconds (tries to stay under limits)',
    events: repeat('channel_delete', 8, 8_000),
  },
];

export interface SimulationStep {
  index: number;
  atMs: number;
  action: AntiNukeAction;
  decision: AntiNukeDecision;
}

export interface SimulationResult {
  scenario: Scenario;
  trust: TrustLevel;
  steps: SimulationStep[];
  /** 1-based index of the first punished event (null = never caught). */
  caughtAt: number | null;
  caughtAfterMs: number | null;
  emergencyAt: number | null;
  peakThreat: AntiNukeDecision['threat'];
  /** Destructive events that got through before QUILL reacted. */
  damageBeforeCatch: number;
}

/** Replays a scenario through `evaluateAntiNuke` with in-memory rolling windows. */
export function simulate(
  scenario: Scenario,
  config: AntiNukeConfig,
  trust: TrustLevel = 'untrusted',
): SimulationResult {
  const enabledConfig: AntiNukeConfig = { ...config, enabled: true };
  const history: RecentAction[] = [];
  const steps: SimulationStep[] = [];
  let at = 0;
  let caughtAt: number | null = null;
  let caughtAfterMs: number | null = null;
  let emergencyAt: number | null = null;
  let peak: AntiNukeDecision['threat'] = { score: 0, level: 'normal', destructiveKinds: 0 };

  scenario.events.forEach((event, i) => {
    at += event.delayMs;
    history.push({ action: event.action, at, dangerous: event.dangerous });
    const moduleWindow = enabledConfig.modules[event.action].windowSeconds * 1000;
    const threatWindow = enabledConfig.threat.windowSeconds * 1000;
    const decision = evaluateAntiNuke({
      action: event.action,
      trust,
      config: enabledConfig,
      actionCount: history.filter((h) => h.action === event.action && h.at > at - moduleWindow).length,
      recent: history.filter((h) => h.at > at - threatWindow),
      dangerous: Boolean(event.dangerous),
      raidMode: false,
    });
    if (decision.threat.score > peak.score) peak = decision.threat;
    if (decision.punish && caughtAt === null) {
      caughtAt = i + 1;
      caughtAfterMs = at;
    }
    if (decision.emergency && emergencyAt === null) emergencyAt = i + 1;
    steps.push({ index: i + 1, atMs: at, action: event.action, decision });
  });

  return {
    scenario,
    trust,
    steps,
    caughtAt,
    caughtAfterMs,
    emergencyAt,
    peakThreat: peak,
    damageBeforeCatch: caughtAt === null ? scenario.events.length : caughtAt - 1,
  };
}
