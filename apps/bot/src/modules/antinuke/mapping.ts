import { type AntiNukeAction, DANGEROUS_PERMISSIONS } from '@quill/shared';
import {
  AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';

export const DANGEROUS_BITS: bigint = DANGEROUS_PERMISSIONS.reduce(
  (bits, name) => bits | PermissionFlagsBits[name],
  0n,
);

export const hasDangerous = (permissions: bigint | string | null | undefined) =>
  permissions !== null && permissions !== undefined && (BigInt(permissions) & DANGEROUS_BITS) !== 0n;

/** Human names of the dangerous permissions contained in a bitfield. */
export function dangerousNames(permissions: bigint | string): string[] {
  return new PermissionsBitField(BigInt(permissions) & DANGEROUS_BITS).toArray();
}

export interface MappedEntry {
  action: AntiNukeAction;
  /** Grants dangerous permissions or touches a protected channel. */
  dangerous: boolean;
  targetId: string | null;
}

type Changes = GuildAuditLogsEntry['changes'];

export function changeMap(changes: Changes, side: 'old' | 'new'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const change of changes) {
    const value = side === 'old' ? change.old : change.new;
    if (value !== undefined) out[change.key] = value;
  }
  return out;
}

function addedRoleIds(changes: Changes): string[] {
  const added = changes.find((c) => c.key === '$add')?.new as Array<{ id: string }> | undefined;
  return added?.map((r) => r.id) ?? [];
}

/**
 * Maps a GUILD_AUDIT_LOG_ENTRY_CREATE entry to a protected anti-nuke action.
 * Returns null for entries anti-nuke does not care about (nickname changes, harmless role grants…).
 */
export function mapAuditEntry(
  entry: GuildAuditLogsEntry,
  guild: Guild,
  protectedChannels: readonly string[],
): MappedEntry | null {
  const targetId = entry.targetId ?? null;
  const isProtected = targetId !== null && protectedChannels.includes(targetId);
  switch (entry.action) {
    case AuditLogEvent.GuildUpdate:
      return {
        action: entry.changes.some((c) => c.key === 'vanity_url_code') ? 'vanity_update' : 'guild_update',
        dangerous: entry.changes.some((c) => c.key === 'mfa_level' || c.key === 'verification_level'),
        targetId,
      };
    case AuditLogEvent.ChannelCreate:
      return { action: 'channel_create', dangerous: false, targetId };
    case AuditLogEvent.ChannelDelete:
      return { action: 'channel_delete', dangerous: isProtected, targetId };
    case AuditLogEvent.ChannelUpdate:
    case AuditLogEvent.ChannelOverwriteCreate:
    case AuditLogEvent.ChannelOverwriteUpdate:
    case AuditLogEvent.ChannelOverwriteDelete: {
      const newAllow = entry.changes.find((c) => c.key === 'allow')?.new as string | undefined;
      return { action: 'channel_update', dangerous: isProtected || hasDangerous(newAllow), targetId };
    }
    case AuditLogEvent.MemberKick:
      return { action: 'kick', dangerous: false, targetId };
    case AuditLogEvent.MemberPrune:
      return { action: 'prune', dangerous: true, targetId };
    case AuditLogEvent.MemberBanAdd:
      return { action: 'ban', dangerous: false, targetId };
    case AuditLogEvent.MemberUpdate: {
      const timeout = entry.changes.find((c) => c.key === 'communication_disabled_until');
      if (!timeout?.new) return null;
      return { action: 'member_timeout', dangerous: false, targetId };
    }
    case AuditLogEvent.MemberRoleUpdate: {
      const dangerousRole = addedRoleIds(entry.changes).some((id) =>
        hasDangerous(guild.roles.cache.get(id)?.permissions.bitfield),
      );
      if (!dangerousRole) return null;
      return { action: 'member_role_update', dangerous: true, targetId };
    }
    case AuditLogEvent.BotAdd:
      return { action: 'bot_add', dangerous: false, targetId };
    case AuditLogEvent.RoleCreate: {
      const perms = entry.changes.find((c) => c.key === 'permissions')?.new as string | undefined;
      return { action: 'role_create', dangerous: hasDangerous(perms), targetId };
    }
    case AuditLogEvent.RoleDelete:
      return { action: 'role_delete', dangerous: false, targetId };
    case AuditLogEvent.RoleUpdate: {
      const change = entry.changes.find((c) => c.key === 'permissions');
      const gained = change
        ? (BigInt((change.new as string | undefined) ?? '0') &
            ~BigInt((change.old as string | undefined) ?? '0') &
            DANGEROUS_BITS) !==
          0n
        : false;
      return { action: 'role_update', dangerous: gained, targetId };
    }
    case AuditLogEvent.WebhookCreate:
      return { action: 'webhook_create', dangerous: false, targetId };
    case AuditLogEvent.WebhookUpdate:
      return { action: 'webhook_update', dangerous: false, targetId };
    case AuditLogEvent.WebhookDelete:
      return { action: 'webhook_delete', dangerous: false, targetId };
    case AuditLogEvent.EmojiDelete:
    case AuditLogEvent.StickerDelete:
      return { action: 'emoji_delete', dangerous: false, targetId };
    case AuditLogEvent.IntegrationCreate:
      // Bot integrations are covered by BotAdd (same invite, separate audit entry).
      if (entry.changes.some((c) => c.key === 'type' && c.new === 'discord')) return null;
      return { action: 'integration_create', dangerous: false, targetId };
    case AuditLogEvent.AutoModerationRuleDelete:
      return { action: 'automod_rule_delete', dangerous: false, targetId };
    default:
      return null;
  }
}
