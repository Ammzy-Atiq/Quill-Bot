import { banRepo } from '@quill/db';
import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { type ComponentHandler, defineEvent, type EventHandler, UserError } from '../../framework/types.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';
import { casesPage } from '../cases/index.js';

/** Shortcut buttons on AutoMod log cards (`qg:mod:<action>:<userId>`). */
export const quickActionComponents: ComponentHandler[] = [
  {
    id: 'mod:history',
    permission: 'moderator',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const userId = args[0]!;
      await reply(interaction, await casesPage(app, guild.id, interaction.user.id, userId, 0), {
        ephemeral: true,
      });
    },
  },
  {
    id: 'mod:untimeout',
    permission: 'moderator',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        throw new UserError('You need the Timeout Members permission.');
      }
      const member = await guild.members.fetch(args[0]!).catch(() => null);
      if (!member?.isCommunicationDisabled()) throw new UserError('That member is not timed out.');
      await member.timeout(null, `QUILL GUARD | timeout removed by ${interaction.user.tag}`);
      await app.cases.create(guild, {
        userId: member.id,
        moderatorId: interaction.user.id,
        source: 'manual',
        type: 'untimeout',
        reason: 'Timeout removed from an AutoMod log',
      });
      await reply(interaction, successCard('Timeout removed', `<@${member.id}>`), { ephemeral: true });
    },
  },
  {
    id: 'mod:riskreset',
    permission: 'moderator',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      await app.risk.reset(guild.id, args[0]!);
      await reply(interaction, successCard('Risk score reset', `<@${args[0]}> is back to 0.`), {
        ephemeral: true,
      });
    },
  },
  {
    id: 'mod:ban',
    permission: 'moderator',
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw new UserError('You need the Ban Members permission.');
      }
      const user = await app.client.users.fetch(args[0]!);
      const member = await guild.members.fetch(user.id).catch(() => null);
      const result = await app.moderation.apply(
        guild,
        user,
        member,
        { type: 'ban', deleteMessageSeconds: 86_400 },
        {
          reason: `Banned from an AutoMod log by ${interaction.user.tag}`,
          source: 'manual',
          moderatorId: interaction.user.id,
        },
      );
      if (!result.ok) throw new UserError(result.error ?? 'Ban failed.');
      await reply(
        interaction,
        successCard('Member banned', `<@${user.id}> · case #${result.caseRow?.caseNumber}`),
        { ephemeral: true },
      );
    },
  },
];

/** Keeps `guild_bans` in sync with Discord (used for ban-evasion checks on the website). */
export const banMirrorEvents: EventHandler[] = [
  defineEvent({
    event: 'guildBanAdd',
    async execute(app, ban) {
      let moderatorId: string | null = null;
      const logs = await ban.guild
        .fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 3 })
        .catch(() => null);
      const entry = logs?.entries.find((e) => e.targetId === ban.user.id);
      if (entry?.executorId) moderatorId = entry.executorId;
      await banRepo.recordBan(app.db, {
        guildId: ban.guild.id,
        userId: ban.user.id,
        reason: ban.reason ?? entry?.reason ?? null,
        moderatorId,
      });
    },
  }),
  defineEvent({
    event: 'guildBanRemove',
    async execute(app, ban) {
      await banRepo.removeBan(app.db, ban.guild.id, ban.user.id);
    },
  }),
];
