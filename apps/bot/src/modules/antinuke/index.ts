import type { Role } from 'discord.js';
import { type BotModule, defineEvent } from '../../framework/types.js';
import { antinukeCommand } from './antinuke-command.js';
import { backupCommand, backupComponents } from './backup-command.js';
import { emergencyCommand } from './emergency-command.js';
import { incidentCommand, incidentComponents } from './incident-command.js';
import { memberBackupComponents } from './member-backup.js';
import { antinukePanelComponents } from './panel.js';
import { serializeChannel, serializeRole } from './serialize.js';
import { extraOwnerCommand, trustComponents, whitelistCommand } from './trust-command.js';

/**
 * Members that held a role. discord.js removes the role from the cache before emitting
 * `roleDelete`, so `role.members` is already empty — read the raw role ids instead.
 */
function holdersOf(role: Role): string[] {
  return role.guild.members.cache
    .filter((member) => (member as unknown as { _roles?: string[] })._roles?.includes(role.id))
    .map((member) => member.id);
}

export const antinukeModule: BotModule = {
  name: 'antinuke',
  commands: [
    antinukeCommand,
    whitelistCommand,
    extraOwnerCommand,
    emergencyCommand,
    backupCommand,
    incidentCommand,
  ],
  components: [
    ...antinukePanelComponents,
    ...trustComponents,
    ...backupComponents,
    ...memberBackupComponents,
    ...incidentComponents,
  ],
  events: [
    defineEvent({
      event: 'guildAuditLogEntryCreate',
      async execute(app, entry, guild) {
        await app.antinuke.onAuditEntry(entry, guild);
      },
    }),
    defineEvent({
      event: 'messageCreate',
      async execute(app, message) {
        await app.antinuke.onMessage(message);
      },
    }),
    // Keep copies of deleted objects so a revert can rebuild them exactly.
    defineEvent({
      event: 'channelDelete',
      execute(app, channel) {
        if (channel.isDMBased()) return;
        const data = serializeChannel(channel);
        if (data) app.antinuke.reverter.deletedChannels.set(channel.id, data);
      },
    }),
    defineEvent({
      event: 'roleDelete',
      execute(app, role) {
        app.antinuke.reverter.deletedRoles.set(role.id, { ...serializeRole(role), members: holdersOf(role) });
      },
    }),
    defineEvent({
      event: 'emojiDelete',
      execute(app, emoji) {
        if (!emoji.name) return;
        app.antinuke.reverter.deletedEmojis.set(emoji.id, {
          name: emoji.name,
          url: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png' }),
        });
      },
    }),
    defineEvent({
      event: 'clientReady',
      once: true,
      execute(app) {
        app.snapshots.start();
      },
    }),
    defineEvent({
      event: 'guildCreate',
      async execute(app, guild) {
        // Baseline for recovery from the moment QUILL joins.
        await app.snapshots
          .capture(guild, 'auto', 'Initial snapshot', null)
          .catch((err: unknown) => app.logger.warn({ err, guildId: guild.id }, 'initial snapshot failed'));
      },
    }),
  ],
};
