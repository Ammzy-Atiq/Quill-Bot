import { guildRepo } from '@quill/db';
import { ActivityType, ChannelType, type Guild, PermissionFlagsBits } from 'discord.js';
import type { App } from '../../app.js';
import { type BotModule, defineEvent } from '../../framework/types.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { send } from '../../ui/respond.js';

async function syncGuild(app: App, guild: Guild) {
  await guildRepo.upsertGuild(app.db, {
    id: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
  });
}

function welcomeCard(app: App, guild: Guild) {
  return Card.create()
    .header({
      title: 'Thanks for adding QUILL GUARD',
      emoji: E.quill,
      subtitle: `**${guild.name}** is now under QUILL's watch.`,
      thumbnail: app.logo(),
    })
    .divider()
    .text(
      [
        `${E.gear} Run **/setup** to pick a log channel and switch modules on.`,
        `${E.antinuke} Owner: run **/antinuke enable**, then whitelist trusted admins and bots with **/whitelist add**.`,
        `${E.verify} Protect joins with **/verification setup**.`,
        `${E.automod} AutoMod is already on with safe defaults — tune it with **/automod panel**.`,
        '',
        `${E.warn} Move the **QUILL GUARD** role to the very top of the role list so it can stop attackers.`,
      ].join('\n'),
    )
    .footer('QUILL GUARD · made by Atiq Ur Rahman')
    .build();
}

/** Core lifecycle events: ready, guild join/leave/update. */
export const coreModule: BotModule = {
  name: 'general',
  events: [
    defineEvent({
      event: 'clientReady',
      once: true,
      async execute(app, client) {
        client.user.setPresence({
          activities: [{ name: 'your server · /help', type: ActivityType.Watching }],
          status: 'online',
        });
        app.logger.info(
          { user: client.user.tag, guilds: client.guilds.cache.size, shards: app.shardIds },
          'QUILL GUARD is online',
        );
        // Keep the guild table fresh (cheap upserts, sequential to avoid pool spikes).
        for (const guild of client.guilds.cache.values()) {
          await syncGuild(app, guild).catch((err: unknown) => app.logger.warn({ err }, 'guild sync failed'));
        }
      },
    }),
    defineEvent({
      event: 'guildCreate',
      async execute(app, guild) {
        await syncGuild(app, guild);
        app.logger.info({ guildId: guild.id, members: guild.memberCount }, 'joined guild');
        const me = guild.members.me;
        const channel =
          guild.systemChannel ??
          guild.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildText &&
              me !== null &&
              c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
          );
        if (channel?.isSendable()) {
          await send(channel, welcomeCard(app, guild)).catch(() => undefined);
        }
      },
    }),
    defineEvent({
      event: 'guildDelete',
      async execute(app, guild) {
        if (!guild.available) return; // outage, not a real leave
        await guildRepo.markGuildLeft(app.db, guild.id);
        app.configs.invalidate(guild.id);
        app.logger.info({ guildId: guild.id }, 'left guild');
      },
    }),
    defineEvent({
      event: 'guildUpdate',
      async execute(app, before, after) {
        if (before.ownerId !== after.ownerId || before.name !== after.name) await syncGuild(app, after);
      },
    }),
  ],
};
