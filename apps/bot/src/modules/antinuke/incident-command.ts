import { securityRepo } from '@quill/db';
import { ANTINUKE_ACTION_LABELS, type AntiNukeAction } from '@quill/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { App } from '../../app.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { relative, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { reply, update } from '../../ui/respond.js';
import { type IncidentView, incidentCard, THREAT_EMOJI, viewFromRow } from './cards.js';
import { type PunishmentRecord, pushTimeline } from './types.js';

const STATUS_EMOJI = { open: '🔴', contained: '🟢', resolved: '⚪' } as const;

async function loadView(app: App, guildId: string, number: number): Promise<IncidentView> {
  const live = app.antinuke.live(guildId, number);
  if (live) return live;
  const row = await securityRepo.getIncident(app.db, guildId, number);
  if (!row) throw new UserError(`Incident #${number} does not exist.`);
  return viewFromRow(row);
}

async function mutate(
  app: App,
  guildId: string,
  number: number,
  fn: (view: IncidentView) => void | Promise<void>,
) {
  const view = await app.antinuke.mutateIncident(guildId, number, fn);
  if (!view) throw new UserError(`Incident #${number} does not exist.`);
  return view;
}

const punishmentOf = (view: IncidentView): PunishmentRecord =>
  view.summary.punishment ?? {
    type: 'alert',
    ok: false,
    error: null,
    caseNumber: null,
    previousRoles: [],
    quarantineRoleId: null,
    bot: false,
  };

export const incidentCommand: SlashCommand = {
  module: 'antinuke',
  permission: 'moderator',
  subcommandPermissions: { resolve: 'extra_owner' },
  data: new SlashCommandBuilder()
    .setName('incident')
    .setDescription('Anti-Nuke and Anti-Raid incidents with their timelines.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) => s.setName('list').setDescription('Recent incidents.'))
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show an incident and its timeline.')
        .addIntegerOption((o) =>
          o.setName('number').setDescription('Incident number').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('resolve')
        .setDescription('Mark an incident as resolved.')
        .addIntegerOption((o) =>
          o.setName('number').setDescription('Incident number').setRequired(true).setMinValue(1),
        ),
    ),
  async execute({ app, interaction, guild }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await securityRepo.listIncidents(app.db, guild.id, 15);
      await reply(
        interaction,
        Card.create()
          .header({ title: 'Incidents', emoji: E.siren, subtitle: `${rows.length} most recent` })
          .text(
            rows
              .map(
                (r) =>
                  `${STATUS_EMOJI[r.status]} **#${r.incidentNumber}** · ${r.module === 'antiraid' ? 'raid' : 'anti-nuke'} · ${THREAT_EMOJI[r.threatLevel]} ${r.threatLevel}${r.actorId ? ` · <@${r.actorId}>` : ''} · ${relative(r.startedAt)}`,
              )
              .join('\n') || `No incidents yet. ${E.sparkles}`,
          )
          .footer('Open one with /incident view number:<n>')
          .build(),
        { ephemeral: true },
      );
      return;
    }
    const number = interaction.options.getInteger('number', true);
    if (sub === 'view') {
      await reply(interaction, incidentCard(app, await loadView(app, guild.id, number)), { ephemeral: true });
      return;
    }
    const view = await mutate(app, guild.id, number, (v) => {
      v.status = 'resolved';
      v.endedAt ??= new Date();
      pushTimeline(v.summary, `${E.check} Marked resolved by <@${interaction.user.id}>`);
    });
    await reply(interaction, incidentCard(app, view), { ephemeral: true });
  },
};

export const incidentComponents: ComponentHandler[] = [
  {
    id: 'an:ban',
    permission: 'extra_owner',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const number = Number(args[0]);
      const current = await loadView(app, guild.id, number);
      if (!current.actorId) throw new UserError('This incident has no actor.');
      const user = await app.client.users.fetch(current.actorId);
      const member = await guild.members.fetch(user.id).catch(() => null);
      const result = await app.moderation.apply(
        guild,
        user,
        member,
        { type: 'ban', deleteMessageSeconds: 3_600 },
        {
          reason: `Anti-Nuke incident #${number} (banned by ${interaction.user.username})`,
          source: 'antinuke',
          moderatorId: interaction.user.id,
          logCase: false,
        },
      );
      if (!result.ok) throw new UserError(result.error ?? 'The ban failed.');
      const view = await mutate(app, guild.id, number, (v) => {
        v.summary.punishment = {
          ...punishmentOf(v),
          type: 'ban',
          ok: true,
          error: null,
          caseNumber: result.caseRow?.caseNumber ?? null,
        };
        if (v.status === 'open') v.status = 'contained';
        pushTimeline(v.summary, `${E.hammer} Banned by <@${interaction.user.id}>`);
      });
      await update(interaction, incidentCard(app, view));
    },
  },
  {
    id: 'an:unban',
    permission: 'extra_owner',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const number = Number(args[0]);
      const current = await loadView(app, guild.id, number);
      if (!current.actorId) throw new UserError('This incident has no actor.');
      await guild.bans.remove(
        current.actorId,
        `QUILL GUARD | incident #${number} false alarm (${interaction.user.username})`,
      );
      await app.cases.create(guild, {
        userId: current.actorId,
        moderatorId: interaction.user.id,
        source: 'antinuke',
        type: 'unban',
        reason: `Anti-Nuke incident #${number} marked as a false alarm`,
      });
      const view = await mutate(app, guild.id, number, (v) => {
        v.summary.punishment = { ...punishmentOf(v), ok: false, error: 'undone (false alarm)' };
        v.status = 'resolved';
        v.endedAt ??= new Date();
        pushTimeline(v.summary, `${E.unlock} Unbanned by <@${interaction.user.id}> — false alarm`);
      });
      await update(interaction, incidentCard(app, view));
    },
  },
  {
    id: 'an:release',
    permission: 'extra_owner',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const number = Number(args[0]);
      const current = await loadView(app, guild.id, number);
      const punishment = current.summary.punishment;
      if (!current.actorId || !punishment?.previousRoles.length)
        throw new UserError('There are no roles to give back.');
      const member = await guild.members.fetch(current.actorId).catch(() => null);
      if (!member) throw new UserError('That member is no longer in the server.');
      await app.moderation.restoreRoles(
        member,
        punishment.previousRoles,
        `QUILL GUARD | incident #${number} false alarm (${interaction.user.username})`,
        punishment.quarantineRoleId,
      );
      const view = await mutate(app, guild.id, number, (v) => {
        v.summary.punishment = {
          ...punishmentOf(v),
          ok: false,
          error: 'undone (false alarm)',
          previousRoles: [],
        };
        v.status = 'resolved';
        v.endedAt ??= new Date();
        pushTimeline(v.summary, `${E.unlock} Roles given back by <@${interaction.user.id}> — false alarm`);
      });
      await update(interaction, incidentCard(app, view));
    },
  },
  {
    id: 'an:events',
    permission: 'moderator',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const view = await loadView(app, guild.id, Number(args[0]));
      const events = await securityRepo.incidentEvents(app.db, view.id, 60);
      const lines = events.map((e) => {
        const label = ANTINUKE_ACTION_LABELS[e.action as AntiNukeAction] ?? e.action.replace(/_/g, ' ');
        const response = e.response as { punish?: boolean; reason?: string };
        return `<t:${Math.floor(e.createdAt.getTime() / 1000)}:T> **${label}**${e.targetId ? ` · \`${e.targetId}\`` : ''}${response.punish ? ` · ${E.hammer}` : ''}${response.reason ? ` · ${truncate(response.reason, 60)}` : ''}`;
      });
      const shown: string[] = [];
      let length = 0;
      for (const line of lines) {
        if (length + line.length > 3_300) break;
        shown.push(line);
        length += line.length + 1;
      }
      const rest = lines.length - shown.length;
      const text = `${shown.join('\n')}${rest > 0 ? `\n…and ${rest} more` : ''}`;
      await reply(
        interaction,
        Card.create()
          .header({ title: `Incident #${view.number} — full log`, emoji: E.scroll, level: 3 })
          .text(text || 'No events recorded.')
          .build(),
        { ephemeral: true },
      );
    },
  },
  {
    id: 'an:resolve',
    permission: 'extra_owner',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const view = await mutate(app, guild.id, Number(args[0]), (v) => {
        v.status = 'resolved';
        v.endedAt ??= new Date();
        pushTimeline(v.summary, `${E.check} Marked resolved by <@${interaction.user.id}>`);
      });
      await update(interaction, incidentCard(app, view));
    },
  },
];
