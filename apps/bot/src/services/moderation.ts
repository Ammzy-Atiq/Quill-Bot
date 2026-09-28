import type { CaseSource, CaseType, ModAction } from '@quill/shared';
import {
  ChannelType,
  type ContainerBuilder,
  type Guild,
  type GuildMember,
  OverwriteType,
  PermissionFlagsBits,
  type Role,
  type User,
} from 'discord.js';
import type { App } from '../app.js';
import { formatDuration, truncate } from '../lib/format.js';
import { send, v2Message } from '../ui/respond.js';
import type { CaseRow } from './cases.js';

export interface ApplyOptions {
  reason: string;
  source: CaseSource;
  moderatorId?: string | null;
  points?: number;
  details?: Record<string, unknown>;
  /** DM sent to the member BEFORE the action (so kicks/bans can still reach them). */
  dm?: ContainerBuilder | null;
  /** Create a case (default true). */
  recordCase?: boolean;
  /** Post the case to the moderation log (default true). */
  logCase?: boolean;
}

export interface ApplyResult {
  ok: boolean;
  /** Action actually executed (may differ from requested, e.g. quarantine fallback). */
  applied: ModAction['type'] | null;
  error?: string;
  caseRow: CaseRow | null;
}

const auditReason = (source: CaseSource, reason: string) =>
  truncate(`QUILL GUARD | ${source}: ${reason}`, 500);

const CASE_TYPE: Record<ModAction['type'], CaseType | null> = {
  none: null,
  warn: 'warn',
  timeout: 'timeout',
  quarantine: 'quarantine',
  strip_roles: 'strip_roles',
  kick: 'kick',
  softban: 'softban',
  ban: 'ban',
};

/**
 * Executes punishments with Discord hierarchy checks and records them as cases.
 * Used by AutoMod, the Risk Engine, Anti-Nuke, Anti-Raid, Verification and moderators.
 */
export class ModerationService {
  constructor(private readonly app: App) {}

