import { cases as caseRepo } from '@quill/db';
import type { CaseSource, CaseType } from '@quill/shared';
import type { ContainerBuilder, Guild } from 'discord.js';
import type { App } from '../app.js';
import { formatDuration, fullDate, truncate } from '../lib/format.js';
import { Card } from '../ui/card.js';
import { E } from '../ui/emojis.js';

export type CaseRow = caseRepo.CaseRow;

export const CASE_TYPE_META: Record<CaseType, { label: string; emoji: string }> = {
  warn: { label: 'Warning', emoji: E.warn },
  timeout: { label: 'Timeout', emoji: E.mute },
  untimeout: { label: 'Timeout removed', emoji: E.unlock },
  quarantine: { label: 'Quarantine', emoji: E.lock },
  unquarantine: { label: 'Quarantine lifted', emoji: E.unlock },
  strip_roles: { label: 'Roles stripped', emoji: E.lock },
  kick: { label: 'Kick', emoji: E.boot },
  softban: { label: 'Softban', emoji: E.hammer },
  ban: { label: 'Ban', emoji: E.hammer },
  unban: { label: 'Unban', emoji: E.unlock },
  delete: { label: 'Message deleted', emoji: E.trash },
  note: { label: 'Note', emoji: E.scroll },
};

export const CASE_SOURCE_LABELS: Record<CaseSource, string> = {
  manual: 'Manual',
  automod: 'AutoMod',
  risk: 'Risk Engine',
  antinuke: 'Anti-Nuke',
  antiraid: 'Anti-Raid',
  verification: 'Verification',
};

export interface CreateCaseInput {
  userId: string;
  moderatorId: string | null;
  source: CaseSource;
  type: CaseType;
  reason: string;
  details?: Record<string, unknown>;
  points?: number;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
  /** Post the case card to the moderation log (default true). */
  log?: boolean;
}

export class CaseService {
  constructor(private readonly app: App) {}

  async create(guild: Guild, input: CreateCaseInput): Promise<CaseRow> {
    const row = await caseRepo.createCase(this.app.db, { guildId: guild.id, ...input });
    if (input.log !== false) await this.app.logs.send(guild, 'moderation', this.card(row));
    return row;
  }

  card(row: CaseRow): ContainerBuilder {
    const meta = CASE_TYPE_META[row.type];
    const moderator = row.moderatorId ? `<@${row.moderatorId}>` : `${E.quill} QUILL GUARD (automatic)`;
    const lines: Array<[string, string]> = [
      ['User', `<@${row.userId}> (\`${row.userId}\`)`],
      ['Moderator', moderator],
      ['Source', CASE_SOURCE_LABELS[row.source]],
    ];
    if (row.durationSeconds) lines.push(['Duration', formatDuration(row.durationSeconds)]);
    if (row.points > 0) lines.push(['Risk points', `+${Math.round(row.points * 10) / 10}`]);
    if (!row.active) lines.push(['Status', 'Inactive']);
    return Card.create()
      .header({ title: `${meta.label} · Case #${row.caseNumber}`, emoji: meta.emoji, level: 3 })
      .lines(lines)
      .text(`**Reason**\n${truncate(row.reason || 'No reason provided', 900)}`)
      .footer(fullDate(row.createdAt))
      .build();
  }
}
