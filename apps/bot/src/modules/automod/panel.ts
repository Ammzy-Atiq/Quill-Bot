import {
  DETECTOR_KEYS,
  DETECTOR_LABELS,
  type DetectorKey,
  type GuildConfig,
  WORD_CATEGORIES,
  WORD_CATEGORY_LABELS,
} from '@quill/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Guild,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { App } from '../../app.js';
import { lockedId } from '../../framework/custom-id.js';
import type { ComponentHandler } from '../../framework/types.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { update } from '../../ui/respond.js';

const DETECTOR_HINT: Record<DetectorKey, string> = {
  words: 'Built-in lists + your words, sees through evasion',
  spam: 'Floods, duplicates, cross-channel blasts, mentions, caps',
  links: 'Invites, domain allow/block lists, disguised links',
  scam: 'Phishing, look-alike domains, crypto & Nitro scams, hacked accounts',
  harassment: 'Insults aimed at members, threats, doxxing',
  toxicity: 'Heuristic toxicity score',
  ai: 'Second opinion from your own AI provider',
};

export function automodPanel(app: App, _guild: Guild, userId: string, config: GuildConfig) {
  const am = config.automod;
  const card = Card.create().header({
    title: 'AutoMod',
    emoji: E.automod,
    subtitle: `${status(am.enabled)} · words filter minimum severity **${am.words.minSeverity}**`,
    thumbnail: app.logo(),
  });

  for (const key of DETECTOR_KEYS) {
    const d = am[key];
    const mode = !d.enabled ? status(false) : d.shadow ? `${E.shadow} Shadow (log only)` : status(true);
    card.section(
      `**${DETECTOR_LABELS[key]}** — ${mode}\n-# ${DETECTOR_HINT[key]}`,
      new ButtonBuilder()
        .setCustomId(lockedId(userId, 'am', 'toggle', key))
        .setLabel(d.enabled ? 'Turn off' : 'Turn on')
        .setStyle(d.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    );
  }

  const categories = WORD_CATEGORIES.filter((c) => am.words.categories[c].enabled).map(
    (c) => WORD_CATEGORY_LABELS[c],
  );
  card.divider().text(`**Word categories on:** ${categories.length > 0 ? categories.join(', ') : 'none'}`);

  card.actions(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(lockedId(userId, 'am', 'shadow'))
        .setPlaceholder('Shadow mode (log only) for…')
        .setMinValues(0)
        .setMaxValues(DETECTOR_KEYS.length)
        .addOptions(
          DETECTOR_KEYS.map((key) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(DETECTOR_LABELS[key])
              .setValue(key)
              .setDefault(am[key].shadow),
          ),
        ),
    ),
  );
  card.buttons(
    new ButtonBuilder()
      .setCustomId(lockedId(userId, 'am', 'master'))
      .setLabel(am.enabled ? 'Disable AutoMod' : 'Enable AutoMod')
      .setStyle(am.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  return card
    .footer('Fine-tune with /automod words, /automod response, /automod links and /automod test.')
    .build();
}

export const automodPanelComponents: ComponentHandler[] = [
  {
    id: 'am:toggle',
    permission: 'manager',
    locked: true,
    async execute({ app, interaction, guild, config, args }) {
      if (!interaction.isButton()) return;
      const key = args[0] as DetectorKey;
      if (!DETECTOR_KEYS.includes(key)) return;
      const updated = await app.configs.set(
        guild.id,
        interaction.user.id,
        ['automod', key, 'enabled'],
        !config.automod[key].enabled,
      );
      await update(interaction, automodPanel(app, guild, interaction.user.id, updated));
    },
  },
  {
    id: 'am:shadow',
    permission: 'manager',
    locked: true,
    async execute({ app, interaction, guild }) {
      if (!interaction.isStringSelectMenu()) return;
      const selected = new Set(interaction.values);
      const updated = await app.configs.update(
        guild.id,
        interaction.user.id,
        DETECTOR_KEYS.map((key) => ({ path: ['automod', key, 'shadow'], value: selected.has(key) })),
      );
      await update(interaction, automodPanel(app, guild, interaction.user.id, updated));
    },
  },
  {
    id: 'am:master',
    permission: 'manager',
    locked: true,
    async execute({ app, interaction, guild, config }) {
      if (!interaction.isButton()) return;
      const updated = await app.configs.set(
        guild.id,
        interaction.user.id,
        ['automod', 'enabled'],
        !config.automod.enabled,
      );
      await update(interaction, automodPanel(app, guild, interaction.user.id, updated));
    },
  },
];
