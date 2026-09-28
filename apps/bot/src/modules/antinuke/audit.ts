import { securityRepo } from '@quill/db';
import { ANTINUKE_ACTIONS, type GuildConfig } from '@quill/shared';
import { type Guild, GuildMFALevel, GuildVerificationLevel, PermissionFlagsBits } from 'discord.js';
import type { App } from '../../app.js';
import { relative } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { dangerousNames, hasDangerous } from './mapping.js';

export type AuditLevel = 'high' | 'medium' | 'low' | 'ok';

export interface AuditCheck {
  level: AuditLevel;
  text: string;
}

export interface AuditReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  checks: AuditCheck[];
}

const PENALTY: Record<AuditLevel, number> = { high: 15, medium: 7, low: 3, ok: 0 };
const ICON: Record<AuditLevel, string> = { high: '🔴', medium: '🟠', low: '🟡', ok: '✅' };
const ORDER: AuditLevel[] = ['high', 'medium', 'low', 'ok'];

/** Hardening audit: how well can QUILL protect this server right now? */
export async function auditGuild(app: App, guild: Guild, config: GuildConfig): Promise<AuditReport> {
  const checks: AuditCheck[] = [];
  const add = (level: AuditLevel, text: string) => checks.push({ level, text });
  const an = config.antinuke;
  const trust = await app.trust.get(guild.id);
  const me = guild.members.me;

  if (!me) {
    add('high', 'QUILL is not cached in this server yet — try again in a minute.');
  } else {
    if (me.permissions.has(PermissionFlagsBits.Administrator)) add('ok', 'QUILL has Administrator.');
    else add('high', 'QUILL lacks **Administrator** — some reverts (overwrites, roles) will fail.');
    if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      add('high', 'Missing **View Audit Log** — Anti-Nuke cannot see who did what.');
    }
    const above = guild.roles.cache.filter(
      (r) => r.id !== guild.id && r.comparePositionTo(me.roles.highest) > 0,
    );
    const dangerousAbove = above.filter((r) => hasDangerous(r.permissions.bitfield));
    if (dangerousAbove.size > 0) {
      add(
        'high',
        `${dangerousAbove.size} role(s) with dangerous permissions sit above QUILL (${dangerousAbove
          .first(5)
          .map((r) => `<@&${r.id}>`)
          .join(', ')}) — QUILL cannot stop their members. Move QUILL's role to the top.`,
      );
    } else if (above.size > 0) {
      add('low', `${above.size} role(s) are above QUILL — move QUILL's role to the top.`);
    } else {
      add('ok', "QUILL's role is at the top.");
    }
  }

  if (an.enabled) add('ok', `Anti-Nuke is on (${an.mode} mode).`);
  else add('high', 'Anti-Nuke is **off** — run `/antinuke enable`.');
  if (an.punishment === 'alert')
    add('medium', 'Punishment is **alert only** — attackers are reported but not stopped.');
  if (!an.revert) add('medium', 'Revert is off — destructive actions are not undone.');
  if (an.mode === 'threshold') {
    add(
      'low',
      'Threshold mode lets a few actions through before reacting — strict mode stops the first one.',
    );
  }

  const logChannel = config.logging.channels.antinuke ?? config.logging.defaultChannelId;
  if (logChannel) add('ok', 'Anti-Nuke log channel is set.');
  else add('medium', 'No Anti-Nuke log channel — incidents only reach the owner by DM. Use `/logs set`.');

  const everyoneDanger = dangerousNames(guild.roles.everyone.permissions.bitfield);
  if (everyoneDanger.length > 0)
    add('high', `@everyone has dangerous permissions: ${everyoneDanger.join(', ')}.`);

  const adminRoles = guild.roles.cache.filter(
    (r) => !r.managed && r.id !== guild.id && r.permissions.has(PermissionFlagsBits.Administrator),
  );
  if (adminRoles.size > 3)
    add('low', `${adminRoles.size} roles have Administrator — fewer admin roles, fewer ways in.`);

  const riskyBots = guild.roles.cache
    .filter(
      (r) => r.managed && r.tags?.botId && r.tags.botId !== me?.id && hasDangerous(r.permissions.bitfield),
    )
    .map((r) => r.tags!.botId!);
  const unlisted = riskyBots.filter((id) => !trust.whitelist.has(id) && !trust.extraOwners.has(id));
  if (unlisted.length > 0) {
    add(
      'medium',
      `${unlisted.length} bot(s) with dangerous permissions are not whitelisted (${unlisted
        .slice(0, 5)
        .map((id) => `<@${id}>`)
        .join(', ')}) — whitelist the ones you trust, or Anti-Nuke will punish them when they act.`,
    );
  }
  const everything = [...trust.whitelist.values()].filter(
    (set) => set.size >= ANTINUKE_ACTIONS.length,
  ).length;
  if (everything > 0)
    add('low', `${everything} user(s) are whitelisted for every action — give only what they need.`);

  if (guild.mfaLevel !== GuildMFALevel.Elevated) {
    add('medium', 'Moderators are not required to use 2FA (Server Settings → Safety Setup).');
  }
  if (guild.verificationLevel < GuildVerificationLevel.Medium)
    add('low', 'Server verification level is below Medium.');

  const latest = await securityRepo.latestSnapshot(app.db, guild.id).catch(() => undefined);
  if (!latest) add('medium', 'No snapshot yet — run `/backup create` so QUILL can rebuild the server.');
  else if (Date.now() - latest.createdAt.getTime() > 48 * 3_600_000) {
    add('low', `The latest snapshot is from ${relative(latest.createdAt)}.`);
  } else {
    add('ok', `Latest snapshot ${relative(latest.createdAt)}.`);
  }

  if (guild.vanityURLCode) {
    add(
      'low',
      `Vanity URL \`${guild.vanityURLCode}\` cannot be restored by bots if stolen — keep Manage Server very limited.`,
    );
  }
  if (!config.antiraid.enabled) add('low', 'Anti-Raid is off — `/antiraid enable`.');

  checks.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  const score = Math.max(0, 100 - checks.reduce((sum, c) => sum + PENALTY[c.level], 0));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, checks };
}

export function auditCard(app: App, guild: Guild, report: AuditReport) {
  const issues = report.checks.filter((c) => c.level !== 'ok');
  const passed = report.checks.filter((c) => c.level === 'ok');
  return Card.create()
    .header({
      title: `Security audit — grade ${report.grade}`,
      emoji: E.shield,
      subtitle: `**${report.score}/100** for ${guild.name}`,
      thumbnail: app.logo(),
    })
    .divider()
    .text(
      issues.length > 0
        ? `**To fix**\n${issues.map((c) => `${ICON[c.level]} ${c.text}`).join('\n')}`
        : `${E.sparkles} Nothing to fix — well protected.`,
    )
    .text(passed.length > 0 ? `**Passed**\n${passed.map((c) => `${ICON.ok} ${c.text}`).join('\n')}` : null)
    .footer('🔴 high · 🟠 medium · 🟡 low — re-run /antinuke audit after changes')
    .build();
}
