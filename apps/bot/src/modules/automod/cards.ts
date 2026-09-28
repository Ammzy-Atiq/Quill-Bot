import type { Violation } from '@quill/core';
import { DETECTOR_LABELS, type DetectorKey } from '@quill/shared';
import {
  ButtonBuilder,
  ButtonStyle,
  type ContainerBuilder,
  type GuildMember,
  type Message,
} from 'discord.js';
import { cid } from '../../framework/custom-id.js';
import { fullDate, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';

export const SEVERITY_DOT = ['', '⚪', '🟡', '🟠', '🔴', '⛔'] as const;

export const detectorLabel = (v: Violation) =>
  v.detector === 'policy' ? 'Server policy' : (DETECTOR_LABELS[v.detector as DetectorKey] ?? v.detector);

const spoiler = (text: string) => `||${text.replace(/\|/g, 'ǀ')}||`;

export function violationLines(violations: readonly Violation[]): string {
  return violations
    .map((v) => {
      const evidence =
        v.evidence.length > 0
          ? `\n-# ${v.evidence
              .slice(0, 4)
              .map((e) => spoiler(truncate(e, 60)))
              .join(' · ')}`
          : '';
      return `${SEVERITY_DOT[v.severity]} **${v.reason}** · ${detectorLabel(v)} · severity ${v.severity}${evidence}`;
    })
    .join('\n');
}

/** Moderator shortcuts attached to AutoMod log cards (public buttons, permission-checked). */
export function moderatorButtons(userId: string): ButtonBuilder[] {
  return [
    new ButtonBuilder()
      .setCustomId(cid('mod', 'history', userId))
      .setLabel('History')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid('mod', 'untimeout', userId))
      .setLabel('Remove timeout')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid('mod', 'riskreset', userId))
      .setLabel('Reset risk')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid('mod', 'ban', userId))
      .setLabel('Ban')
      .setStyle(ButtonStyle.Danger),
  ];
}

export interface AutomodLogOptions {
  message: Message<true>;
  member: GuildMember;
  violations: readonly Violation[];
  shadow: boolean;
  deleted: boolean;
  action?: { label: string; ok: boolean; error?: string } | null;
  risk?: { before: number; after: number; added: number } | null;
  caseNumber?: number | null;
  ai?: string | null;
}

export function automodLogCard(opts: AutomodLogOptions): ContainerBuilder {
  const { message, member } = opts;
  const title = opts.shadow
    ? 'AutoMod · shadow detection (no action)'
    : opts.deleted
      ? 'AutoMod · message removed'
      : 'AutoMod · violation';
  const lines: Array<[string, string]> = [];
  if (opts.action) {
    lines.push([
      'Action',
      opts.action.ok
        ? opts.action.label
        : `${opts.action.label} — ${E.warn} failed: ${opts.action.error ?? 'unknown error'}`,
    ]);
  }
  if (opts.risk)
    lines.push(['Risk score', `${opts.risk.before} → **${opts.risk.after}** (+${opts.risk.added})`]);
  if (opts.caseNumber) lines.push(['Case', `#${opts.caseNumber}`]);
  if (opts.ai) lines.push(['AI', opts.ai]);
  const content = message.content.trim();
  return Card.create()
    .header({ title, emoji: opts.shadow ? E.shadow : E.automod, level: 3 })
    .section(
      [
        `**Member:** <@${member.id}> · \`${member.user.tag}\``,
        `**Channel:** <#${message.channelId}> · [jump](${message.url})`,
      ],
      member.user.displayAvatarURL({ extension: 'png', size: 128 }),
    )
    .text(violationLines(opts.violations))
    .lines(lines)
    .text(content ? `**Message**\n${spoiler(truncate(content, 700))}` : null)
    .buttons(...(opts.shadow ? [] : moderatorButtons(member.id)))
    .footer(`QUILL GUARD AutoMod · ${fullDate(message.createdAt)}`)
    .build();
}
