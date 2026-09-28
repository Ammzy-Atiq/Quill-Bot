import { evaluateJoin } from '@quill/core';
import { securityRepo } from '@quill/db';
import { type ModAction, redisKeys } from '@quill/shared';
import type { Guild, GuildMember } from 'discord.js';
import type { App } from '../../app.js';
import { formatDuration, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { v2Edit } from '../../ui/respond.js';
import { baseVars, renderTemplate } from '../../ui/templates.js';
import { type IncidentView, incidentCard, viewFromRow } from '../antinuke/cards.js';
import { emptySummary, pushTimeline, type RaidSummary } from '../antinuke/types.js';

interface RaidState {
  reason: string;
  by: string | null;
  startedAt: number;
  endsAt: number;
  incidentNumber: number | null;
}

interface LiveRaid extends IncidentView {
  guildId: string;
  timer: NodeJS.Timeout | null;
  flushTimer: NodeJS.Timeout | null;
  flushing: Promise<void>;
}

const FLUSH_DELAY_MS = 3_000;
const namesKey = (guildId: string) => `quill:raid:names:${guildId}`;

/**
 * Anti-Raid: join-rate spikes start raid mode (every new join gets the raid action, anti-nuke
 * limits are halved, invites can be paused); outside raid mode the join filters (account age,
 * avatar, look-alike name waves) apply. One live incident card per raid.
 */
export class AntiRaidService {
  private readonly raids = new Map<string, LiveRaid>();

  constructor(private readonly app: App) {}

  async isActive(guildId: string): Promise<boolean> {
    return (await this.app.store.get(redisKeys.raidMode(guildId))) !== null;
  }

  async state(guildId: string): Promise<RaidState | null> {
    const raw = await this.app.store.get(redisKeys.raidMode(guildId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RaidState;
    } catch {
      return null;
    }
  }

  async onJoin(member: GuildMember): Promise<void> {
    if (member.user.bot) return; // bots are covered by anti-nuke (bot_add)
    const guild = member.guild;
    const config = await this.app.configs.get(guild.id);
    const cfg = config.antiraid;
    if (!cfg.enabled) return;
    const trust = await this.app.trust.get(guild.id);
    if (trust.extraOwners.has(member.id) || trust.whitelist.has(member.id)) return;

    const now = Date.now();
    const windowMs = cfg.joinRate.windowSeconds * 1000;
    const joinsKey = redisKeys.raidJoins(guild.id);
    const [joins, recentNames] = await Promise.all([
      this.app.store.hit(joinsKey, now, windowMs, member.id),
      this.app.store.list(namesKey(guild.id)),
    ]);
    await this.app.store.pushCapped(
      namesKey(guild.id),
      member.user.username,
      50,
      cfg.joinRate.windowSeconds * 6,
    );
    const raidActive = await this.isActive(guild.id);
    const decision = evaluateJoin({
      config: cfg,
      now,
      joinsInWindow: joins,
      accountCreatedAt: member.user.createdTimestamp,
      hasAvatar: member.user.avatar !== null,
      username: member.user.username,
      recentJoinNames: recentNames,
      raidModeActive: raidActive,
    });

    let inRaid = raidActive;
    if (decision.startRaid && cfg.raidMode.autoEnable) {
      const started = await this.start(
        guild,
        `Join spike — ${decision.reasons[0]}`,
        null,
        cfg.raidMode.durationMinutes,
      );
      inRaid = true;
      // The wave that triggered raid mode joined just before this member.
      if (started) void this.sweepWave(guild, joinsKey, windowMs, member.id);
    }

    if (inRaid) {
      await this.actOnRaider(member, cfg.raidMode.joinAction, 'Joined during raid mode');
      return;
    }
    if (decision.filtered) await this.filter(member, cfg.filterAction, decision.reasons);
  }

  /** Starts raid mode. Returns false when it was already active. */
  async start(guild: Guild, reason: string, by: string | null, minutes: number): Promise<boolean> {
    const key = redisKeys.raidMode(guild.id);
    const startedAt = Date.now();
    const endsAt = startedAt + minutes * 60_000;
    const state: RaidState = { reason, by, startedAt, endsAt, incidentNumber: null };
    if (!(await this.app.store.setNx(key, JSON.stringify(state), minutes * 60))) return false;

    const config = await this.app.configs.get(guild.id);
    const cfg = config.antiraid;
    let invitesPaused = false;
    if (cfg.raidMode.pauseInvites) {
      invitesPaused = await guild
        .setIncidentActions({ invitesDisabledUntil: new Date(endsAt) })
        .then(() => true)
        .catch(() => false);
    }
    const row = await securityRepo.openIncident(this.app.db, {
      guildId: guild.id,
      actorId: by,
      module: 'antiraid',
      threatLevel: 'high',
    });
    state.incidentNumber = row.incidentNumber;
    await this.app.store.set(key, JSON.stringify(state), minutes * 60);

    const raid: RaidSummary = {
      reason,
      joins: 0,
      actioned: 0,
      action: this.app.moderation.describe(cfg.raidMode.joinAction),
      endsAt,
      endedAt: null,
      invitesPaused,
    };
    const live: LiveRaid = {
      ...viewFromRow(row),
      summary: { ...emptySummary(), raid },
      guildId: guild.id,
      timer: null,
      flushTimer: null,
      flushing: Promise.resolve(),
    };
    pushTimeline(
      live.summary,
      by ? `${E.antiraid} Raid mode started by <@${by}>` : `${E.antiraid} Raid mode started automatically`,
    );
    if (cfg.raidMode.tightenAntiNuke && config.antinuke.enabled) {
      pushTimeline(live.summary, `${E.antinuke} Anti-Nuke limits halved while raid mode is on`);
    }
    if (invitesPaused) pushTimeline(live.summary, `${E.lock} Invites paused`);
    this.raids.set(guild.id, live);
    this.armTimer(guild, live, endsAt);

    await this.app.logs
      .send(guild, 'antiraid', [
        incidentCard(this.app, live),
        renderTemplate(this.app, config, 'raid_notice', {
          ...baseVars(guild),
          duration: formatDuration(minutes * 60),
        }),
      ])
      .then((message) => {
        if (message) live.summary.log = { channelId: message.channelId, messageId: message.id };
      });
    await this.persist(live);
    return true;
  }

  /** Ends raid mode (manual or on expiry). Returns false when it was not active. */
  async end(guild: Guild, by: string | null): Promise<boolean> {
    const key = redisKeys.raidMode(guild.id);
    const state = await this.state(guild.id);
    const live = this.raids.get(guild.id) ?? (state ? await this.resume(guild, state) : null);
    if (!state && !live) return false;
    await this.app.store.del(key);
    if (!live) return true;
    this.raids.delete(guild.id);
    if (live.timer) clearTimeout(live.timer);
    const raid = live.summary.raid;
    if (raid?.invitesPaused)
      await guild.setIncidentActions({ invitesDisabledUntil: null }).catch(() => undefined);
    if (raid) raid.endedAt = Date.now();
    live.status = 'resolved';
    live.endedAt = new Date();
    pushTimeline(
      live.summary,
      by ? `${E.unlock} Raid mode ended by <@${by}>` : `${E.clock} Raid mode expired`,
    );
    await this.flush(guild, live);
    return true;
  }

  /** Re-attaches to a raid started before this shard (re)started. */
  private async resume(guild: Guild, state: RaidState): Promise<LiveRaid | null> {
    if (state.incidentNumber === null) return null;
    const row = await securityRepo.getIncident(this.app.db, guild.id, state.incidentNumber);
    if (!row) return null;
    const live: LiveRaid = {
      ...viewFromRow(row),
      guildId: guild.id,
      timer: null,
      flushTimer: null,
      flushing: Promise.resolve(),
    };
    this.raids.set(guild.id, live);
    if (live.status !== 'resolved') this.armTimer(guild, live, state.endsAt);
    return live;
  }

  private armTimer(guild: Guild, live: LiveRaid, endsAt: number) {
    if (live.timer) clearTimeout(live.timer);
    live.timer = setTimeout(() => void this.end(guild, null), Math.max(1_000, endsAt - Date.now()));
    live.timer.unref();
  }

  private async liveRaid(guild: Guild): Promise<LiveRaid | null> {
    const live = this.raids.get(guild.id);
    if (live) return live;
    const state = await this.state(guild.id);
    return state ? this.resume(guild, state) : null;
  }

  /** Applies the raid action to the members of the wave that triggered raid mode. */
  private async sweepWave(guild: Guild, joinsKey: string, windowMs: number, exceptId: string) {
    const config = await this.app.configs.get(guild.id);
    const entries = await this.app.store.windowEntries(joinsKey, Date.now(), windowMs);
    for (const { member: userId } of entries) {
      if (userId === exceptId) continue;
      const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
      if (!member || member.user.bot) continue;
      await this.actOnRaider(member, config.antiraid.raidMode.joinAction, 'Joined in the raid wave');
    }
  }

  private async actOnRaider(member: GuildMember, action: ModAction, reason: string) {
    const live = await this.liveRaid(member.guild);
    // No DMs during raids: DMing hundreds of joiners would slow down the response.
    const result =
      action.type === 'none'
        ? { ok: true }
        : await this.app.moderation.apply(member.guild, member.user, member, action, {
            reason,
            source: 'antiraid',
            recordCase: false,
            logCase: false,
          });
    if (!live?.summary.raid) return;
    live.summary.raid.joins++;
    if (result.ok && action.type !== 'none') live.summary.raid.actioned++;
    if (!result.ok && live.summary.notes.length < 3) {
      live.summary.notes.push(
        `Could not act on some joins: ${truncate(('error' in result && result.error) || 'unknown', 120)}`,
      );
    }
    this.scheduleFlush(member.guild, live);
  }

  private async filter(member: GuildMember, action: ModAction, reasons: string[]) {
    const reason = `Join filter: ${reasons.join(', ')}`;
    const result =
      action.type === 'none'
        ? { ok: true, error: undefined }
        : await this.app.moderation.apply(member.guild, member.user, member, action, {
            reason,
            source: 'antiraid',
            logCase: false,
          });
    await securityRepo
      .recordSecurityEvent(this.app.db, {
        guildId: member.guild.id,
        module: 'antiraid',
        action: 'join_filtered',
        actorId: member.id,
        targetId: null,
        severity: 1,
        trust: 'untrusted',
        details: { reasons },
        response: { action: action.type, ok: result.ok, error: result.error ?? null },
      })
      .catch(() => undefined);
    await this.app.logs.send(
      member.guild,
      'antiraid',
      Card.create()
        .header({
          title: 'Join filtered',
          emoji: E.antiraid,
          level: 3,
          thumbnail: member.displayAvatarURL({ size: 128 }),
        })
        .lines([
          ['Member', `<@${member.id}> · \`${member.id}\``],
          ['Why', reasons.join(', ')],
          [
            'Action',
            result.ok
              ? this.app.moderation.describe(action)
              : `${E.cross} ${this.app.moderation.describe(action)} failed — ${result.error ?? 'unknown error'}`,
          ],
        ])
        .build(),
    );
  }

  private scheduleFlush(guild: Guild, live: LiveRaid) {
    if (live.flushTimer) return;
    live.flushTimer = setTimeout(() => {
      live.flushTimer = null;
      void this.flush(guild, live);
    }, FLUSH_DELAY_MS);
    live.flushTimer.unref();
  }

  private persist(live: LiveRaid) {
    return securityRepo
      .updateIncident(this.app.db, live.id, {
        status: live.status,
        summary: live.summary as unknown as Record<string, unknown>,
        endedAt: live.endedAt,
      })
      .catch((err: unknown) => this.app.logger.warn({ err }, 'raid incident write failed'));
  }

  private flush(guild: Guild, live: LiveRaid): Promise<void> {
    live.flushing = live.flushing
      .then(async () => {
        await this.persist(live);
        const log = live.summary.log;
        const card = incidentCard(this.app, live);
        const channel = log ? guild.channels.cache.get(log.channelId) : undefined;
        const edited =
          log && channel?.isTextBased()
            ? await channel.messages
                .edit(log.messageId, v2Edit(card))
                .then(() => true)
                .catch(() => false)
            : false;
        if (edited) return;
        const message = await this.app.logs.send(guild, 'antiraid', card);
        if (message) {
          live.summary.log = { channelId: message.channelId, messageId: message.id };
          await this.persist(live);
        }
      })
      .catch(() => undefined);
    return live.flushing;
  }
}