  /** Whether QUILL can act on this member (owner, self and higher roles are untouchable). */
  canActOn(guild: Guild, member: GuildMember | null): { ok: boolean; why?: string } {
    if (!member) return { ok: true };
    if (member.id === guild.ownerId) return { ok: false, why: 'the server owner cannot be punished' };
    if (member.id === this.app.client.user?.id) return { ok: false, why: 'QUILL cannot punish itself' };
    const me = guild.members.me;
    if (!me) return { ok: false, why: 'QUILL member not cached' };
    if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
      return { ok: false, why: "the member's highest role is above QUILL's role" };
    }
    return { ok: true };
  }

  async apply(
    guild: Guild,
    user: User,
    member: GuildMember | null,
    action: ModAction,
    opts: ApplyOptions,
  ): Promise<ApplyResult> {
    if (action.type === 'none') return { ok: true, applied: null, caseRow: null };
    const reason = auditReason(opts.source, opts.reason);
    const needsMember = action.type !== 'warn' && action.type !== 'ban' && action.type !== 'softban';
    if (needsMember && !member) {
      return { ok: false, applied: null, error: 'the member is not in the server', caseRow: null };
    }
    if (action.type !== 'warn') {
      const check = this.canActOn(guild, member);
      if (!check.ok) return { ok: false, applied: null, error: check.why, caseRow: null };
    }

    if (opts.dm) await user.send(v2Message(opts.dm)).catch(() => undefined);

    let details: Record<string, unknown> = { ...(opts.details ?? {}) };
    let applied: ModAction['type'] = action.type;
    let durationSeconds: number | null = null;
    try {
      switch (action.type) {
        case 'warn':
          break;
        case 'timeout': {
          if (!member) throw new Error('member is not in the server');
          durationSeconds = Math.min(action.durationSeconds, 28 * 86_400);
          await member.timeout(durationSeconds * 1000, reason);
          break;
        }
        case 'strip_roles': {
          if (!member) throw new Error('member is not in the server');
          details = { ...details, previousRoles: await this.stripRoles(member, reason) };
          break;
        }
        case 'quarantine': {
          if (!member) throw new Error('member is not in the server');
          const role = await this.ensureQuarantineRole(guild);
          const previousRoles = await this.stripRoles(member, reason, role ? [role.id] : []);
          details = { ...details, previousRoles, quarantineRoleId: role?.id ?? null };
          if (!role) applied = 'strip_roles';
          break;
        }
        case 'kick': {
          if (!member) throw new Error('member is not in the server');
          await member.kick(reason);
          break;
        }
        case 'softban': {
          await guild.bans.create(user.id, { reason, deleteMessageSeconds: 86_400 });
          await guild.bans.remove(user.id, 'QUILL GUARD softban (unban)').catch(() => undefined);
          break;
        }
        case 'ban': {
          await guild.bans.create(user.id, { reason, deleteMessageSeconds: action.deleteMessageSeconds });
          break;
        }
      }
    } catch (error) {
      this.app.logger.warn(
        { err: error, guildId: guild.id, action: action.type },
        'moderation action failed',
      );
      return {
        ok: false,
        applied: null,
        error: error instanceof Error ? error.message : String(error),
        caseRow: null,
      };
    }

    let caseRow: CaseRow | null = null;
    const caseType = CASE_TYPE[applied];
    if (caseType && opts.recordCase !== false) {
      const config = await this.app.configs.get(guild.id);
      caseRow = await this.app.cases.create(guild, {
        userId: user.id,
        moderatorId: opts.moderatorId ?? null,
        source: opts.source,
        type: caseType,
        reason: opts.reason,
        details,
        points: opts.points ?? 0,
        durationSeconds,
        expiresAt:
          caseType === 'warn'
            ? new Date(Date.now() + config.risk.warnExpiryDays * 86_400_000)
            : durationSeconds
              ? new Date(Date.now() + durationSeconds * 1000)
              : null,
        log: opts.logCase,
      });
    }
    return { ok: true, applied, caseRow };
  }

  /** Removes every role QUILL can remove; returns the removed role ids. */
  async stripRoles(member: GuildMember, reason: string, keep: string[] = []): Promise<string[]> {
    const me = member.guild.members.me;
    const removable = member.roles.cache.filter(
      (r) => r.id !== member.guild.id && !r.managed && (!me || r.comparePositionTo(me.roles.highest) < 0),
    );
    const kept = member.roles.cache
      .filter((r) => !removable.has(r.id) && r.id !== member.guild.id)
      .map((r) => r.id);
    await member.roles.set([...new Set([...kept, ...keep])], reason);
    return removable.map((r) => r.id);
  }

  /** Restores roles saved by strip_roles / quarantine. */
  async restoreRoles(member: GuildMember, roleIds: string[], reason: string, removeRoleId?: string | null) {
    const me = member.guild.members.me;
    const valid = roleIds.filter((id) => {
      const role = member.guild.roles.cache.get(id);
      return role && !role.managed && (!me || role.comparePositionTo(me.roles.highest) < 0);
    });
    if (removeRoleId) await member.roles.remove(removeRoleId, reason).catch(() => undefined);
    if (valid.length > 0) await member.roles.add(valid, reason);
  }

  /**
   * Returns the quarantine role, creating it on first use: no permissions, denied View Channel /
   * Send Messages / Connect in every category and top-level channel (applied in the background).
   */
  async ensureQuarantineRole(guild: Guild): Promise<Role | null> {
    const config = await this.app.configs.get(guild.id);
    const existing = config.antinuke.quarantineRoleId
      ? guild.roles.cache.get(config.antinuke.quarantineRoleId)
      : null;
    if (existing) return existing;
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return null;
    const role = await guild.roles.create({
      name: 'QUILL Quarantine',
      permissions: [],
      reason: 'QUILL GUARD quarantine role',
    });
    await role.setPosition(Math.max(1, me.roles.highest.position - 1)).catch(() => undefined);
    await this.app.configs.set(
      guild.id,
      this.app.client.user?.id ?? guild.ownerId,
      ['antinuke', 'quarantineRoleId'],
      role.id,
    );
    void this.applyQuarantineOverwrites(guild, role).catch((err: unknown) =>
      this.app.logger.warn({ err, guildId: guild.id }, 'quarantine overwrites failed'),
    );
    return role;
  }

  private async applyQuarantineOverwrites(guild: Guild, role: Role) {
    const targets = guild.channels.cache.filter(
      (c) =>
        c.type === ChannelType.GuildCategory || ('parentId' in c && c.parentId === null && !c.isThread()),
    );
    for (const channel of targets.values()) {
      if (!('permissionOverwrites' in channel)) continue;
      await channel.permissionOverwrites
        .edit(
          role,
          {
            ViewChannel: false,
            SendMessages: false,
            Connect: false,
            AddReactions: false,
            CreatePublicThreads: false,
          },
          { type: OverwriteType.Role, reason: 'QUILL GUARD quarantine' },
        )
        .catch(() => undefined);
    }
  }

  describe(action: ModAction): string {
    switch (action.type) {
      case 'timeout':
        return `Timeout ${formatDuration(action.durationSeconds)}`;
      case 'ban':
        return 'Ban';
      case 'softban':
        return 'Softban';
      case 'kick':
        return 'Kick';
      case 'quarantine':
        return 'Quarantine';
      case 'strip_roles':
        return 'Roles removed';
      case 'warn':
        return 'Warning';
      default:
        return 'No action';
    }
  }

  /** Sends a short-lived notice in a channel (auto-deleted after `ttlMs`). */
  async ephemeralNotice(
    channel: Parameters<typeof send>[0],
    container: ContainerBuilder,
    userId: string,
    ttlMs = 8000,
  ) {
    const message = await send(channel, container, { mentions: { users: [userId] } }).catch(() => null);
    if (message) setTimeout(() => void message.delete().catch(() => undefined), ttlMs).unref();
  }
}
