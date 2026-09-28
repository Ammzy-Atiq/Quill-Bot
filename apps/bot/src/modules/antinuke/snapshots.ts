import { securityRepo } from '@quill/db';
import { ChannelType, type Guild } from 'discord.js';
import type { App } from '../../app.js';
import { channelCreateOptions, type GuildSnapshotData, snapshotGuild } from './serialize.js';

export interface RestoreReport {
  rolesCreated: number;
  rolesUpdated: number;
  channelsCreated: number;
  channelsUpdated: number;
  membersReassigned: number;
  errors: string[];
}

const SCHEDULER_INTERVAL_MS = 15 * 60_000;

/** Server structure snapshots (roles, channels, overwrites, settings) and restore. */
export class SnapshotService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly app: App) {}

  async capture(
    guild: Guild,
    kind: 'auto' | 'manual' | 'pre_emergency',
    label: string | null,
    createdBy: string | null,
  ) {
    const data = snapshotGuild(guild);
    const row = await securityRepo.saveSnapshot(this.app.db, {
      guildId: guild.id,
      kind,
      label,
      createdBy,
      roleCount: data.roles.length,
      channelCount: data.channels.length,
      data: data as unknown as Record<string, unknown>,
    });
    if (kind === 'auto') {
      const config = await this.app.configs.get(guild.id);
      await securityRepo.pruneAutoSnapshots(this.app.db, guild.id, config.antinuke.snapshotRetention);
    }
    return row;
  }

  /** Periodic automatic snapshots for guilds with anti-nuke enabled (per shard, jittered). */
  start(): void {
    if (this.timer) return;
    const tick = async () => {
      for (const guild of this.app.client.guilds.cache.values()) {
        try {
          const config = await this.app.configs.get(guild.id);
          const hours = config.antinuke.snapshotIntervalHours;
          if (!config.antinuke.enabled || hours === 0) continue;
          const fresh = await this.app.store.setNx(`quill:snap:auto:${guild.id}`, '1', hours * 3600);
          if (fresh) await this.capture(guild, 'auto', null, null);
        } catch (err) {
          this.app.logger.warn({ err, guildId: guild.id }, 'auto snapshot failed');
        }
      }
    };
    setTimeout(() => void tick(), 60_000 + Math.random() * 60_000).unref();
    this.timer = setInterval(() => void tick(), SCHEDULER_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Restores a snapshot. `missing` only recreates deleted roles/channels (safe after a nuke);
   * `full` also resets permissions/overwrites of existing ones to the snapshot.
   */
  async restore(
    guild: Guild,
    data: GuildSnapshotData,
    mode: 'missing' | 'full',
    progress: (message: string) => Promise<void> | void,
  ): Promise<RestoreReport> {
    const report: RestoreReport = {
      rolesCreated: 0,
      rolesUpdated: 0,
      channelsCreated: 0,
      channelsUpdated: 0,
      membersReassigned: 0,
      errors: [],
    };
    const reason = 'QUILL GUARD snapshot restore';
    const idMap = new Map<string, string>();
    const me = guild.members.me;

    // 1. Roles (lowest first so positions stay in order)
    await progress('Restoring roles…');
    for (const role of [...data.roles].sort((a, b) => a.position - b.position)) {
      const existing = guild.roles.cache.get(role.id);
      if (existing) {
        if (
          mode === 'full' &&
          existing.permissions.bitfield.toString() !== role.permissions &&
          me &&
          existing.comparePositionTo(me.roles.highest) < 0
        ) {
          await existing
            .setPermissions(BigInt(role.permissions), reason)
            .then(() => report.rolesUpdated++)
            .catch((e: Error) => report.errors.push(`role ${role.name}: ${e.message}`));
        }
        continue;
      }
      try {
        const created = await guild.roles.create({
          name: role.name,
          colors: { primaryColor: role.color },
          hoist: role.hoist,
          permissions: BigInt(role.permissions),
          mentionable: role.mentionable,
          reason,
        });
        idMap.set(role.id, created.id);
        report.rolesCreated++;
      } catch (e) {
        report.errors.push(`role ${role.name}: ${(e as Error).message}`);
      }
    }
    if (idMap.size > 0) {
      const positions = data.roles
        .filter((r) => idMap.has(r.id))
        .map((r) => ({
          role: idMap.get(r.id)!,
          position: Math.min(r.position, Math.max(1, (me?.roles.highest.position ?? 2) - 1)),
        }));
      await guild.roles
        .setPositions(positions)
        .catch((e: Error) => report.errors.push(`role positions: ${e.message}`));
    }

    // 2. Channels (categories first, then children)
    await progress('Restoring channels…');
    const ordered = [...data.channels].sort(
      (a, b) =>
        Number(b.type === ChannelType.GuildCategory) - Number(a.type === ChannelType.GuildCategory) ||
        a.position - b.position,
    );
    for (const channel of ordered) {
      const existing = guild.channels.cache.get(channel.id);
      if (existing) {
        if (mode === 'full' && 'permissionOverwrites' in existing) {
          const options = channelCreateOptions(guild, channel, idMap, reason);
          await existing.permissionOverwrites
            .set(options.permissionOverwrites ?? [], reason)
            .then(() => report.channelsUpdated++)
            .catch((e: Error) => report.errors.push(`#${channel.name}: ${e.message}`));
        }
        continue;
      }
      try {
        const created = await guild.channels.create(channelCreateOptions(guild, channel, idMap, reason));
        idMap.set(channel.id, created.id);
        report.channelsCreated++;
        await created.setPosition(channel.position).catch(() => undefined);
      } catch (e) {
        report.errors.push(`#${channel.name}: ${(e as Error).message}`);
      }
    }

    // 3. Give recreated roles back to their members
    const recreated = data.roles.filter((r) => idMap.has(r.id) && r.members && r.members.length > 0);
    if (recreated.length > 0) await progress('Giving roles back to members…');
    for (const role of recreated) {
      const newId = idMap.get(role.id)!;
      for (const memberId of role.members!.slice(0, 1000)) {
        const member =
          guild.members.cache.get(memberId) ?? (await guild.members.fetch(memberId).catch(() => null));
        if (!member) continue;
        await member.roles
          .add(newId, reason)
          .then(() => report.membersReassigned++)
          .catch(() => undefined);
      }
    }

    // 4. Server settings (full mode only)
    if (mode === 'full') {
      await guild
        .edit({
          name: data.guild.name,
          verificationLevel: data.guild.verificationLevel,
          explicitContentFilter: data.guild.explicitContentFilter,
          defaultMessageNotifications: data.guild.defaultMessageNotifications,
          afkTimeout: data.guild.afkTimeout,
          reason,
        })
        .catch((e: Error) => report.errors.push(`settings: ${e.message}`));
    }
    return report;
  }
}
