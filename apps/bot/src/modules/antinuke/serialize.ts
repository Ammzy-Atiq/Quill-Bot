import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type OverwriteData,
  OverwriteType,
  type Role,
} from 'discord.js';

export interface SerializedOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface SerializedRole {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  permissions: string;
  mentionable: boolean;
  unicodeEmoji: string | null;
  /** Member ids (only captured in snapshots for roles with ≤ 1000 cached members). */
  members?: string[];
}

export interface SerializedChannel {
  id: string;
  type: number;
  name: string;
  parentId: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  bitrate: number | null;
  userLimit: number | null;
  overwrites: SerializedOverwrite[];
}

export interface GuildSnapshotData {
  version: 1;
  takenAt: string;
  guild: {
    name: string;
    verificationLevel: number;
    explicitContentFilter: number;
    defaultMessageNotifications: number;
    afkChannelId: string | null;
    afkTimeout: number;
    systemChannelId: string | null;
    description: string | null;
  };
  roles: SerializedRole[];
  channels: SerializedChannel[];
}

const RESTORABLE_TYPES = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildCategory,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
]);

export function serializeRole(role: Role, withMembers = false): SerializedRole {
  const data: SerializedRole = {
    id: role.id,
    name: role.name,
    color: role.colors.primaryColor,
    hoist: role.hoist,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
    mentionable: role.mentionable,
    unicodeEmoji: role.unicodeEmoji,
  };
  if (withMembers && role.members.size <= 1000) data.members = [...role.members.keys()];
  return data;
}

export function serializeChannel(channel: GuildBasedChannel): SerializedChannel | null {
  if (channel.isThread() || !RESTORABLE_TYPES.has(channel.type)) return null;
  const c = channel as GuildBasedChannel & {
    topic?: string | null;
    nsfw?: boolean;
    rateLimitPerUser?: number | null;
    bitrate?: number;
    userLimit?: number;
    rawPosition?: number;
  };
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    parentId: 'parentId' in channel ? channel.parentId : null,
    position: c.rawPosition ?? 0,
    topic: c.topic ?? null,
    nsfw: Boolean(c.nsfw),
    rateLimitPerUser: c.rateLimitPerUser ?? 0,
    bitrate: c.bitrate ?? null,
    userLimit: c.userLimit ?? null,
    overwrites:
      'permissionOverwrites' in channel
        ? channel.permissionOverwrites.cache.map((o) => ({
            id: o.id,
            type: o.type === OverwriteType.Member ? 1 : 0,
            allow: o.allow.bitfield.toString(),
            deny: o.deny.bitfield.toString(),
          }))
        : [],
  };
}

export function snapshotGuild(guild: Guild): GuildSnapshotData {
  return {
    version: 1,
    takenAt: new Date().toISOString(),
    guild: {
      name: guild.name,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      afkChannelId: guild.afkChannelId,
      afkTimeout: guild.afkTimeout,
      systemChannelId: guild.systemChannelId,
      description: guild.description,
    },
    roles: guild.roles.cache
      .filter((r) => !r.managed && r.id !== guild.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => serializeRole(r, true)),
    channels: guild.channels.cache
      .map(serializeChannel)
      .filter((c): c is SerializedChannel => c !== null)
      .sort((a, b) => a.position - b.position),
  };
}

/** Old id → id of the re-created object (a Map or any cache with `get`). */
export interface IdLookup {
  get(id: string): string | undefined;
}

/** Maps overwrite ids through `idMap` (old role id → new role id) and drops unknown targets. */
export function mapOverwrites(
  guild: Guild,
  overwrites: SerializedOverwrite[],
  idMap: IdLookup,
): OverwriteData[] {
  const out: OverwriteData[] = [];
  for (const o of overwrites) {
    const id = idMap.get(o.id) ?? o.id;
    const exists = o.type === 1 ? true : guild.roles.cache.has(id);
    if (!exists) continue;
    out.push({
      id,
      type: o.type === 1 ? OverwriteType.Member : OverwriteType.Role,
      allow: BigInt(o.allow),
      deny: BigInt(o.deny),
    });
  }
  return out;
}

export function channelCreateOptions(
  guild: Guild,
  data: SerializedChannel,
  idMap: IdLookup,
  reason: string,
): GuildChannelCreateOptions {
  const parent = data.parentId ? (idMap.get(data.parentId) ?? data.parentId) : null;
  const options: GuildChannelCreateOptions = {
    name: data.name,
    type: data.type as GuildChannelCreateOptions['type'],
    permissionOverwrites: mapOverwrites(guild, data.overwrites, idMap),
    reason,
  };
  if (parent && guild.channels.cache.has(parent) && data.type !== ChannelType.GuildCategory)
    options.parent = parent;
  if (data.topic) options.topic = data.topic;
  if (data.nsfw) options.nsfw = true;
  if (data.rateLimitPerUser) options.rateLimitPerUser = data.rateLimitPerUser;
  if (data.bitrate) options.bitrate = Math.min(data.bitrate, 96_000);
  if (data.userLimit) options.userLimit = data.userLimit;
  return options;
}
