import type { GuildConfig } from '@quill/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type Guild,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { App } from '../../app.js';
import { lockedId } from '../../framework/custom-id.js';
import { hasLevel } from '../../framework/permissions.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { reply, update } from '../../ui/respond.js';

type ToggleKey = 'automod' | 'risk' | 'antinuke' | 'antiraid' | 'verification';

function toggleButton(userId: string, key: ToggleKey, on: boolean, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(lockedId(userId, 'setup', 'toggle', key))
    .setLabel(on ? 'Turn off' : 'Turn on')
    .setStyle(on ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(disabled);
}

/** Health checks that affect whether QUILL can actually protect the server. */
export function setupWarnings(guild: Guild): string[] {
  const warnings: string[] = [];
  const me = guild.members.me;
  if (!me) return warnings;
  if (!me.permissions.has(PermissionFlagsBits.Administrator)) {
    warnings.push(`${E.warn} QUILL does not have **Administrator** — anti-nuke recovery may be incomplete.`);
  }
  const above = guild.roles.cache.filter((r) => r.position > me.roles.highest.position).size;
  if (above > 0) {
    warnings.push(
      `${E.warn} **${above}** role${above === 1 ? ' is' : 's are'} above QUILL's role — move QUILL to the top so it can stop attackers.`,
    );
  }
  if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    warnings.push(`${E.warn} Missing **View Audit Log** — anti-nuke cannot identify attackers.`);
  }
  return warnings;
}

export function setupPanel(app: App, guild: Guild, userId: string, config: GuildConfig) {
  const logs = config.logging.defaultChannelId ? `<#${config.logging.defaultChannelId}>` : '`not set`';
  const perCategory = Object.values(config.logging.channels).filter(Boolean).length;
  const verificationReady = Boolean(config.verification.verifiedRoleId);
  const warnings = setupWarnings(guild);

  const card = Card.create()
    .header({
      title: 'QUILL GUARD setup',
      emoji: E.gear,
      subtitle: `Protection overview for **${guild.name}**`,
      thumbnail: app.logo(),
    })
    .divider()
    .text(
      `${E.logs} **Logs** — ${logs}${perCategory ? ` · ${perCategory} category channel(s)` : ''}\n-# Pick the default log channel below, or route categories with /logs set.`,
    )
    .section(
      [
        `${E.automod} **AutoMod** — ${status(config.automod.enabled)}`,
        '-# Words, spam, scams, links, harassment. Tune with /automod panel.',
      ],
      toggleButton(userId, 'automod', config.automod.enabled),
    )
    .section(
      [
        `${E.risk} **Risk Engine** — ${status(config.risk.enabled)}`,
        '-# Escalates repeat offenders automatically. See /risk ladder.',
      ],
      toggleButton(userId, 'risk', config.risk.enabled),
    )
    .section(
      [
        `${E.antinuke} **Anti-Nuke** — ${status(config.antinuke.enabled)} · ${config.antinuke.mode} mode`,
        '-# Owner / extra owners only. Whitelist trusted staff & bots with /whitelist add.',
      ],
      toggleButton(userId, 'antinuke', config.antinuke.enabled),
    )
    .section(
      [
        `${E.antiraid} **Anti-Raid** — ${status(config.antiraid.enabled)}`,
        '-# Join-rate detection and raid mode. See /antiraid.',
      ],
      toggleButton(userId, 'antiraid', config.antiraid.enabled),
    )
    .section(
      [
        `${E.verify} **Verification** — ${status(config.verification.enabled)} · ${config.verification.mode}`,
        verificationReady
          ? '-# Post the panel with /verification panel.'
          : '-# Run /verification setup first to choose roles.',
      ],
      toggleButton(userId, 'verification', config.verification.enabled, !verificationReady),
    );

  if (warnings.length > 0) card.divider().text(warnings.join('\n'));

  card.actions(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(lockedId(userId, 'setup', 'logchannel'))
        .setPlaceholder('Choose the default log channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );
  return card.footer('Changes apply instantly on every shard.').build();
}

const TOGGLE_PATHS: Record<ToggleKey, readonly string[]> = {
  automod: ['automod', 'enabled'],
  risk: ['risk', 'enabled'],
  antinuke: ['antinuke', 'enabled'],
  antiraid: ['antiraid', 'enabled'],
  verification: ['verification', 'enabled'],
};

export const setupCommand: SlashCommand = {
  module: 'general',
  permission: 'manager',
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Open the QUILL GUARD setup panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute({ app, interaction, guild, config }) {
    await reply(interaction, setupPanel(app, guild, interaction.user.id, config), { ephemeral: true });
  },
};

export const setupComponents: ComponentHandler[] = [
  {
    id: 'setup:toggle',
    permission: 'manager',
    locked: true,
    async execute({ app, interaction, guild, config, args }) {
      if (!interaction.isButton()) return;
      const key = args[0] as ToggleKey;
      const path = TOGGLE_PATHS[key];
      if (!path) return;
      if (key === 'antinuke' && !(await hasLevel(app, interaction.member, config, 'extra_owner'))) {
        throw new UserError('Only the server owner or an extra owner can change Anti-Nuke.', 'Owner only');
      }
      const current = config[key].enabled;
      const updated = await app.configs.set(guild.id, interaction.user.id, path, !current);
      await update(interaction, setupPanel(app, guild, interaction.user.id, updated));
    },
  },
  {
    id: 'setup:logchannel',
    permission: 'manager',
    locked: true,
    async execute({ app, interaction, guild }) {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      const updated = await app.configs.set(
        guild.id,
        interaction.user.id,
        ['logging', 'defaultChannelId'],
        channelId,
      );
      await update(interaction, setupPanel(app, guild, interaction.user.id, updated));
    },
  },
];
