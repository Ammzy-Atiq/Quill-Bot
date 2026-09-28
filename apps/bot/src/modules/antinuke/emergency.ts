import { securityRepo } from '@quill/db';
import { ChannelType, type Guild, PermissionFlagsBits } from 'discord.js';
import type { App } from '../../app.js';
import { LruCache } from '../../lib/lru.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { baseVars, renderTemplate } from '../../ui/templates.js';
import { DANGEROUS_BITS, dangerousNames } from './mapping.js';

interface PreviousState {
  roles: Array<{ id: string; permissions: string }>;
  channels: Array<{ id: string; allow: string | null; deny: string | null }>;
  invitesPaused: boolean;
}

export interface EmergencyReport {
  roles: number;
  channels: number;
  invitesPaused: boolean;
  skipped: string[];
}

const REASON = 'QUILL GUARD emergency mode';

/**
 * Emergency mode (Olympus "emergency situation", extended): removes dangerous permissions from
 * every protectable role, optionally locks channels and pauses invites, and remembers exactly
 * what it changed so `deactivate` can put everything back.
 */
export class EmergencyService {
  private readonly active = new LruCache<string, boolean>(10_000, 30_000);

  constructor(private readonly app: App) {}

  async isActive(guildId: string): Promise<boolean> {
    const cached = this.active.get(guildId);
    if (cached !== undefined) return cached;
    const row = await securityRepo.getEmergency(this.app.db, guildId);
    const value = Boolean(row?.active);
    this.active.set(guildId, value);
    return value;
  }

  async activate(
    guild: Guild,
    reason: string,
    automatic: boolean,
    triggeredBy: string | null,
  ): Promise<EmergencyReport> {
    const lock = await this.app.store.setNx(`quill:emergency:lock:${guild.id}`, '1', 60);
    if (!lock || (await this.isActive(guild.id)))
      return { roles: 0, channels: 0, invitesPaused: false, skipped: ['already active'] };
    const config = (await this.app.configs.get(guild.id)).antinuke;
    await this.app.snapshots
      .capture(guild, 'pre_emergency', `Before emergency: ${reason}`.slice(0, 100), triggeredBy)
      .catch(() => null);

    const me = guild.members.me;
    const previous: PreviousState = { roles: [], channels: [], invitesPaused: false };
    const skipped: string[] = [];
    const protectedIds = new Set(config.emergency.protectedRoleIds);
    const roles = guild.roles.cache.filter(
      (r) =>
        !r.managed &&
        (protectedIds.size > 0 ? protectedIds.has(r.id) : (r.permissions.bitfield & DANGEROUS_BITS) !== 0n),
    );
    for (const role of roles.values()) {
      if (me && role.comparePositionTo(me.roles.highest) >= 0) {
        skipped.push(`@${role.name} (above QUILL)`);
        continue;
      }
      const before = role.permissions.bitfield;
      try {
        await role.setPermissions(before & ~DANGEROUS_BITS, REASON);
        previous.roles.push({ id: role.id, permissions: before.toString() });
      } catch {
        skipped.push(`@${role.name}`);
      }
    }

    if (config.emergency.lockChannels) {
      const everyone = guild.roles.everyone;
      const channels = guild.channels.cache.filter(
        (c) =>
          c.type === ChannelType.GuildText ||
          c.type === ChannelType.GuildAnnouncement ||
          c.type === ChannelType.GuildForum,
      );
      for (const channel of channels.values()) {
        if (!('permissionOverwrites' in channel)) continue;
        const existing = channel.permissionOverwrites.cache.get(everyone.id);
        try {
          await channel.permissionOverwrites.edit(
            everyone,
            {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              AddReactions: false,
            },
            { reason: REASON },
          );
          previous.channels.push({
            id: channel.id,
            allow: existing ? existing.allow.bitfield.toString() : null,
            deny: existing ? existing.deny.bitfield.toString() : null,
          });
        } catch {
          skipped.push(`#${channel.name}`);
        }
      }
    }

    if (config.emergency.pauseInvites && me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      try {
        await guild.setIncidentActions({ invitesDisabledUntil: new Date(Date.now() + 24 * 3_600_000) });
        previous.invitesPaused = true;
      } catch {
        skipped.push('pause invites');
      }
    }

    await securityRepo.saveEmergency(this.app.db, {
      guildId: guild.id,
      active: true,
      reason,
      triggeredBy,
      automatic,
      previous: previous as unknown as Record<string, unknown>,
      startedAt: new Date(),
      endedAt: null,
    });
    this.active.set(guild.id, true);

    const report: EmergencyReport = {
      roles: previous.roles.length,
      channels: previous.channels.length,
      invitesPaused: previous.invitesPaused,
      skipped,
    };
    const guildConfig = await this.app.configs.get(guild.id);
    await this.app.logs.send(guild, 'antinuke', [
      this.card(guild, report, reason, automatic, triggeredBy),
      renderTemplate(this.app, guildConfig, 'emergency_notice', { ...baseVars(guild), reason }),
    ]);
    return report;
  }

