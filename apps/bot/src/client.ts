import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';

/**
 * Gateway intents QUILL needs:
 * - Guilds, GuildWebhooks            → structure + webhook events
 * - GuildMembers (privileged)        → joins, role grants, anti-raid, verification
 * - GuildModeration                  → bans + GUILD_AUDIT_LOG_ENTRY_CREATE (anti-nuke actor attribution)
 * - GuildMessages + MessageContent   → AutoMod (MessageContent is privileged)
 * - GuildExpressions                 → emoji/sticker deletion protection
 */
export const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildExpressions,
];

export function createClient(): Client {
  return new Client({
    intents: INTENTS,
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
    allowedMentions: { parse: [], repliedUser: false },
    // Keep memory bounded per shard. Guild structure (roles/channels) stays fully cached —
    // anti-nuke recovery needs it. Spam history lives in Redis, not the message cache.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 25,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      ThreadMemberManager: 0,
      VoiceStateManager: 0,
      GuildMemberManager: {
        maxSize: 2_000,
        keepOverLimit: (member) => member.id === member.client.user.id,
      },
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 300, lifetime: 900 },
      users: { interval: 3_600, filter: () => (user) => user.id !== user.client.user.id },
    },
  });
}
