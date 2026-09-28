import { securityRepo } from '@quill/db';
import type { GuildConfig } from '@quill/shared';
import { type GuildMember, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { App } from '../../app.js';
import { type SlashCommand, UserError } from '../../framework/types.js';
import { relative } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { infoCard, successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';
import { logSecurityChange } from './antinuke-command.js';

/** Owner, extra owners and up to 5 authorized users may START emergency mode (only owners end it). */
export async function canStartEmergency(
  app: App,
  member: GuildMember,
  config: GuildConfig,
): Promise<boolean> {
  if (member.id === member.guild.ownerId) return true;
  if (await app.trust.isExtraOwner(member.guild.id, member.id)) return true;
  return config.antinuke.emergency.authorizedUserIds.includes(member.id);
}

export const emergencyCommand: SlashCommand = {
  module: 'antinuke',
  permission: 'everyone',
  subcommandPermissions: {
    status: 'moderator',
    end: 'extra_owner',
    authorize: 'extra_owner',
    unauthorize: 'extra_owner',
  },
  data: new SlashCommandBuilder()
    .setName('emergency')
    .setDescription('Emergency mode: strip dangerous permissions from every role until it is safe.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Lock the server down now.')
        .addStringOption((o) => o.setName('reason').setDescription('What is happening').setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s.setName('end').setDescription('End emergency mode and restore everything QUILL changed.'),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Is emergency mode active?'))
    .addSubcommand((s) =>
      s
        .setName('authorize')
        .setDescription('Allow someone (max 5) to start emergency mode.')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('unauthorize')
        .setDescription('Remove someone from the emergency list.')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    ),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const emergency = config.antinuke.emergency;

    if (sub === 'start') {
      if (!(await canStartEmergency(app, interaction.member, config))) {
        throw new UserError(
          'Only the server owner, extra owners and authorized users (`/emergency authorize`) can start emergency mode.',
          'Not allowed',
        );
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = interaction.options.getString('reason') ?? `Started by ${interaction.user.username}`;
      const report = await app.emergency.activate(guild, reason, false, userId);
      if (report.skipped.includes('already active')) {
        await reply(
          interaction,
          infoCard('Already active', 'Emergency mode is already on. End it with `/emergency end`.'),
          {
            ephemeral: true,
          },
        );
        return;
      }
      await reply(interaction, app.emergency.card(guild, report, reason, false, userId), { ephemeral: true });
      return;
    }

    if (sub === 'end') {
      const state = await securityRepo.getEmergency(app.db, guild.id);
      if (!state?.active) throw new UserError('Emergency mode is not active.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const restored = await app.emergency.deactivate(guild, userId);
      await reply(
        interaction,
        successCard(
          'Emergency mode ended',
          `Restored permissions on **${restored.roles}** role(s) and **${restored.channels}** channel(s).`,
        ),
        { ephemeral: true },
      );
      return;
    }

    if (sub === 'status') {
      const state = await securityRepo.getEmergency(app.db, guild.id);
      const card = Card.create().header({
        title: state?.active ? 'Emergency mode is ACTIVE' : 'Emergency mode is off',
        emoji: state?.active ? E.siren : E.shield,
        level: 3,
      });
      if (state?.active) {
        card.lines([
          ['Reason', state.reason ?? '—'],
          [
            'Started',
            `${state.startedAt ? relative(state.startedAt) : '—'} · ${state.automatic ? 'automatically' : `by <@${state.triggeredBy}>`}`,
          ],
        ]);
      } else if (state?.endedAt) {
        card.text(`Last emergency ended ${relative(state.endedAt)}.`);
      }
      card.text(
        `**Can start it:** owner, extra owners${emergency.authorizedUserIds.length ? `, ${emergency.authorizedUserIds.map((id) => `<@${id}>`).join(', ')}` : ''}\n**Can end it:** owner and extra owners`,
      );
      await reply(interaction, card.build(), { ephemeral: true });
      return;
    }

    const target = interaction.options.getUser('user', true);
    const list = emergency.authorizedUserIds;
    if (sub === 'authorize') {
      if (target.bot) throw new UserError('Bots cannot be authorized.');
      if (list.includes(target.id)) throw new UserError(`<@${target.id}> is already authorized.`);
      if (list.length >= 5) throw new UserError('At most 5 users can be authorized.');
      await app.configs.set(
        guild.id,
        userId,
        ['antinuke', 'emergency', 'authorizedUserIds'],
        [...list, target.id],
      );
      await logSecurityChange(app, guild, userId, `<@${target.id}> may now start emergency mode.`);
      await reply(
        interaction,
        successCard('Authorized', `<@${target.id}> can start emergency mode with \`/emergency start\`.`),
        {
          ephemeral: true,
        },
      );
      return;
    }
    if (!list.includes(target.id)) throw new UserError(`<@${target.id}> is not authorized.`);
    await app.configs.set(
      guild.id,
      userId,
      ['antinuke', 'emergency', 'authorizedUserIds'],
      list.filter((id) => id !== target.id),
    );
    await logSecurityChange(app, guild, userId, `<@${target.id}> can no longer start emergency mode.`);
    await reply(interaction, successCard('Removed', `<@${target.id}> can no longer start emergency mode.`), {
      ephemeral: true,
    });
  },
};
