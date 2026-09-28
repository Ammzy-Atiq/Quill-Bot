import type { GuildConfig } from '@quill/shared';
import { type GuildMember, PermissionFlagsBits } from 'discord.js';
import type { App } from '../app.js';
import { PERMISSION_LEVELS, type PermissionLevel } from './types.js';

const rank = (level: PermissionLevel) => PERMISSION_LEVELS.indexOf(level);

/** Highest permission level a member holds in QUILL. */
export async function memberLevel(
  app: App,
  member: GuildMember,
  config: GuildConfig,
): Promise<PermissionLevel> {
  if (member.id === member.guild.ownerId) return 'owner';
  if (await app.trust.isExtraOwner(member.guild.id, member.id)) return 'extra_owner';
  const perms = member.permissions;
  const roles = member.roles.cache;
  if (
    perms.has(PermissionFlagsBits.ManageGuild) ||
    config.general.managerRoleIds.some((id) => roles.has(id))
  ) {
    return 'manager';
  }
  if (
    perms.any([
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ManageMessages,
    ]) ||
    config.general.modRoleIds.some((id) => roles.has(id))
  ) {
    return 'moderator';
  }
  return 'everyone';
}

export function meetsLevel(actual: PermissionLevel, required: PermissionLevel): boolean {
  return rank(actual) >= rank(required);
}

export async function hasLevel(
  app: App,
  member: GuildMember,
  config: GuildConfig,
  required: PermissionLevel,
): Promise<boolean> {
  if (required === 'everyone') return true;
  return meetsLevel(await memberLevel(app, member, config), required);
}
