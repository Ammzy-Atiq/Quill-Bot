import { setTimeout as sleep } from 'node:timers/promises';
import { securityRepo } from '@quill/db';
import {
  AuditLogEvent,
  type AutoModerationActionOptions,
  type AutoModerationRuleCreateOptions,
  type AutoModerationTriggerMetadataOptions,
  ChannelType,
  type Guild,
  type GuildChannel,
  type GuildChannelEditOptions,
  type GuildDefaultMessageNotifications,
  type GuildEditOptions,
  type GuildExplicitContentFilter,
  type GuildVerificationLevel,
  type RoleEditOptions,
  Routes,
  type WebhookEditOptions,
} from 'discord.js';
import type { App } from '../../app.js';
import { LruCache } from '../../lib/lru.js';
import {
  channelCreateOptions,
  type GuildSnapshotData,
  type IdLookup,
  type SerializedChannel,
  type SerializedRole,
} from './serialize.js';
import type { AuditChange, EventRecord, RevertResult } from './types.js';

const REASON = 'QUILL GUARD anti-nuke: reverting an unauthorized change';

const ok = (note: string): RevertResult => ({ outcome: 'reverted', note });
const skip = (note: string): RevertResult => ({ outcome: 'skipped', note });
const fail = (note: string): RevertResult => ({ outcome: 'failed', note });

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `{ key: oldValue }` for every change of an audit entry (null when the old value was unset). */
export function oldValues(changes: readonly AuditChange[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const change of changes) out[change.key] = change.old ?? null;
  return out;
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;

/** Rebuilds a deleted channel from the CHANNEL_DELETE audit entry (no parent/position there). */
export function channelFromChanges(id: string, changes: readonly AuditChange[]): SerializedChannel | null {
  const old = oldValues(changes);
  if (typeof old.name !== 'string' || typeof old.type !== 'number') return null;
  const overwrites = Array.isArray(old.permission_overwrites)
    ? (old.permission_overwrites as Array<{ id: string; type: number; allow: string; deny: string }>).map(
        (o) => ({
          id: o.id,
          type: (o.type === 1 ? 1 : 0) as 0 | 1,
          allow: String(o.allow ?? '0'),
          deny: String(o.deny ?? '0'),
        }),
      )
    : [];
  return {
    id,
    type: old.type,
    name: old.name,
    parentId: null,
    position: 0,
    topic: typeof old.topic === 'string' ? old.topic : null,
    nsfw: Boolean(old.nsfw),
    rateLimitPerUser: Number(old.rate_limit_per_user ?? 0),
    bitrate: typeof old.bitrate === 'number' ? old.bitrate : null,
    userLimit: typeof old.user_limit === 'number' ? old.user_limit : null,
    overwrites,
  };
}

/** Rebuilds a deleted role from the ROLE_DELETE audit entry. */
export function roleFromChanges(id: string, changes: readonly AuditChange[]): SerializedRole | null {
  const old = oldValues(changes);
  if (typeof old.name !== 'string') return null;
  return {
    id,
    name: old.name,
    color: Number(old.color ?? 0),
    hoist: Boolean(old.hoist),
    position: 1,
    permissions: String(old.permissions ?? '0'),
    mentionable: Boolean(old.mentionable),
    unicodeEmoji: null,
  };
}

/**
 * Undoes protected actions. Keeps short-lived copies of deleted channels/roles/emojis (filled by
 * the delete events) and remembers which deleted ids were re-created so later restores (children
 * of a re-created category, overwrites of a re-created role) point at the new objects.
 */
export class Reverter {
  readonly deletedChannels = new LruCache<string, SerializedChannel>(5_000, 30 * 60_000);
  readonly deletedRoles = new LruCache<string, SerializedRole>(5_000, 30 * 60_000);
  readonly deletedEmojis = new LruCache<string, { name: string; url: string }>(2_000, 30 * 60_000);
  /** Deleted id → id of the object QUILL re-created (roles and channels). */
  readonly idMap = new LruCache<string, string>(20_000, 6 * 3_600_000);
  /** Re-created channel id → original parent id (to re-parent once the category is back). */
  private readonly recreatedChannels = new LruCache<string, { guildId: string; parentId: string | null }>(
    5_000,
    3_600_000,
  );
  private readonly snapshots = new LruCache<string, { createdAt: number; data: GuildSnapshotData }>(
    500,
    60_000,
  );

  constructor(private readonly app: App) {}

  private get botId(): string {
    return this.app.client.user?.id ?? '0';
  }

  private readonly lookup: IdLookup = { get: (id) => this.idMap.get(id) };

  async revert(guild: Guild, record: EventRecord): Promise<RevertResult> {
    try {
      return await this.run(guild, record);
    } catch (error) {
      return fail(errorText(error));
    }
  }

  private async run(guild: Guild, r: EventRecord): Promise<RevertResult> {
    const target = r.targetId;
    switch (r.action) {
      case 'ban': {
        if (!target) return skip('no target');
        await guild.bans.remove(target, REASON);
        return ok(`unbanned <@${target}>`);
      }
      case 'kick':
        return skip('kicked members cannot be re-added automatically');
      case 'prune':
        return skip('pruned members cannot be re-added automatically');
      case 'bot_add':
        return this.removeBot(guild, target);
      case 'guild_update':
        return this.revertGuild(guild, r.changes);
      case 'vanity_update':
        return skip('Discord does not let bots restore a vanity URL — reclaim it in Server Settings');
      case 'member_role_update': {
        const added = (
          (r.changes.find((c) => c.key === '$add')?.new as Array<{ id: string }> | undefined) ?? []
        ).map((role) => role.id);
        const member = target ? await guild.members.fetch(target).catch(() => null) : null;
        if (!member) return skip('member left');
        const removable = added.filter((id) => member.roles.cache.has(id));
        if (removable.length === 0) return skip('roles already removed');
        await member.roles.remove(removable, REASON);
        return ok(`removed ${removable.map((id) => `<@&${id}>`).join(', ')} from <@${member.id}>`);
      }
      case 'member_timeout': {
        const member = target ? await guild.members.fetch(target).catch(() => null) : null;
        if (!member) return skip('member left');
        await member.timeout(null, REASON);
        return ok(`removed the timeout from <@${member.id}>`);
      }
      case 'channel_create': {
        const channel = target ? guild.channels.cache.get(target) : undefined;
        if (!channel) return skip('channel already gone');
        await channel.delete(REASON);
        return ok(`deleted #${channel.name}`);
      }
      case 'channel_delete':
        return this.restoreChannel(guild, r);
      case 'channel_update':
        return this.revertChannelUpdate(guild, r);
      case 'role_create': {
        const role = target ? guild.roles.cache.get(target) : undefined;
        if (!role) return skip('role already gone');
        await role.delete(REASON);
        return ok(`deleted @${role.name}`);
      }
      case 'role_delete':
        return this.restoreRole(guild, r);
      case 'role_update':
        return this.revertRoleUpdate(guild, r);
      case 'webhook_create': {
        if (!target) return skip('no target');
        await this.app.client.deleteWebhook(target, { reason: REASON });
        return ok('deleted the new webhook');
      }
      case 'webhook_update': {
        if (!target) return skip('no target');
        const old = oldValues(r.changes);
        const edit: WebhookEditOptions = {};
        if (typeof old.name === 'string') edit.name = old.name;
        if (typeof old.channel_id === 'string') edit.channel = old.channel_id;
        if (Object.keys(edit).length === 0) return skip('nothing QUILL can roll back');
        const webhook = await this.app.client.fetchWebhook(target);
        await webhook.edit({ ...edit, reason: REASON });
        return ok('rolled back the webhook');
      }
      case 'webhook_delete':
        return skip('deleted webhooks cannot be restored (Discord issues a new URL)');
      case 'emoji_delete':
        return this.restoreEmoji(guild, r);
      case 'integration_create': {
        const integrations = await guild.fetchIntegrations();
        const integration = target ? integrations.get(target) : undefined;
        if (!integration) return skip('integration already gone');
        await integration.delete(REASON);
        return ok(`removed the ${integration.name} integration`);
      }
      case 'automod_rule_delete':
        return this.restoreAutoModRule(guild, r.changes);
      case 'mention_everyone': {
        if (!r.message) return skip('no message');
        const channel = guild.channels.cache.get(r.message.channelId);
        if (!channel?.isTextBased()) return skip('channel gone');
        await channel.messages.delete(r.message.messageId);
        return ok('deleted the @everyone message');
      }
    }
  }

  /** Kicks or bans (per `botAddAction`) a bot that was added without permission. */
  async removeBot(guild: Guild, botId: string | null): Promise<RevertResult> {
    if (!botId) return skip('no target');
    const reason = 'QUILL GUARD anti-nuke: bot added without permission';
    const config = await this.app.configs.get(guild.id);
    if (config.antinuke.botAddAction === 'ban') {
      await guild.bans.create(botId, { reason });
      return ok(`banned the bot <@${botId}>`);
    }
    const member = await guild.members.fetch(botId).catch(() => null);
    if (!member) return skip('the bot already left');
    await member.kick(reason);
    return ok(`kicked the bot <@${botId}>`);
  }

  private async revertGuild(guild: Guild, changes: readonly AuditChange[]): Promise<RevertResult> {
    const old = oldValues(changes);
    const edit: GuildEditOptions = {};
    const nullable = (key: string) => (typeof old[key] === 'string' ? (old[key] as string) : null);
    if (typeof old.name === 'string') edit.name = old.name;
    if ('description' in old) edit.description = nullable('description');
    if (typeof old.verification_level === 'number') {
      edit.verificationLevel = old.verification_level as GuildVerificationLevel;
    }
    if (typeof old.explicit_content_filter === 'number') {
      edit.explicitContentFilter = old.explicit_content_filter as GuildExplicitContentFilter;
    }
    if (typeof old.default_message_notifications === 'number') {
      edit.defaultMessageNotifications =
        old.default_message_notifications as GuildDefaultMessageNotifications;
    }
    if ('afk_channel_id' in old) edit.afkChannel = nullable('afk_channel_id');
    if (typeof old.afk_timeout === 'number') edit.afkTimeout = old.afk_timeout;
    if ('system_channel_id' in old) edit.systemChannel = nullable('system_channel_id');
    if ('rules_channel_id' in old) edit.rulesChannel = nullable('rules_channel_id');
    if ('public_updates_channel_id' in old) edit.publicUpdatesChannel = nullable('public_updates_channel_id');
    // Old images are still served by the CDN right after a change.
    if ('icon_hash' in old) {
      const hash = nullable('icon_hash');
      edit.icon = hash
        ? this.app.client.rest.cdn.icon(guild.id, hash, { extension: 'png', size: 1024 })
        : null;
    }
    if ('banner_hash' in old) {
      const hash = nullable('banner_hash');
      edit.banner = hash
        ? this.app.client.rest.cdn.banner(guild.id, hash, { extension: 'png', size: 4096 })
        : null;
    }
    const keys = Object.keys(edit);
    if (keys.length === 0) return skip('nothing QUILL can roll back');
    await guild.edit({ ...edit, reason: REASON });
    return ok(`restored server ${keys.join(', ')}`);
  }

  private async restoreChannel(guild: Guild, r: EventRecord): Promise<RevertResult> {
    const oldId = r.targetId;
    if (!oldId) return skip('no target');
    if (this.idMap.get(oldId)) return skip('already re-created');
    const data =
      (await this.waitForDeleted(this.deletedChannels, oldId)) ??
      (await this.snapshotBefore(guild.id, r.at))?.channels.find((c) => c.id === oldId) ??
      channelFromChanges(oldId, r.changes);
    if (!data) return fail('no copy of the channel (cache, snapshot and audit log all empty)');
    const created = await guild.channels.create(channelCreateOptions(guild, data, this.lookup, REASON));
    this.idMap.set(oldId, created.id);
    this.recreatedChannels.set(created.id, { guildId: guild.id, parentId: data.parentId });
    await created.setPosition(data.position).catch(() => undefined);
    if (data.type === ChannelType.GuildCategory) await this.reparentChildren(guild, oldId, created.id, r.at);
    await this.app.configs.replaceId(guild.id, this.botId, oldId, created.id).catch(() => 0);
    return ok(`re-created #${data.name}`);
  }

  /** Puts channels back into a re-created category (Discord un-parents them on deletion). */
  private async reparentChildren(guild: Guild, oldCategoryId: string, newCategoryId: string, at: number) {
    const snapshot = await this.snapshotBefore(guild.id, at);
    const children = new Set<string>();
    for (const channel of snapshot?.channels ?? []) {
      if (channel.parentId === oldCategoryId) children.add(this.idMap.get(channel.id) ?? channel.id);
    }
    for (const channel of guild.channels.cache.values()) {
      const info = this.recreatedChannels.get(channel.id);
      if (info?.parentId === oldCategoryId) children.add(channel.id);
    }
    for (const id of children) {
      const channel = guild.channels.cache.get(id);
      if (!channel || channel.isThread() || channel.type === ChannelType.GuildCategory || channel.parentId)
        continue;
      await channel
        .setParent(newCategoryId, { lockPermissions: false, reason: REASON })
        .catch(() => undefined);
    }
  }

  private async revertChannelUpdate(guild: Guild, r: EventRecord): Promise<RevertResult> {
    const channel = r.targetId ? guild.channels.cache.get(r.targetId) : undefined;
    if (!channel || channel.isThread()) return skip('channel gone');
    const old = oldValues(r.changes);
    switch (r.auditAction) {
      case AuditLogEvent.ChannelOverwriteCreate: {
        if (!r.overwrite) return skip('unknown overwrite');
        await this.app.client.rest.delete(Routes.channelPermission(channel.id, r.overwrite.id), {
          reason: REASON,
        });
        return ok(`removed a new permission overwrite in #${channel.name}`);
      }
      case AuditLogEvent.ChannelOverwriteUpdate:
      case AuditLogEvent.ChannelOverwriteDelete: {
        if (!r.overwrite) return skip('unknown overwrite');
        const current = channel.permissionOverwrites.cache.get(r.overwrite.id);
        const allow = 'allow' in old ? String(old.allow ?? '0') : (current?.allow.bitfield.toString() ?? '0');
        const deny = 'deny' in old ? String(old.deny ?? '0') : (current?.deny.bitfield.toString() ?? '0');
        await this.app.client.rest.put(Routes.channelPermission(channel.id, r.overwrite.id), {
          body: { type: r.overwrite.type, allow, deny },
          reason: REASON,
        });
        return ok(`restored permissions in #${channel.name}`);
      }
      default: {
        const edit: GuildChannelEditOptions = {};
        if (typeof old.name === 'string') edit.name = old.name;
        if ('topic' in old) edit.topic = typeof old.topic === 'string' ? old.topic : null;
        if ('nsfw' in old) edit.nsfw = Boolean(old.nsfw);
        if ('rate_limit_per_user' in old) edit.rateLimitPerUser = Number(old.rate_limit_per_user ?? 0);
        if (typeof old.bitrate === 'number') edit.bitrate = old.bitrate;
        if ('user_limit' in old) edit.userLimit = Number(old.user_limit ?? 0);
        if (Object.keys(edit).length === 0) return skip('nothing QUILL can roll back');
        await (channel as GuildChannel).edit({ ...edit, reason: REASON });
        return ok(`rolled back #${channel.name}`);
      }
    }
  }

  private async restoreRole(guild: Guild, r: EventRecord): Promise<RevertResult> {
    const oldId = r.targetId;
    if (!oldId) return skip('no target');
    if (this.idMap.get(oldId)) return skip('already re-created');
    const snapshot = await this.snapshotBefore(guild.id, r.at);
    const fromSnapshot = snapshot?.roles.find((role) => role.id === oldId);
    const data =
      (await this.waitForDeleted(this.deletedRoles, oldId)) ??
      fromSnapshot ??
      roleFromChanges(oldId, r.changes);
    if (!data) return fail('no copy of the role');
    const created = await guild.roles.create({
      name: data.name,
      colors: { primaryColor: data.color },
      hoist: data.hoist,
      permissions: BigInt(data.permissions),
      mentionable: data.mentionable,
      reason: REASON,
    });
    this.idMap.set(oldId, created.id);
    const top = Math.max(1, (guild.members.me?.roles.highest.position ?? 2) - 1);
    await created
      .setPosition(Math.min(Math.max(1, data.position), top), { reason: REASON })
      .catch(() => undefined);

    // Discord drops a deleted role's channel overwrites — put them back from the snapshot.
    let overwrites = 0;
    for (const channel of snapshot?.channels ?? []) {
      const saved = channel.overwrites.find((o) => o.id === oldId && o.type === 0);
      const liveId = this.idMap.get(channel.id) ?? channel.id;
      if (!saved || !guild.channels.cache.has(liveId)) continue;
      await this.app.client.rest
        .put(Routes.channelPermission(liveId, created.id), {
          body: { type: 0, allow: saved.allow, deny: saved.deny },
          reason: REASON,
        })
        .then(() => overwrites++)
        .catch(() => undefined);
    }

    const members = data.members?.length ? data.members : (fromSnapshot?.members ?? []);
    if (members.length > 0) void this.reassign(guild, created.id, members);
    await this.app.configs.replaceId(guild.id, this.botId, oldId, created.id).catch(() => 0);
    const extras = [
      overwrites ? `${overwrites} channel permission set(s)` : '',
      members.length ? `giving it back to ${members.length} member(s)` : '',
    ].filter(Boolean);
    return ok(`re-created @${data.name}${extras.length ? ` (${extras.join(', ')})` : ''}`);
  }

  /** Gives a re-created role back to its members (background; large roles take a while). */
  private async reassign(guild: Guild, roleId: string, memberIds: readonly string[]) {
    for (const id of memberIds.slice(0, 1000)) {
      const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
      if (!member || member.roles.cache.has(roleId)) continue;
      await member.roles.add(roleId, REASON).catch(() => undefined);
    }
  }

  private async revertRoleUpdate(guild: Guild, r: EventRecord): Promise<RevertResult> {
    const role = r.targetId ? guild.roles.cache.get(r.targetId) : undefined;
    if (!role) return skip('role gone');
    const old = oldValues(r.changes);
    const edit: RoleEditOptions = {};
    if (typeof old.name === 'string') edit.name = old.name;
    if ('permissions' in old) edit.permissions = BigInt(String(old.permissions ?? '0'));
    if ('color' in old) edit.colors = { primaryColor: Number(old.color ?? 0) };
    if ('hoist' in old) edit.hoist = Boolean(old.hoist);
    if ('mentionable' in old) edit.mentionable = Boolean(old.mentionable);
    if (Object.keys(edit).length === 0) return skip('nothing QUILL can roll back');
    await role.edit({ ...edit, reason: REASON });
    return ok(`rolled back @${role.name}`);
  }

  private async restoreEmoji(guild: Guild, r: EventRecord): Promise<RevertResult> {
    if (r.auditAction === AuditLogEvent.StickerDelete) return skip('deleted stickers cannot be restored');
    const id = r.targetId;
    if (!id) return skip('no target');
    const cached = await this.waitForDeleted(this.deletedEmojis, id);
    const old = oldValues(r.changes);
    const name = cached?.name ?? (typeof old.name === 'string' ? old.name : null);
    if (!name) return fail('unknown emoji');
    // The CDN keeps serving a deleted emoji for a while.
    const url = cached?.url ?? `https://cdn.discordapp.com/emojis/${id}.png`;
    await guild.emojis.create({ attachment: url, name, reason: REASON });
    return ok(`re-created :${name}:`);
  }

  private async restoreAutoModRule(guild: Guild, changes: readonly AuditChange[]): Promise<RevertResult> {
    const old = oldValues(changes);
    if (typeof old.name !== 'string' || typeof old.trigger_type !== 'number' || !Array.isArray(old.actions)) {
      return skip('the audit log did not include the rule details');
    }
    const meta = (old.trigger_metadata ?? {}) as Record<string, unknown>;
    const triggerMetadata: AutoModerationTriggerMetadataOptions = {};
    const keywords = strings(meta.keyword_filter);
    const regex = strings(meta.regex_patterns);
    const allow = strings(meta.allow_list);
    if (keywords) triggerMetadata.keywordFilter = keywords;
    if (regex) triggerMetadata.regexPatterns = regex;
    if (allow) triggerMetadata.allowList = allow;
    if (Array.isArray(meta.presets)) triggerMetadata.presets = meta.presets as number[];
    if (typeof meta.mention_total_limit === 'number')
      triggerMetadata.mentionTotalLimit = meta.mention_total_limit;
    if (typeof meta.mention_raid_protection_enabled === 'boolean') {
      triggerMetadata.mentionRaidProtectionEnabled = meta.mention_raid_protection_enabled;
    }
    const actions = (old.actions as Array<{ type: number; metadata?: Record<string, unknown> }>).map((a) => {
      const metadata: NonNullable<AutoModerationActionOptions['metadata']> = {};
      if (typeof a.metadata?.channel_id === 'string') metadata.channel = a.metadata.channel_id;
      if (typeof a.metadata?.duration_seconds === 'number')
        metadata.durationSeconds = a.metadata.duration_seconds;
      if (typeof a.metadata?.custom_message === 'string') metadata.customMessage = a.metadata.custom_message;
      return { type: a.type, metadata } as AutoModerationActionOptions;
    });
    const options: AutoModerationRuleCreateOptions = {
      name: old.name,
      eventType: Number(old.event_type ?? 1),
      triggerType: old.trigger_type,
      triggerMetadata,
      actions,
      enabled: old.enabled !== false,
      exemptRoles: strings(old.exempt_roles) ?? [],
      exemptChannels: strings(old.exempt_channels) ?? [],
      reason: REASON,
    };
    await guild.autoModerationRules.create(options);
    return ok(`re-created the AutoMod rule "${old.name}"`);
  }

  /** The delete gateway event can land just after the audit entry — wait briefly for the copy. */
  private async waitForDeleted<T>(cache: LruCache<string, T>, id: string): Promise<T | undefined> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const hit = cache.get(id);
      if (hit) return hit;
      await sleep(250);
    }
    return undefined;
  }

  /** Newest snapshot taken before `at` (never one taken during the attack). */
  async snapshotBefore(guildId: string, at: number): Promise<GuildSnapshotData | null> {
    const cached = this.snapshots.get(guildId);
    if (cached && cached.createdAt < at) return cached.data;
    const row = await securityRepo.latestSnapshot(this.app.db, guildId, new Date(at)).catch(() => undefined);
    if (!row) return null;
    const entry = { createdAt: row.createdAt.getTime(), data: row.data as unknown as GuildSnapshotData };
    this.snapshots.set(guildId, entry);
    return entry.data;
  }
}
