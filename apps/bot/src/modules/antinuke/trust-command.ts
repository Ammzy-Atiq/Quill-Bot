import { trust as trustRepo } from '@quill/db';
import { ANTINUKE_ACTION_LABELS, ANTINUKE_ACTIONS, type AntiNukeAction } from '@quill/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Guild,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type User,
} from 'discord.js';
import type { App } from '../../app.js';
import { lockedId } from '../../framework/custom-id.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { confirmCard, infoCard, successCard } from '../../ui/presets.js';
import { reply, update } from '../../ui/respond.js';
import { logSecurityChange } from './antinuke-command.js';

async function whitelistTarget(app: App, guild: Guild, userId: string): Promise<User> {
  if (userId === guild.ownerId) throw new UserError('The server owner is always trusted.');
  if (userId === app.client.user?.id) throw new UserError('QUILL does not need to be whitelisted.');
  if (await app.trust.isExtraOwner(guild.id, userId)) {
    throw new UserError(
      'Extra owners are already fully trusted. Remove them with `/extraowner remove` first.',
    );
  }
  const user = await app.client.users.fetch(userId).catch(() => null);
  if (!user) throw new UserError('Unknown user.');
  return user;
}

async function saveWhitelist(
  app: App,
  guild: Guild,
  actorId: string,
  targetId: string,
  actions: AntiNukeAction[],
) {
  if (actions.length === 0) await trustRepo.removeTrustEntry(app.db, guild.id, targetId, 'whitelist');
  else {
    await trustRepo.upsertWhitelist(app.db, {
      guildId: guild.id,
      userId: targetId,
      permissions: actions,
      addedBy: actorId,
    });
  }
  await app.trust.invalidate(guild.id);
  const what =
    actions.length === 0
      ? `Removed <@${targetId}> from the whitelist.`
      : `Whitelisted <@${targetId}> for ${
          actions.length === ANTINUKE_ACTIONS.length
            ? '**every action**'
            : actions.map((a) => ANTINUKE_ACTION_LABELS[a]).join(', ')
        }.`;
  await logSecurityChange(app, guild, actorId, what);
}

export async function whitelistPanel(app: App, guild: Guild, viewerId: string, targetId: string) {
  const trust = await app.trust.get(guild.id);
  const current = trust.whitelist.get(targetId) ?? new Set<AntiNukeAction>();
  const user = await app.client.users.fetch(targetId).catch(() => null);
  return Card.create()
    .header({
      title: 'Whitelist',
      emoji: E.shield,
      subtitle: `<@${targetId}>${user?.bot ? ` · ${E.bot} bot` : ''} · ${
        current.size > 0
          ? `**${current.size}/${ANTINUKE_ACTIONS.length}** actions allowed`
          : 'not whitelisted'
      }`,
      thumbnail: user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
    })
    .text(
      current.size > 0
        ? ANTINUKE_ACTIONS.filter((a) => current.has(a))
            .map((a) => `${E.check} ${ANTINUKE_ACTION_LABELS[a]}`)
            .join('\n')
        : 'Pick the actions this user may do without Anti-Nuke punishing them.',
    )
    .actions(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(lockedId(viewerId, 'wl', 'set', targetId))
          .setPlaceholder('Allowed actions')
          .setMinValues(0)
          .setMaxValues(ANTINUKE_ACTIONS.length)
          .addOptions(
            ANTINUKE_ACTIONS.map((a) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(ANTINUKE_ACTION_LABELS[a])
                .setValue(a)
                .setDefault(current.has(a)),
            ),
          ),
      ),
    )
    .buttons(
      new ButtonBuilder()
        .setCustomId(lockedId(viewerId, 'wl', 'all', targetId))
        .setLabel('All actions')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(lockedId(viewerId, 'wl', 'remove', targetId))
        .setLabel('Remove from whitelist')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(current.size === 0),
    )
    .footer(
      'Whitelisted users are still watched by anti-betray limits. Extra owners (/extraowner) are exempt entirely.',
    )
    .build();
}

