import type { securityRepo } from '@quill/db';
import {
  ANTINUKE_ACTION_LABELS,
  type AntiNukeAction,
  type AntiNukePunishment,
  type ThreatLevel,
} from '@quill/shared';
import { ButtonBuilder, ButtonStyle, type ContainerBuilder } from 'discord.js';
import type { App } from '../../app.js';
import { cid } from '../../framework/custom-id.js';
import { relative, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { emptySummary, type IncidentSummary } from './types.js';

export const PUNISHMENT_LABELS: Record<AntiNukePunishment, string> = {
  ban: 'Ban',
  kick: 'Kick',
  strip_roles: 'Remove all roles',
  quarantine: 'Quarantine',
  alert: 'Alert only',
};

export const THREAT_EMOJI: Record<ThreatLevel, string> = {
  normal: '🟢',
  suspicious: '🟡',
  high: '🟠',
  critical: '🔴',
};

export const TRUST_LABELS: Record<string, string> = {
  owner: 'Server owner',
  self: 'QUILL',
  extra_owner: 'Extra owner (monitored by anti-betray)',
  whitelisted: 'Whitelisted (anti-betray limits)',
  untrusted: 'Not whitelisted',
};

const STATUS_LABELS = {
  open: '🔴 Open',
  contained: '🟢 Contained',
  resolved: '⚪ Resolved',
} as const;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** An incident as rendered on cards (live state or a stored row). */
export interface IncidentView {
  id: number;
  number: number;
  module: 'antinuke' | 'antiraid';
  actorId: string | null;
  status: 'open' | 'contained' | 'resolved';
  threatLevel: ThreatLevel;
  startedAt: Date;
  endedAt: Date | null;
  summary: IncidentSummary;
}

export function viewFromRow(row: securityRepo.IncidentRow): IncidentView {
  return {
    id: row.id,
    number: row.incidentNumber,
    module: row.module,
    actorId: row.actorId,
    status: row.status,
    threatLevel: row.threatLevel,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    summary: { ...emptySummary(), ...(row.summary as Partial<IncidentSummary>) },
  };
}

export function formatCounts(counts: IncidentSummary['counts']): string {
  return Object.entries(counts)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([action, n]) => `${ANTINUKE_ACTION_LABELS[action as AntiNukeAction] ?? action} ×${n}`)
    .join(' · ');
}

/** Incident card: live log card, `/incident view`, and the owner DM (`dm` drops the buttons). */
export function incidentCard(
  _app: App,
  view: IncidentView,
  opts: { dm?: boolean; guildName?: string } = {},
): ContainerBuilder {
  const s = view.summary;
  const raid = view.module === 'antiraid';
  const card = Card.create().header({
    title: raid ? `Raid #${view.number}` : `Anti-Nuke incident #${view.number}`,
    emoji: raid ? E.antiraid : E.siren,
    subtitle: `${STATUS_LABELS[view.status]} · started ${relative(view.startedAt)}${view.endedAt ? ` · closed ${relative(view.endedAt)}` : ''}`,
    level: 2,
  });

  if (!raid) {
    const p = s.punishment;
    const punishment = !p
      ? '—'
      : p.ok
        ? `${E.check} ${PUNISHMENT_LABELS[p.type]}${p.caseNumber ? ` · case #${p.caseNumber}` : ''}`
        : `${E.cross} failed — ${truncate(p.error ?? 'unknown error', 150)}`;
    card.lines([
      ['Actor', view.actorId ? `<@${view.actorId}> · \`${view.actorId}\`` : 'unknown'],
      ['Trust', TRUST_LABELS[s.trust ?? 'untrusted'] ?? String(s.trust)],
      [
        'Threat',
        `${THREAT_EMOJI[view.threatLevel]} ${capitalize(view.threatLevel)} · score ${s.threatScore}`,
      ],
      ['Actions', truncate(formatCounts(s.counts), 400) || '—'],
      ['Punishment', punishment],
      [
        'Recovery',
        `${s.reverts.reverted} reverted · ${s.reverts.failed} failed · ${s.reverts.skipped} not reversible`,
      ],
      ['Emergency mode', s.emergency ? `${E.siren} activated` : 'not needed'],
    ]);
  } else if (s.raid) {
    const r = s.raid;
    card.lines([
      ['Trigger', r.reason],
      ['Joins', `${r.joins} during raid mode · ${r.actioned} actioned (${r.action})`],
      [
        'Raid mode',
        r.endedAt ? `ended ${relative(r.endedAt)}` : r.endsAt ? `until ${relative(r.endsAt)}` : 'active',
      ],
      ['Invites', r.invitesPaused ? 'paused' : 'open'],
    ]);
  }

  if (s.timeline.length > 0) {
    card
      .divider()
      .text(
        `**Timeline**\n${s.timeline.map((e) => `<t:${Math.floor(e.at / 1000)}:T> ${truncate(e.text, 140)}`).join('\n')}`,
      );
  }
  if (s.notes.length > 0) card.text(s.notes.map((n) => `-# ${n}`).join('\n'));

  if (!opts.dm) {
    const p = s.punishment;
    const buttons: ButtonBuilder[] = [];
    if (raid) {
      if (s.raid && !s.raid.endedAt) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(cid('raid', 'end'))
            .setLabel('End raid mode')
            .setStyle(ButtonStyle.Danger),
        );
      }
    } else if (view.actorId) {
      if (!(p?.ok && p.type === 'ban')) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(cid('an', 'ban', view.number))
            .setLabel('Ban actor')
            .setEmoji(E.hammer)
            .setStyle(ButtonStyle.Danger),
        );
      } else {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(cid('an', 'unban', view.number))
            .setLabel('Unban (false alarm)')
            .setStyle(ButtonStyle.Secondary),
        );
      }
      if (p?.ok && (p.type === 'strip_roles' || p.type === 'quarantine') && p.previousRoles.length > 0) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(cid('an', 'release', view.number))
            .setLabel('Give roles back')
            .setStyle(ButtonStyle.Secondary),
        );
      }
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(cid('an', 'events', view.number))
        .setLabel('Full log')
        .setEmoji(E.scroll)
        .setStyle(ButtonStyle.Secondary),
    );
    if (view.status !== 'resolved') {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(cid('an', 'resolve', view.number))
          .setLabel('Mark resolved')
          .setStyle(ButtonStyle.Success),
      );
    }
    card.buttons(...buttons);
  }

  return card
    .footer(
      opts.dm
        ? `QUILL GUARD · ${opts.guildName ?? 'your server'} · manage it with /incident`
        : `QUILL GUARD ${raid ? 'Anti-Raid' : 'Anti-Nuke'} · buttons: server owner or extra owners`,
    )
    .build();
}
