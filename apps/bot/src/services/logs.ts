import type { LogCategory } from '@quill/shared';
import { type ContainerBuilder, type Guild, type Message, PermissionFlagsBits } from 'discord.js';
import type { App } from '../app.js';
import { send, type V2Options } from '../ui/respond.js';

/** Sends Components V2 log cards to the configured log channel of a category. */
export class LogService {
  constructor(private readonly app: App) {}

  async channelFor(guild: Guild, category: LogCategory) {
    const config = await this.app.configs.get(guild.id);
    const channelId = config.logging.channels[category] ?? config.logging.defaultChannelId;
    if (!channelId) return null;
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isSendable() || !('permissionsFor' in channel)) return null;
    const me = guild.members.me;
    if (!me) return null;
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return null;
    return channel;
  }

  async send(
    guild: Guild,
    category: LogCategory,
    containers: ContainerBuilder | ContainerBuilder[],
    opts: V2Options = {},
  ): Promise<Message | null> {
    try {
      const channel = await this.channelFor(guild, category);
      if (!channel) return null;
      return await send(channel, containers, opts);
    } catch (error) {
      this.app.logger.warn({ err: error, guildId: guild.id, category }, 'failed to send log');
      return null;
    }
  }
}