  async deactivate(guild: Guild, by: string): Promise<{ roles: number; channels: number }> {
    const row = await securityRepo.getEmergency(this.app.db, guild.id);
    if (!row?.active) return { roles: 0, channels: 0 };
    const previous = row.previous as unknown as PreviousState;
    let roles = 0;
    let channels = 0;
    for (const saved of previous.roles ?? []) {
      const role = guild.roles.cache.get(saved.id);
      if (!role) continue;
      await role
        .setPermissions(BigInt(saved.permissions), 'QUILL GUARD emergency ended')
        .then(() => roles++)
        .catch(() => undefined);
    }
    for (const saved of previous.channels ?? []) {
      const channel = guild.channels.cache.get(saved.id);
      if (!channel || !('permissionOverwrites' in channel)) continue;
      const everyone = guild.roles.everyone.id;
      const op =
        saved.allow === null
          ? channel.permissionOverwrites.delete(everyone, 'QUILL GUARD emergency ended')
          : channel.permissionOverwrites.set(
              [
                ...channel.permissionOverwrites.cache.filter((o) => o.id !== everyone).values(),
                { id: everyone, allow: BigInt(saved.allow), deny: BigInt(saved.deny ?? '0') },
              ],
              'QUILL GUARD emergency ended',
            );
      await op.then(() => channels++).catch(() => undefined);
    }
    if (previous.invitesPaused)
      await guild.setIncidentActions({ invitesDisabledUntil: null }).catch(() => undefined);
    await securityRepo.saveEmergency(this.app.db, {
      guildId: guild.id,
      active: false,
      reason: row.reason,
      triggeredBy: row.triggeredBy,
      automatic: row.automatic,
      previous: {},
      startedAt: row.startedAt,
      endedAt: new Date(),
    });
    this.active.set(guild.id, false);
    await this.app.logs.send(
      guild,
      'antinuke',
      Card.create()
        .header({ title: 'Emergency mode ended', emoji: E.unlock, level: 3 })
        .text(
          `Restored permissions on **${roles}** role(s) and **${channels}** channel(s). Ended by <@${by}>.`,
        )
        .build(),
    );
    return { roles, channels };
  }

  card(guild: Guild, report: EmergencyReport, reason: string, automatic: boolean, by: string | null) {
    return Card.create()
      .header({
        title: 'EMERGENCY MODE ACTIVE',
        emoji: E.siren,
        subtitle: `${automatic ? 'Triggered automatically' : `Started by <@${by}>`} · ${reason}`,
        level: 2,
      })
      .lines([
        [
          'Dangerous permissions removed from',
          `${report.roles} role(s) (${dangerousNames(DANGEROUS_BITS).length} permission types)`,
        ],
        ['Channels locked', String(report.channels)],
        ['Invites paused', report.invitesPaused ? 'yes (24h)' : 'no'],
      ])
      .text(report.skipped.length > 0 ? `${E.warn} Skipped: ${report.skipped.slice(0, 10).join(', ')}` : null)
      .footer(
        `Run /emergency end when ${guild.name} is safe again — everything QUILL changed will be restored.`,
      )
      .build();
  }
}