async function trustList(app: App, guild: Guild) {
  const trust = await app.trust.get(guild.id);
  const whitelist = [...trust.whitelist.entries()];
  const lines = whitelist.slice(0, 25).map(([userId, actions]) => {
    const all = actions.size >= ANTINUKE_ACTIONS.length;
    const labels = [...actions].map((a) => ANTINUKE_ACTION_LABELS[a]);
    return `<@${userId}> — ${all ? '**all actions**' : `${actions.size}: ${labels.slice(0, 4).join(', ')}${labels.length > 4 ? '…' : ''}`}`;
  });
  return Card.create()
    .header({ title: 'Anti-Nuke trust', emoji: E.shield, subtitle: guild.name })
    .text(
      `${E.crown} **Owner:** <@${guild.ownerId}>\n**Extra owners (${trust.extraOwners.size}):** ${
        [...trust.extraOwners].map((id) => `<@${id}>`).join(', ') || 'none'
      }`,
    )
    .divider()
    .text(
      `**Whitelist (${whitelist.length})**\n${lines.join('\n') || 'Nobody is whitelisted.'}${
        whitelist.length > 25 ? `\n-# …and ${whitelist.length - 25} more` : ''
      }`,
    )
    .footer('Owner and extra owners are never punished. Whitelisted users only for their listed actions.')
    .build();
}

export const whitelistCommand: SlashCommand = {
  module: 'antinuke',
  permission: 'extra_owner',
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Anti-Nuke whitelist: who may do which protected actions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Whitelist a user or bot for chosen actions.')
        .addUserOption((o) => o.setName('user').setDescription('User or bot').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a user or bot from the whitelist.')
        .addUserOption((o) => o.setName('user').setDescription('User or bot').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show extra owners and the whitelist.'))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove everyone from the whitelist.')),
  async execute({ app, interaction, guild }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      await reply(interaction, await trustList(app, guild), { ephemeral: true });
      return;
    }
    if (sub === 'clear') {
      await reply(
        interaction,
        confirmCard({
          title: 'Clear the whitelist?',
          body: 'Everyone except the owner and extra owners will be treated as untrusted by Anti-Nuke.',
          confirmId: lockedId(interaction.user.id, 'wl', 'clear'),
          cancelId: lockedId(interaction.user.id, 'wl', 'cancel'),
          confirmLabel: 'Clear whitelist',
          danger: true,
        }),
        { ephemeral: true },
      );
      return;
    }
    const target = interaction.options.getUser('user', true);
    if (sub === 'remove') {
      const removed = await trustRepo.removeTrustEntry(app.db, guild.id, target.id, 'whitelist');
      if (!removed) throw new UserError(`<@${target.id}> is not whitelisted.`);
      await app.trust.invalidate(guild.id);
      await logSecurityChange(app, guild, interaction.user.id, `Removed <@${target.id}> from the whitelist.`);
      await reply(interaction, successCard('Removed from the whitelist', `<@${target.id}>`), {
        ephemeral: true,
      });
      return;
    }
    await whitelistTarget(app, guild, target.id);
    await reply(interaction, await whitelistPanel(app, guild, interaction.user.id, target.id), {
      ephemeral: true,
    });
  },
};

export const extraOwnerCommand: SlashCommand = {
  module: 'antinuke',
  permission: 'owner',
  subcommandPermissions: { list: 'extra_owner' },
  data: new SlashCommandBuilder()
    .setName('extraowner')
    .setDescription('Extra owners manage Anti-Nuke and are fully trusted (server owner only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Make someone an extra owner.')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an extra owner.')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show extra owners and the whitelist.')),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      await reply(interaction, await trustList(app, guild), { ephemeral: true });
      return;
    }
    const target = interaction.options.getUser('user', true);
    if (sub === 'remove') {
      const removed = await trustRepo.removeTrustEntry(app.db, guild.id, target.id, 'extra_owner');
      if (!removed) throw new UserError(`<@${target.id}> is not an extra owner.`);
      await app.trust.invalidate(guild.id);
      await logSecurityChange(app, guild, interaction.user.id, `Removed extra owner <@${target.id}>.`);
      await reply(interaction, successCard('Extra owner removed', `<@${target.id}>`), { ephemeral: true });
      return;
    }
    if (target.bot) throw new UserError('Bots cannot be extra owners — whitelist them instead.');
    if (target.id === guild.ownerId) throw new UserError('You already own this server.');
    const trust = await app.trust.get(guild.id);
    if (trust.extraOwners.has(target.id)) throw new UserError(`<@${target.id}> is already an extra owner.`);
    if (trust.extraOwners.size >= config.antinuke.maxExtraOwners) {
      throw new UserError(`You can have at most ${config.antinuke.maxExtraOwners} extra owners.`);
    }
    await reply(
      interaction,
      confirmCard({
        title: `Make ${target.username} an extra owner?`,
        body: `<@${target.id}> will be able to configure Anti-Nuke, the whitelist, backups and emergency mode, and Anti-Nuke will not punish them${
          config.antinuke.antiBetray.monitorExtraOwners ? ' (anti-betray still watches extra owners)' : ''
        }. Only add someone you trust completely.`,
        confirmId: lockedId(interaction.user.id, 'eo', 'confirm', target.id),
        cancelId: lockedId(interaction.user.id, 'eo', 'cancel'),
        confirmLabel: 'Make extra owner',
        danger: true,
      }),
      { ephemeral: true },
    );
  },
};

export const trustComponents: ComponentHandler[] = [
  {
    id: 'wl:set',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isStringSelectMenu()) return;
      const targetId = args[0]!;
      await whitelistTarget(app, guild, targetId);
      const actions = ANTINUKE_ACTIONS.filter((a) => interaction.values.includes(a));
      await saveWhitelist(app, guild, interaction.user.id, targetId, actions);
      await update(interaction, await whitelistPanel(app, guild, interaction.user.id, targetId));
    },
  },
  {
    id: 'wl:all',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const targetId = args[0]!;
      await whitelistTarget(app, guild, targetId);
      await saveWhitelist(app, guild, interaction.user.id, targetId, [...ANTINUKE_ACTIONS]);
      await update(interaction, await whitelistPanel(app, guild, interaction.user.id, targetId));
    },
  },
  {
    id: 'wl:remove',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const targetId = args[0]!;
      await saveWhitelist(app, guild, interaction.user.id, targetId, []);
      await update(interaction, await whitelistPanel(app, guild, interaction.user.id, targetId));
    },
  },
  {
    id: 'wl:clear',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild }) {
      if (!interaction.isButton()) return;
      const count = await trustRepo.clearWhitelist(app.db, guild.id);
      await app.trust.invalidate(guild.id);
      await logSecurityChange(app, guild, interaction.user.id, `Cleared the whitelist (${count} entries).`);
      await update(
        interaction,
        successCard('Whitelist cleared', `Removed ${count} entr${count === 1 ? 'y' : 'ies'}.`),
      );
    },
  },
  {
    id: 'wl:cancel',
    permission: 'extra_owner',
    locked: true,
    async execute({ interaction }) {
      if (!interaction.isButton()) return;
      await update(interaction, infoCard('Cancelled', 'Nothing was changed.'));
    },
  },
  {
    id: 'eo:confirm',
    permission: 'owner',
    locked: true,
    async execute({ app, interaction, guild, config, args }) {
      if (!interaction.isButton()) return;
      const targetId = args[0]!;
      const trust = await app.trust.get(guild.id);
      if (trust.extraOwners.size >= config.antinuke.maxExtraOwners) {
        throw new UserError(`You can have at most ${config.antinuke.maxExtraOwners} extra owners.`);
      }
      await trustRepo.addExtraOwner(app.db, {
        guildId: guild.id,
        userId: targetId,
        addedBy: interaction.user.id,
      });
      // An extra owner is fully trusted — a separate whitelist entry would only confuse.
      await trustRepo.removeTrustEntry(app.db, guild.id, targetId, 'whitelist');
      await app.trust.invalidate(guild.id);
      await logSecurityChange(app, guild, interaction.user.id, `Added extra owner <@${targetId}>.`);
      await update(interaction, successCard('Extra owner added', `<@${targetId}> can now manage Anti-Nuke.`));
    },
  },
  {
    id: 'eo:cancel',
    permission: 'owner',
    locked: true,
    async execute({ interaction }) {
      if (!interaction.isButton()) return;
      await update(interaction, infoCard('Cancelled', 'Nothing was changed.'));
    },
  },
];
