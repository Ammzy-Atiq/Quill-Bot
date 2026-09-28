import {
  type AntiNukeDecision,
  evaluateAntiNuke,
  type RecentAction,
  resolveTrust,
  type TrustLevel,
} from '@quill/core';
import { securityRepo } from '@quill/db';
import {
  ANTINUKE_ACTION_LABELS,
  type AntiNukeAction,
  type AntiNukePunishment,
  type GuildConfig,
  type ModAction,
  redisKeys,
  THREAT_LEVELS,
  type ThreatLevel,
} from '@quill/shared';
import {
  AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  GuildMember,
  type Message,
  Role,
} from 'discord.js';
import type { App } from '../../app.js';
import { truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { v2Edit, v2Message } from '../../ui/respond.js';
import { type IncidentView, incidentCard, PUNISHMENT_LABELS, viewFromRow } from './cards.js';
import { mapAuditEntry } from './mapping.js';
import { Reverter } from './revert.js';
import {
  type EventRecord,
  emptySummary,
  type PunishmentRecord,
  pushTimeline,
  type RevertResult,
} from './types.js';

const INCIDENT_IDLE_MS = 10 * 60_000;
const FLUSH_DELAY_MS = 2_500;
const MAX_RECORDS = 250;

const levelRank = (level: ThreatLevel) => THREAT_LEVELS.indexOf(level);

const OVERWRITE_EVENTS = new Set<AuditLogEvent>([
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
]);

interface LiveIncident extends IncidentView {
  guildId: string;
  lastEventAt: number;
  flushTimer: NodeJS.Timeout | null;
  flushing: Promise<void>;
  ownerNotified: boolean;
}

interface ActorState {
  /** Protected actions inside the threat window (newest last). */
  records: EventRecord[];
}

function overwriteTarget(extra: unknown): { id: string; type: 0 | 1 } | null {
  if (!extra || typeof extra !== 'object' || !('id' in extra)) return null;
  const id = String((extra as { id: unknown }).id);
  if (extra instanceof GuildMember) return { id, type: 1 };
  if (extra instanceof Role) return { id, type: 0 };
  return { id, type: String((extra as { type?: unknown }).type) === '1' ? 1 : 0 };
}

/** Short description of what an event touched, for the incident timeline. */
export function describeTarget(record: EventRecord): string {
  const id = record.targetId;
  const oldName = record.changes.find((c) => c.key === 'name')?.old;
  const newName = record.changes.find((c) => c.key === 'name')?.new;
  const name = typeof oldName === 'string' ? oldName : typeof newName === 'string' ? newName : null;
  switch (record.action) {
    case 'ban':
    case 'kick':
    case 'member_timeout':
    case 'member_role_update':
    case 'bot_add':
      return id ? `<@${id}>` : '';
    case 'channel_create':
    case 'channel_update':
      return id ? `<#${id}>` : '';
    case 'channel_delete':
      return name ? `#${name}` : '';
    case 'role_create':
    case 'role_update':
      return id ? `<@&${id}>` : '';
    case 'role_delete':
      return name ? `@${name}` : '';
    case 'emoji_delete':
      return name ? `:${name}:` : '';
    case 'webhook_create':
    case 'webhook_update':
    case 'webhook_delete':
      return name ? `“${name}”` : '';
    case 'mention_everyone':
      return record.message ? `<#${record.message.channelId}>` : '';
    default:
      return '';
  }
}

function toModAction(punishment: AntiNukePunishment, bot: boolean): ModAction {
  if (bot) return punishment === 'kick' ? { type: 'kick' } : { type: 'ban', deleteMessageSeconds: 3_600 };
  switch (punishment) {
    case 'kick':
      return { type: 'kick' };
    case 'strip_roles':
      return { type: 'strip_roles' };
    case 'quarantine':
      return { type: 'quarantine' };
    default:
      return { type: 'ban', deleteMessageSeconds: 3_600 };
  }
}

/**
 * Anti-Nuke runtime (Olympus-style, extended).
 *
 * Every protected action (audit-log entry or @everyone ping) is evaluated by the pure engine in
 * `@quill/core` with per-actor rolling windows. Decisions are serialized per guild so bursts are
 * counted exactly; punishments, reverts and emergency mode run in the background so detection is
 * never blocked by slow Discord calls. Guild events always reach the same shard, so live incident
 * state is kept in memory and persisted to Postgres (incidents + security_events).
 */
export class AntiNukeService {
  readonly reverter: Reverter;
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly revertChains = new Map<string, Promise<unknown>>();
  private readonly actors = new Map<string, ActorState>();
  private readonly incidents = new Map<string, LiveIncident>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly app: App) {
    this.reverter = new Reverter(app);
  }

  start(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    this.sweeper.unref();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  // ── inputs ──────────────────────────────────────────────────────────────────

  async onAuditEntry(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    const actorId = entry.executorId;
    if (!actorId) return;
    const config = await this.app.configs.get(guild.id);
    if (!config.antinuke.enabled) return;
    const mapped = mapAuditEntry(entry, guild, config.antinuke.protectedChannelIds);
    if (!mapped) return;
    await this.process(guild, config, {
      action: mapped.action,
      actorId,
      targetId: mapped.targetId,
      at: Date.now(),
      auditAction: entry.action,
      changes: entry.changes.map((c) => ({ key: c.key, old: c.old, new: c.new })),
      overwrite: OVERWRITE_EVENTS.has(entry.action) ? overwriteTarget(entry.extra) : null,
      message: null,
      dangerous: mapped.dangerous,
      reverted: false,
    });
  }

  /** @everyone / @here pings (only possible with the Mention Everyone permission). */
  async onMessage(message: Message): Promise<void> {
    if (!message.inGuild() || !message.mentions.everyone) return;
    const config = await this.app.configs.get(message.guildId);
    const an = config.antinuke;
    if (!an.enabled || !an.modules.mention_everyone.enabled) return;
    const incomingWebhook = message.webhookId !== null && message.webhookId !== message.applicationId;
    if (incomingWebhook) {
      await this.onWebhookEveryone(message, config);
      return;
    }
    await this.process(message.guild, config, {
      action: 'mention_everyone',
      actorId: message.author.id,
      targetId: message.channelId,
      at: Date.now(),
      auditAction: null,
      changes: [],
      overwrite: null,
      message: { channelId: message.channelId, messageId: message.id },
      dangerous: false,
      reverted: false,
    });
  }

  /** Webhooks cannot be whitelisted: repeated @everyone from one webhook deletes the webhook. */
  private async onWebhookEveryone(message: Message<true>, config: GuildConfig): Promise<void> {
    const webhookId = message.webhookId!;
    const module = config.antinuke.modules.mention_everyone;
    const count = await this.app.store.hit(
      `quill:an:webhook:${message.guildId}:${webhookId}`,
      Date.now(),
      module.windowSeconds * 1000,
    );
    if (count <= Math.max(1, module.limit)) return;
    await message.delete().catch(() => undefined);
    if (!(await this.app.store.setNx(`quill:an:webhook:deleted:${webhookId}`, '1', 300))) return;
    const deleted = await this.app.client
      .deleteWebhook(webhookId, { reason: 'QUILL GUARD anti-nuke: webhook @everyone spam' })
      .then(() => true)
      .catch(() => false);
    await securityRepo
      .recordSecurityEvent(this.app.db, {
        guildId: message.guildId,
        module: 'antinuke',
        action: 'webhook_everyone_spam',
        actorId: null,
        targetId: webhookId,
        severity: 3,
        trust: 'untrusted',
        details: { channelId: message.channelId, count },
        response: { webhookDeleted: deleted },
      })
      .catch(() => undefined);
    await this.app.logs.send(
      message.guild,
      'antinuke',
      Card.create()
        .header({ title: 'Webhook spam stopped', emoji: E.siren, level: 3 })
        .text(
          `A webhook sent **${count}** @everyone pings in <#${message.channelId}> within ${module.windowSeconds}s.\n${deleted ? `${E.check} The webhook was deleted.` : `${E.cross} QUILL could not delete the webhook (missing Manage Webhooks?).`}`,
        )
        .build(),
    );
  }

  // ── decision ────────────────────────────────────────────────────────────────

  private process(guild: Guild, config: GuildConfig, record: EventRecord): Promise<void> {
    return this.serial(this.chains, guild.id, () => this.decide(guild, config, record)).catch(
      (err: unknown) =>
        this.app.logger.error({ err, guildId: guild.id, action: record.action }, 'anti-nuke decision failed'),
    );
  }

  private async decide(guild: Guild, config: GuildConfig, record: EventRecord): Promise<void> {
    const an = config.antinuke;
    const module = an.modules[record.action];
    if (!module.enabled) return;
    const trustData = await this.app.trust.get(guild.id);
    let trust: TrustLevel = resolveTrust({
      actorId: record.actorId,
      ownerId: guild.ownerId,
      botId: this.app.client.user?.id ?? '',
      extraOwners: trustData.extraOwners,
      whitelist: trustData.whitelist,
      action: record.action,
    });
    if (trust === 'owner' || trust === 'self') return;
    if (trust === 'extra_owner' && !an.antiBetray.monitorExtraOwners) return;
    // While emergency mode is on, only the owner and extra owners are trusted.
    if (trust === 'whitelisted' && (await this.app.emergency.isActive(guild.id))) trust = 'untrusted';

    const now = Date.now();
    const store = this.app.store;
    const threatWindow = an.threat.windowSeconds * 1000;
    const threatKey = redisKeys.antinukeThreat(guild.id, record.actorId);
    const [actionCount] = await Promise.all([
      store.hit(
        redisKeys.antinukeWindow(guild.id, record.actorId, record.action),
        now,
        module.windowSeconds * 1000,
      ),
      store.hit(threatKey, now, threatWindow, `${record.action}${record.dangerous ? '!' : ''}`),
    ]);
    const recent: RecentAction[] = (await store.windowEntries(threatKey, now, threatWindow)).map((e) => ({
      action: e.member.replace(/!$/, '') as AntiNukeAction,
      at: e.at,
      dangerous: e.member.endsWith('!'),
    }));
    const raidMode = config.antiraid.raidMode.tightenAntiNuke && (await this.app.antiraid.isActive(guild.id));
    const decision = evaluateAntiNuke({
      action: record.action,
      trust,
      config: an,
      actionCount,
      recent,
      dangerous: record.dangerous,
      raidMode,
    });

    const key = `${guild.id}:${record.actorId}`;
    const actor = this.actors.get(key) ?? { records: [] };
    actor.records = actor.records.filter((r) => r.at > now - threatWindow).slice(-MAX_RECORDS);
    actor.records.push(record);
    this.actors.set(key, actor);

    let incident = this.incidents.get(key) ?? null;
    const notable =
      decision.punish || decision.emergency || levelRank(decision.threat.level) >= levelRank('high');
    if (!incident && notable) incident = await this.openIncident(guild, record.actorId, trust, decision);

    void securityRepo
      .recordSecurityEvent(this.app.db, {
        guildId: guild.id,
        incidentId: incident?.id ?? null,
        module: 'antinuke',
        action: record.action,
        actorId: record.actorId,
        targetId: record.targetId,
        severity: 1 + levelRank(decision.threat.level),
        trust,
        details: {
          dangerous: record.dangerous,
          count: actionCount,
          limit: decision.limit,
          threat: decision.threat.score,
          raidMode,
        },
        response: {
          punish: decision.punish,
          punishment: decision.punish ? decision.punishment : null,
          revert: decision.revert,
          reason: decision.reason,
        },
      })
      .catch((err: unknown) => this.app.logger.warn({ err }, 'security event write failed'));

    if (incident) this.track(incident, record, decision, trust);

    if (decision.punish) {
      // Punish once per burst (the handled key outlives the burst so a failed punishment retries later).
      const first = await store.setNx(redisKeys.antinukeHandled(guild.id, record.actorId), '1', 60);
      if (first && incident) void this.punish(guild, incident, decision);
      if (record.action === 'bot_add' && !record.reverted) {
        record.reverted = true;
        this.queueRevert(guild, incident, record, () => this.reverter.removeBot(guild, record.targetId));
      }
      if (decision.revert) {
        // Revert this event — and on the first punishment everything the actor did earlier in the window.
        for (const r of first ? actor.records : [record]) {
          if (r.reverted) continue;
          r.reverted = true;
          this.queueRevert(guild, incident, r, () => this.reverter.revert(guild, r));
        }
      }
    }

    if (decision.emergency && incident && !incident.summary.emergency) {
      incident.summary.emergency = true;
      pushTimeline(incident.summary, `${E.siren} Emergency mode triggered (threat ${decision.threat.level})`);
      this.scheduleFlush(incident);
      void this.app.emergency
        .activate(
          guild,
          `Anti-Nuke incident #${incident.number}: threat level ${decision.threat.level}`,
          true,
          record.actorId,
        )
        .catch((err: unknown) => this.app.logger.error({ err, guildId: guild.id }, 'auto emergency failed'));
    }
  }

  private track(incident: LiveIncident, record: EventRecord, decision: AntiNukeDecision, trust: TrustLevel) {
    const s = incident.summary;
    s.counts[record.action] = (s.counts[record.action] ?? 0) + 1;
    s.trust = trust;
    if (decision.threat.score > s.threatScore) s.threatScore = decision.threat.score;
    if (levelRank(decision.threat.level) > levelRank(incident.threatLevel))
      incident.threatLevel = decision.threat.level;
    incident.lastEventAt = Date.now();
    const target = describeTarget(record);
    pushTimeline(
      s,
      `${ANTINUKE_ACTION_LABELS[record.action]}${target ? ` ${E.arrowRight} ${target}` : ''}${decision.punish ? '' : ' · _within limits_'}`,
    );
    this.scheduleFlush(incident);
  }

  // ── responses ───────────────────────────────────────────────────────────────

  private async punish(guild: Guild, incident: LiveIncident, decision: AntiNukeDecision): Promise<void> {
    const record: PunishmentRecord = {
      type: decision.punishment,
      ok: false,
      error: null,
      caseNumber: null,
      previousRoles: [],
      quarantineRoleId: null,
      bot: false,
    };
    incident.summary.punishment = record;
    if (decision.punishment === 'alert') {
      record.ok = true;
      pushTimeline(incident.summary, `${E.info} Alert only — punishment is set to *alert*`);
      this.scheduleFlush(incident, true);
      return;
    }
    try {
      const user = await this.app.client.users.fetch(incident.actorId!);
      record.bot = user.bot;
      const member =
        guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
      const action = toModAction(decision.punishment, user.bot);
      record.type = action.type as AntiNukePunishment;
      const result = await this.app.moderation.apply(guild, user, member, action, {
        reason: `Anti-Nuke incident #${incident.number}: ${decision.reason}`,
        source: 'antinuke',
        logCase: false,
        details: { incident: incident.number, threat: decision.threat.score },
      });
      record.ok = result.ok;
      record.error = result.error ?? null;
      record.caseNumber = result.caseRow?.caseNumber ?? null;
      if (result.applied && result.applied !== action.type)
        record.type = result.applied as AntiNukePunishment;
      const details = (result.caseRow?.details ?? {}) as {
        previousRoles?: string[];
        quarantineRoleId?: string | null;
      };
      record.previousRoles = details.previousRoles ?? [];
      record.quarantineRoleId = details.quarantineRoleId ?? null;
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
    }
    pushTimeline(
      incident.summary,
      record.ok
        ? `${E.hammer} **Punished:** ${PUNISHMENT_LABELS[record.type]}${record.caseNumber ? ` (case #${record.caseNumber})` : ''}`
        : `${E.cross} **Could not punish:** ${truncate(record.error ?? 'unknown error', 120)}`,
    );
    if (!record.ok) await this.notifyOwner(guild, incident);
    this.scheduleFlush(incident, true);
  }

  private queueRevert(
    guild: Guild,
    incident: LiveIncident | null,
    record: EventRecord,
    run: () => Promise<RevertResult>,
  ) {
    void this.serial(this.revertChains, guild.id, async () => {
      const result = await run().catch(
        (error: unknown): RevertResult => ({
          outcome: 'failed',
          note: error instanceof Error ? error.message : String(error),
        }),
      );
      if (result.outcome === 'failed') {
        this.app.logger.warn(
          { guildId: guild.id, action: record.action, note: result.note },
          'anti-nuke revert failed',
        );
      }
      if (!incident) return;
      const s = incident.summary;
      if (result.outcome === 'reverted') s.reverts.reverted++;
      else if (result.outcome === 'failed') s.reverts.failed++;
      else s.reverts.skipped++;
      const icon = result.outcome === 'reverted' ? E.undo : result.outcome === 'failed' ? E.cross : E.dot;
      pushTimeline(s, `${icon} ${truncate(result.note.charAt(0).toUpperCase() + result.note.slice(1), 140)}`);
      this.scheduleFlush(incident);
    });
  }

  // ── incidents ───────────────────────────────────────────────────────────────

  private async openIncident(
    guild: Guild,
    actorId: string,
    trust: TrustLevel,
    decision: AntiNukeDecision,
  ): Promise<LiveIncident> {
    const row = await securityRepo.openIncident(this.app.db, {
      guildId: guild.id,
      actorId,
      module: 'antinuke',
      threatLevel: decision.threat.level,
    });
    const incident: LiveIncident = {
      id: row.id,
      number: row.incidentNumber,
      module: 'antinuke',
      actorId,
      status: 'open',
      threatLevel: decision.threat.level,
      startedAt: row.startedAt,
      endedAt: null,
      summary: { ...emptySummary(), trust, threatScore: decision.threat.score },
      guildId: guild.id,
      lastEventAt: Date.now(),
      flushTimer: null,
      flushing: Promise.resolve(),
      ownerNotified: false,
    };
    this.incidents.set(`${guild.id}:${actorId}`, incident);
    this.scheduleFlush(incident, true);
    return incident;
  }

  /** Live incident for an actor (if one is running on this shard). */
  live(guildId: string, number: number): LiveIncident | undefined {
    for (const incident of this.incidents.values()) {
      if (incident.guildId === guildId && incident.number === number) return incident;
    }
    return undefined;
  }

  /**
   * Loads an incident (live state first, else the stored row), applies `mutate` and persists it.
   * Used by the incident card buttons.
   */
  async mutateIncident(
    guildId: string,
    number: number,
    mutate: (view: IncidentView) => void | Promise<void>,
  ): Promise<IncidentView | null> {
    const live = this.live(guildId, number);
    if (live) {
      await mutate(live);
      await this.persist(live);
      return live;
    }
    const row = await securityRepo.getIncident(this.app.db, guildId, number);
    if (!row) return null;
    const view = viewFromRow(row);
    await mutate(view);
    await securityRepo.updateIncident(this.app.db, view.id, {
      status: view.status,
      threatLevel: view.threatLevel,
      summary: view.summary as unknown as Record<string, unknown>,
      endedAt: view.endedAt,
    });
    return view;
  }

  private scheduleFlush(incident: LiveIncident, immediate = false) {
    if (incident.flushTimer) {
      if (!immediate) return;
      clearTimeout(incident.flushTimer);
    }
    incident.flushTimer = setTimeout(
      () => {
        incident.flushTimer = null;
        incident.flushing = incident.flushing.then(() => this.flush(incident)).catch(() => undefined);
      },
      immediate ? 0 : FLUSH_DELAY_MS,
    );
    incident.flushTimer.unref();
  }

  private persist(incident: LiveIncident) {
    return securityRepo.updateIncident(this.app.db, incident.id, {
      status: incident.status,
      threatLevel: incident.threatLevel,
      summary: incident.summary as unknown as Record<string, unknown>,
      endedAt: incident.endedAt,
    });
  }

  /** Writes the incident to Postgres and creates/edits its live log card. */
  private async flush(incident: LiveIncident): Promise<void> {
    await this.persist(incident).catch((err: unknown) =>
      this.app.logger.warn({ err }, 'incident write failed'),
    );
    const guild = this.app.client.guilds.cache.get(incident.guildId);
    if (!guild) return;
    const card = incidentCard(this.app, incident);
    const log = incident.summary.log;
    if (log) {
      const channel = guild.channels.cache.get(log.channelId);
      if (channel?.isTextBased()) {
        const edited = await channel.messages
          .edit(log.messageId, v2Edit(card))
          .then(() => true)
          .catch(() => false);
        if (edited) return;
      }
    }
    // First card, or the log channel was deleted (QUILL re-creates it and re-points the config).
    const message = await this.app.logs.send(guild, 'antinuke', card);
    if (message) {
      incident.summary.log = { channelId: message.channelId, messageId: message.id };
      await this.persist(incident).catch(() => undefined);
    } else {
      await this.notifyOwner(guild, incident);
    }
  }

  /** DMs the owner once per incident (no log channel, or QUILL could not stop the attacker). */
  private async notifyOwner(guild: Guild, incident: LiveIncident) {
    if (incident.ownerNotified) return;
    incident.ownerNotified = true;
    const owner = await guild.fetchOwner().catch(() => null);
    await owner?.send(v2Message(incidentCard(this.app, incident, { dm: true }))).catch(() => undefined);
  }

  /** Closes idle incidents and forgets old actor windows. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [key, actor] of this.actors) {
      actor.records = actor.records.filter((r) => r.at > now - INCIDENT_IDLE_MS);
      if (actor.records.length === 0) this.actors.delete(key);
    }
    for (const [key, incident] of this.incidents) {
      if (now - incident.lastEventAt < INCIDENT_IDLE_MS) continue;
      this.incidents.delete(key);
      if (incident.status === 'open') {
        const punishment = incident.summary.punishment;
        incident.status = !punishment ? 'resolved' : punishment.ok ? 'contained' : 'open';
        if (incident.status !== 'open') incident.endedAt = new Date();
      }
      pushTimeline(incident.summary, `${E.clock} No further activity — incident closed`);
      if (incident.flushTimer) clearTimeout(incident.flushTimer);
      incident.flushTimer = null;
      incident.flushing = incident.flushing.then(() => this.flush(incident)).catch(() => undefined);
    }
  }

  private serial<T>(chains: Map<string, Promise<unknown>>, key: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return run;
  }
}
