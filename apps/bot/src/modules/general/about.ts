import { PRODUCT_AUTHOR } from '@quill/shared';
import { version as djsVersion, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../framework/types.js';
import { formatDuration } from '../../lib/format.js';
import { linkButtons } from '../../lib/links.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { reply } from '../../ui/respond.js';

const VERSION = '0.1.0';

export const aboutCommand: SlashCommand = {
  module: 'general',
  permission: 'everyone',
  data: new SlashCommandBuilder().setName('about').setDescription('About QUILL GUARD and its creator.'),
  async execute({ app, interaction }) {
    let servers = app.client.guilds.cache.size;
    if (app.client.shard) {
      const counts = (await app.client.shard
        .fetchClientValues('guilds.cache.size')
        .catch(() => [])) as number[];
      if (counts.length > 0) servers = counts.reduce((a, b) => a + b, 0);
    }
    const shardInfo = app.client.shard ? `${app.shardIds.join(', ')} / ${app.client.shard.count}` : '0 / 1';
    const container = Card.create()
      .header({
        title: 'QUILL GUARD',
        emoji: E.quill,
        subtitle: 'Advanced server security — AutoMod, Verification & Anti-Nuke.',
        thumbnail: app.logo(),
      })
      .divider()
      .lines([
        ['Created by', `**${PRODUCT_AUTHOR}**`],
        ['Version', VERSION],
        ['Servers protected', servers.toLocaleString('en-US')],
        ['Shard', shardInfo],
        ['Uptime', formatDuration((Date.now() - app.startedAt) / 1000)],
        ['Gateway latency', `${Math.max(0, Math.round(app.client.ws.ping))} ms`],
        ['Built with', `discord.js ${djsVersion} · Components V2`],
      ])
      .buttons(...linkButtons(app))
      .footer(`QUILL GUARD is designed and built by ${PRODUCT_AUTHOR}.`)
      .build();
    await reply(interaction, container, { ephemeral: true });
  },
};

export const pingCommand: SlashCommand = {
  module: 'general',
  permission: 'everyone',
  data: new SlashCommandBuilder().setName('ping').setDescription('Check QUILL GUARD latency.'),
  async execute({ app, interaction }) {
    const started = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roundTrip = Date.now() - started;
    await reply(
      interaction,
      Card.create()
        .header({ title: 'Pong', emoji: E.bolt, level: 3 })
        .lines([
          ['Gateway', `${Math.max(0, Math.round(app.client.ws.ping))} ms`],
          ['Round trip', `${roundTrip} ms`],
        ])
        .build(),
    );
  },
};
