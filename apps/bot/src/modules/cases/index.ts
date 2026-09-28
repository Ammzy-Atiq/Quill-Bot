import { cases as caseRepo } from '@quill/db';
import { ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { App } from '../../app.js';
import { lockedId } from '../../framework/custom-id.js';
import {
  type BotModule,
  type ComponentHandler,
  type SlashCommand,
  UserError,
} from '../../framework/types.js';
import { relative, truncate } from '../../lib/format.js';
import { CASE_SOURCE_LABELS, CASE_TYPE_META } from '../../services/cases.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply, update } from '../../ui/respond.js';

const PAGE_SIZE = 8;

async function casesPage(app: App, guildId: string, viewerId: string, userId: string, page: number) {
  const [rows, total, warnings] = await Promise.all([
    caseRepo.listUserCases(app.db, guildId, userId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    caseRepo.countUserCases(app.db, guildId, userId),
    caseRepo.countActiveWarnings(app.db, guildId, userId),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lines = rows.map((row) => {
    const meta = CASE_TYPE_META[row.type];
    const inactive = row.active ? '' : ' · ~~inactive~~';
    return `${meta.emoji} **#${row.caseNumber} ${meta.label}** · ${CASE_SOURCE_LABELS[row.source]} · ${relative(row.createdAt)}${inactive}\n-# ${truncate(row.reason || 'No reason', 120)}`;
  });
  return Card.create()
    .header({
      title: 'Case history',
      emoji: E.scroll,
      subtitle: `<@${userId}> · ${total} case(s) · ${warnings} active warning(s)`,
    })
    .divider()
    .text(lines.join('\n') || 'No cases for this member. ✨')
    .buttons(
      new ButtonBuilder()
        .setCustomId(lockedId(viewerId, 'cases', 'page', userId, page - 1))
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(lockedId(viewerId, 'cases', 'page', userId, page + 1))
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page + 1 >= pages),
    )
    .footer(`Page ${page + 1} of ${pages}`)
    .build();
}

const caseCommand: SlashCommand = {
  module: 'moderation',
  permission: 'moderator',
  subcommandPermissions: { delete: 'manager' },
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('View and manage moderation cases.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show one case.')
        .addIntegerOption((o) =>
          o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription("Show a member's case history.")
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('reason')
        .setDescription('Change the reason of a case.')
        .addIntegerOption((o) =>
          o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1),
        )
        .addStringOption((o) =>
          o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(1000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Mark a case inactive (e.g. remove a warning).')
        .addIntegerOption((o) =>
          o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1),
        ),
    ),
  async execute({ app, interaction, guild }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'history') {
      const user = interaction.options.getUser('user', true);
      await reply(interaction, await casesPage(app, guild.id, interaction.user.id, user.id, 0), {
        ephemeral: true,
      });
      return;
    }
    const number = interaction.options.getInteger('number', true);
    if (sub === 'view') {
      const row = await caseRepo.getCase(app.db, guild.id, number);
      if (!row) throw new UserError(`Case #${number} does not exist.`, 'Case not found');
      await reply(interaction, app.cases.card(row), { ephemeral: true });
      return;
    }
    if (sub === 'reason') {
      const row = await caseRepo.updateCaseReason(
        app.db,
        guild.id,
        number,
        interaction.options.getString('reason', true),
      );
      if (!row) throw new UserError(`Case #${number} does not exist.`, 'Case not found');
      await reply(interaction, app.cases.card(row), { ephemeral: true });
      return;
    }
    if (sub === 'delete') {
      const ok = await caseRepo.deactivateCase(app.db, guild.id, number);
      if (!ok) throw new UserError(`Case #${number} does not exist.`, 'Case not found');
      await reply(interaction, successCard(`Case #${number} is now inactive`), { ephemeral: true });
    }
  },
};

const casesComponents: ComponentHandler[] = [
  {
    id: 'cases:page',
    permission: 'moderator',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const [userId, pageRaw] = args;
      const page = Math.max(0, Number(pageRaw) || 0);
      await update(interaction, await casesPage(app, guild.id, interaction.user.id, userId!, page));
    },
  },
];

export const casesModule: BotModule = {
  name: 'moderation',
  commands: [caseCommand],
  components: casesComponents,
};
