import { randomBytes } from 'node:crypto';
import {
  type ChatInputCommandInteraction,
  type Interaction,
  MessageFlags,
  type RepliableInteraction,
} from 'discord.js';
import type { App } from '../app.js';
import { errorCard } from '../ui/presets.js';
import { reply } from '../ui/respond.js';
import { parseCid } from './custom-id.js';
import { meetsLevel, memberLevel } from './permissions.js';
import { type ComponentInteraction, PERMISSION_LABELS, type PermissionLevel, UserError } from './types.js';

function requiredLevel(app: App, interaction: ChatInputCommandInteraction<'cached'>): PermissionLevel | null {
  const command = app.registry.commands.get(interaction.commandName);
  if (!command) return null;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  const overrides = command.subcommandPermissions ?? {};
  if (group && sub && overrides[`${group} ${sub}`]) return overrides[`${group} ${sub}`]!;
  if (sub && overrides[sub]) return overrides[sub]!;
  return command.permission;
}

async function fail(interaction: RepliableInteraction, title: string, message: string) {
  try {
    await reply(interaction, errorCard(title, message), { ephemeral: true });
  } catch {
    // interaction expired — nothing else to do
  }
}

async function handleError(app: App, interaction: RepliableInteraction, error: unknown) {
  if (error instanceof UserError) {
    await fail(interaction, error.title, error.message);
    return;
  }
  const ref = randomBytes(3).toString('hex');
  app.logger.error({ err: error, ref, guildId: interaction.guildId }, 'interaction failed');
  await fail(interaction, 'Unexpected error', `QUILL hit an unexpected error. Reference: \`${ref}\``);
}

/** Routes every interaction to the right command / component handler with permission checks. */
export async function routeInteraction(app: App, interaction: Interaction): Promise<void> {
  if (!interaction.inGuild()) {
    if (interaction.isRepliable())
      await fail(interaction, 'Servers only', 'QUILL GUARD commands work inside servers.');
    return;
  }
  if (!interaction.inCachedGuild()) return;

  if (interaction.isAutocomplete()) {
    const command = app.registry.commands.get(interaction.commandName);
    try {
      await command?.autocomplete?.({ app, interaction, guild: interaction.guild });
    } catch (error) {
      app.logger.warn({ err: error }, 'autocomplete failed');
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = app.registry.commands.get(interaction.commandName);
    if (!command) return;
    try {
      const config = await app.configs.get(interaction.guildId);
      const required = requiredLevel(app, interaction) ?? command.permission;
      const level = await memberLevel(app, interaction.member, config);
      if (!meetsLevel(level, required)) {
        await fail(
          interaction,
          'Missing permission',
          `This command requires **${PERMISSION_LABELS[required]}**.`,
        );
        return;
      }
      await command.execute({ app, interaction, guild: interaction.guild, config });
    } catch (error) {
      await handleError(app, interaction, error);
    }
    return;
  }

  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    const parsed = parseCid(interaction.customId);
    if (!parsed) return; // not ours (e.g. collectors use their own ids)
    const handler = app.registry.components.get(parsed.handlerId);
    if (!handler) {
      await fail(interaction, 'Expired', 'This control is no longer active. Run the command again.');
      return;
    }
    const component = interaction as ComponentInteraction;
    try {
      let args = parsed.args;
      if (handler.locked) {
        const [ownerId, ...rest] = args;
        if (ownerId !== interaction.user.id) {
          await interaction.reply({
            components: [errorCard('Not your panel', 'Only the person who opened this panel can use it.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          });
          return;
        }
        args = rest;
      }
      const config = await app.configs.get(interaction.guildId);
      const level = await memberLevel(app, interaction.member, config);
      if (!meetsLevel(level, handler.permission)) {
        await fail(
          interaction,
          'Missing permission',
          `This requires **${PERMISSION_LABELS[handler.permission]}**.`,
        );
        return;
      }
      await handler.execute({ app, interaction: component, guild: interaction.guild, config, args });
    } catch (error) {
      await handleError(app, interaction, error);
    }
  }
}
