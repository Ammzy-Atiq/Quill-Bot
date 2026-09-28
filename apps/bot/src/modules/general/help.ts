import { PRODUCT_AUTHOR } from '@quill/shared';
import {
  ActionRowBuilder,
  type APIApplicationCommandOption,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { App } from '../../app.js';
import { lockedId } from '../../framework/custom-id.js';
import type { ComponentHandler, ModuleKey, SlashCommand } from '../../framework/types.js';
import { truncate } from '../../lib/format.js';
import { linkButtons } from '../../lib/links.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { reply, update } from '../../ui/respond.js';

export const MODULE_INFO: Record<ModuleKey, { label: string; emoji: string; blurb: string }> = {
  general: { label: 'General', emoji: E.quill, blurb: 'Help, setup and information.' },
  automod: {
    label: 'AutoMod',
    emoji: E.automod,
    blurb: 'Normalizer-powered word filter, spam, scams, links, harassment and AI analysis.',
  },
  risk: { label: 'Risk Engine', emoji: E.risk, blurb: 'Decaying risk scores and the escalation ladder.' },
  antinuke: {
    label: 'Anti-Nuke',
    emoji: E.antinuke,
    blurb: 'Olympus-style protection: whitelist, extra owners, emergency mode, recovery.',
  },
  antiraid: {
    label: 'Anti-Raid',
    emoji: E.antiraid,
    blurb: 'Join-rate detection, raid mode and join filters.',
  },
  verification: {
    label: 'Verification',
    emoji: E.verify,
    blurb: 'OAuth verification, alt & ban-evasion detection, SSO.',
  },
  backup: {
    label: 'Backups',
    emoji: E.backup,
    blurb: 'Server snapshots, restore and member backup servers.',
  },
  moderation: { label: 'Moderation', emoji: E.hammer, blurb: 'Cases, warnings, timeouts, kicks and bans.' },
  logging: { label: 'Logging', emoji: E.logs, blurb: 'Where QUILL reports what it does.' },
};

const MODULE_ORDER: ModuleKey[] = [
  'automod',
  'risk',
  'antinuke',
  'antiraid',
  'verification',
  'backup',
  'moderation',
  'logging',
  'general',
];

function commandsOf(app: App, module: ModuleKey): SlashCommand[] {
  return [...app.registry.commands.values()].filter((c) => c.module === module);
}

/** Flattens a command's JSON into `/name sub` lines with descriptions. */
function commandLines(command: SlashCommand): string[] {
  const json = command.data.toJSON();
  const lines: string[] = [];
  const walk = (options: readonly APIApplicationCommandOption[] | undefined, prefix: string) => {
    const subs = (options ?? []).filter(
      (o) =>
        o.type === ApplicationCommandOptionType.Subcommand ||
        o.type === ApplicationCommandOptionType.SubcommandGroup,
    );
    if (subs.length === 0) {
      lines.push(`\`${prefix}\` — ${json.description}`);
      return;
    }
    for (const sub of subs) {
      if (sub.type === ApplicationCommandOptionType.SubcommandGroup)
        walk(sub.options, `${prefix} ${sub.name}`);
      else lines.push(`\`${prefix} ${sub.name}\` — ${sub.description}`);
    }
  };
  walk(json.options, `/${json.name}`);
  return lines;
}

function moduleSelect(app: App, userId: string, selected?: ModuleKey) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(lockedId(userId, 'help', 'module'))
    .setPlaceholder('Browse commands by module')
    .addOptions(
      MODULE_ORDER.filter((m) => commandsOf(app, m).length > 0).map((m) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(MODULE_INFO[m].label)
          .setValue(m)
          .setEmoji(MODULE_INFO[m].emoji)
          .setDescription(truncate(MODULE_INFO[m].blurb, 100))
          .setDefault(m === selected),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function helpHome(app: App, userId: string) {
  return Card.create()
    .header({
      title: 'QUILL GUARD',
      emoji: E.quill,
      subtitle: 'Advanced server security — AutoMod, Verification & Anti-Nuke.',
      thumbnail: app.logo(),
      level: 1,
    })
    .divider()
    .text(
      [
        `${E.automod} **AutoMod** — a normalizer that sees through \`ｆ.u.c.k\`, \`fцck\` and \`fuuuck\`, 2000+ curated words, spam, scams, links, harassment and AI analysis with your own API key.`,
        `${E.verify} **Verification** — Discord OAuth verification with alt & ban-evasion detection, SSO across QUILL servers and member backups.`,
        `${E.antinuke} **Anti-Nuke** — owner & extra-owner model, per-action whitelist, instant punishment, revert, emergency mode, snapshots.`,
        `${E.risk} **Risk Engine** — one decaying score per member that escalates warn → timeout → kick → ban.`,
      ].join('\n'),
    )
    .text(`${E.gear} New here? Run **/setup**.`)
    .actions(moduleSelect(app, userId))
    .buttons(...linkButtons(app))
    .footer(`Made by ${PRODUCT_AUTHOR}`)
    .build();
}

function modulePage(app: App, userId: string, module: ModuleKey) {
  const info = MODULE_INFO[module];
  const lines = commandsOf(app, module).flatMap(commandLines);
  return Card.create()
    .header({ title: `${info.label} commands`, emoji: info.emoji, subtitle: info.blurb })
    .divider()
    .text(truncate(lines.join('\n') || 'No commands yet.', 3200))
    .actions(moduleSelect(app, userId, module))
    .buttons(
      new ButtonBuilder()
        .setCustomId(lockedId(userId, 'help', 'home'))
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary),
    )
    .footer(`Made by ${PRODUCT_AUTHOR}`)
    .build();
}

export const helpCommand: SlashCommand = {
  module: 'general',
  permission: 'everyone',
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn what QUILL GUARD does and browse its commands.'),
  async execute({ app, interaction }) {
    await reply(interaction, helpHome(app, interaction.user.id), { ephemeral: true });
  },
};

export const helpComponents: ComponentHandler[] = [
  {
    id: 'help:module',
    permission: 'everyone',
    locked: true,
    async execute({ app, interaction }) {
      if (!interaction.isStringSelectMenu()) return;
      const module = interaction.values[0] as ModuleKey;
      await update(interaction, modulePage(app, interaction.user.id, module));
    },
  },
  {
    id: 'help:home',
    permission: 'everyone',
    locked: true,
    async execute({ app, interaction }) {
      if (!interaction.isButton()) return;
      await update(interaction, helpHome(app, interaction.user.id));
    },
  },
];
