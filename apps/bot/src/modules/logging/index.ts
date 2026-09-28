import { LOG_CATEGORIES, LOG_CATEGORY_LABELS, type LogCategory } from '@quill/shared';
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { BotModule, SlashCommand } from '../../framework/types.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';

const categoryChoices = [
  { name: 'Default (every category without its own channel)', value: 'default' },
  ...LOG_CATEGORIES.map((c) => ({ name: LOG_CATEGORY_LABELS[c], value: c })),
];

const pathFor = (category: string) =>
  category === 'default' ? ['logging', 'defaultChannelId'] : ['logging', 'channels', category];

const logsCommand: SlashCommand = {
  module: 'logging',
  permission: 'manager',
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Choose where QUILL GUARD posts its logs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Send a log category to a channel.')
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Log category')
            .setRequired(true)
            .addChoices(...categoryChoices),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to post in')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Stop sending a log category to its own channel.')
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Log category')
            .setRequired(true)
            .addChoices(...categoryChoices),
        ),
    )
    .addSubcommand((s) => s.setName('view').setDescription('Show where every log category goes.')),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const category = interaction.options.getString('category', true);
      const channel = interaction.options.getChannel('channel', true);
      await app.configs.set(guild.id, interaction.user.id, pathFor(category), channel.id);
      await reply(
        interaction,
        successCard(
          'Log channel saved',
          `**${category === 'default' ? 'Default' : LOG_CATEGORY_LABELS[category as LogCategory]}** logs now go to <#${channel.id}>.`,
        ),
        { ephemeral: true },
      );
      return;
    }
    if (sub === 'clear') {
      const category = interaction.options.getString('category', true);
      await app.configs.reset(guild.id, interaction.user.id, pathFor(category));
      await reply(interaction, successCard('Log channel cleared'), { ephemeral: true });
      return;
    }
    const fallback = config.logging.defaultChannelId ? `<#${config.logging.defaultChannelId}>` : '`not set`';
    const lines: Array<[string, string]> = LOG_CATEGORIES.map((c) => {
      const own = config.logging.channels[c];
      return [LOG_CATEGORY_LABELS[c], own ? `<#${own}>` : `${fallback} (default)`];
    });
    await reply(
      interaction,
      Card.create()
        .header({ title: 'Log routing', emoji: E.logs })
        .lines([['Default channel', fallback]])
        .divider()
        .lines(lines)
        .build(),
      { ephemeral: true },
    );
  },
};

export const loggingModule: BotModule = {
  name: 'logging',
  commands: [logsCommand],
};
