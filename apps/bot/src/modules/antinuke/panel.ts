import { securityRepo } from '@quill/db';
import {
  ANTINUKE_ACTION_LABELS,
  ANTINUKE_ACTIONS,
  ANTINUKE_PUNISHMENTS,
  type AntiNukeAction,
  type AntiNukePunishment,
  type GuildConfig,
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
import { relative } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { reply, update } from '../../ui/respond.js';
import { PUNISHMENT_LABELS } from './cards.js';

const PUNISHMENT_HINT: Record<AntiNukePunishment, string> = {
  ban: 'Remove the attacker for good (Olympus default)',
  kick: 'Remove the attacker; they can rejoin',
  strip_roles: 'Take every role away (keeps them in the server)',
  quarantine: 'Strip roles and lock them in a no-access role',
  alert: 'Only report — nothing is stopped',
};

/** Takes a snapshot when anti-nuke gets enabled and there is no recent one (recovery needs a baseline). */
export async function ensureBaselineSnapshot(app: App, guild: Guild, userId: string): Promise<boolean> {
  const latest = await securityRepo.latestSnapshot(app.db, guild.id).catch(() => undefined);
  if (latest && Date.now() - latest.createdAt.getTime() < 24 * 3_600_000) return false;
  await app.snapshots.capture(guild, 'manual', 'Baseline (anti-nuke enabled)', userId);
  return true;
}

export async function antinukePanel(app: App, guild: Guild, userId: string, config: GuildConfig) {
  const an = config.antinuke;
  const trust = await app.trust.get(guild.id);
  const latest = await securityRepo.latestSnapshot(app.db, guild.id).catch(() => undefined);
  const enabled = ANTINUKE_ACTIONS.filter((a) => an.modules[a].enabled);

  const card = Card.create().header({
    title: 'Anti-Nuke',
    emoji: E.antinuke,
    subtitle: `${status(an.enabled)} · **${an.mode === 'strict' ? 'Strict' : 'Threshold'}** mode · punishment **${PUNISHMENT_LABELS[an.punishment]}**`,
    thumbnail: app.logo(),
  });
  card.lines([
    ['Trust', `owner + ${trust.extraOwners.size} extra owner(s) · ${trust.whitelist.size} whitelisted`],
    ['Revert', an.revert ? 'on — destructive actions are undone' : 'off'],
    [
      'Anti-betray',
      an.antiBetray.enabled
        ? `on — trusted users are punished above limit ×${an.antiBetray.multiplier}${an.antiBetray.monitorExtraOwners ? ' (extra owners too)' : ''}`
        : 'off',
    ],
    ['Auto emergency', an.autoEmergency.enabled ? `at **${an.autoEmergency.level}** threat` : 'off'],
    ['Unapproved bots', an.botAddAction === 'ban' ? 'banned' : 'kicked'],
    [
      'Snapshots',
      `${an.snapshotIntervalHours ? `every ${an.snapshotIntervalHours}h, keep ${an.snapshotRetention}` : 'automatic off'} · last ${latest ? relative(latest.createdAt) : 'never'}`,
    ],
  ]);
  card.text(
    `**Protected actions** — ${enabled.length}/${ANTINUKE_ACTIONS.length}\n-# ${
      an.mode === 'strict'
        ? 'Strict: any protected action by someone not whitelisted is punished immediately.'
        : 'Threshold: punished once the limit inside the window is exceeded (dangerous actions at once).'
    }`,
  );

  card.actions(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(lockedId(userId, 'anp', 'modules'))
        .setPlaceholder('Protected actions')
        .setMinValues(0)
        .setMaxValues(ANTINUKE_ACTIONS.length)
        .addOptions(
          ANTINUKE_ACTIONS.map((action) => {
            const m = an.modules[action];
            return new StringSelectMenuOptionBuilder()
              .setLabel(ANTINUKE_ACTION_LABELS[action])
              .setValue(action)
              .setDescription(
                `limit ${m.limit} per ${m.windowSeconds}s${m.punishment ? ` · ${PUNISHMENT_LABELS[m.punishment]}` : ''}`,
              )
              .setDefault(m.enabled);
          }),
        ),
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(lockedId(userId, 'anp', 'punish'))
        .setPlaceholder('Punishment')
        .addOptions(
          ANTINUKE_PUNISHMENTS.map((p) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(PUNISHMENT_LABELS[p])
              .setValue(p)
              .setDescription(PUNISHMENT_HINT[p])
              .setDefault(an.punishment === p),
          ),
        ),
    ),
  );
  card.buttons(
    new ButtonBuilder()
      .setCustomId(lockedId(userId, 'anp', 'toggle'))
      .setLabel(an.enabled ? 'Disable' : 'Enable')
      .setStyle(an.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(lockedId(userId, 'anp', 'mode'))
      .setLabel(an.mode === 'strict' ? 'Switch to threshold' : 'Switch to strict')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(lockedId(userId, 'anp', 'revert'))
      .setLabel(an.revert ? 'Revert: on' : 'Revert: off')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(lockedId(userId, 'anp', 'snapshot'))
      .setLabel('Take snapshot')
      .setEmoji(E.camera)
      .setStyle(ButtonStyle.Secondary),
  );
  return card
    .footer(
      'Whitelist staff & bots with /whitelist add · limits: /antinuke module · test: /antinuke simulate',
    )
    .build();
}

export const antinukePanelComponents: ComponentHandler[] = [
  {
    id: 'anp:toggle',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, config }) {
      if (!interaction.isButton()) return;
      const enabling = !config.antinuke.enabled;
      const updated = await app.configs.set(guild.id, interaction.user.id, ['antinuke', 'enabled'], enabling);
      if (enabling) await ensureBaselineSnapshot(app, guild, interaction.user.id).catch(() => false);
      await update(interaction, await antinukePanel(app, guild, interaction.user.id, updated));
    },
  },
  {
    id: 'anp:mode',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, config }) {
      if (!interaction.isButton()) return;
      const mode = config.antinuke.mode === 'strict' ? 'threshold' : 'strict';
      const updated = await app.configs.set(guild.id, interaction.user.id, ['antinuke', 'mode'], mode);
      await update(interaction, await antinukePanel(app, guild, interaction.user.id, updated));
    },
  },
  {
    id: 'anp:revert',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, config }) {
      if (!interaction.isButton()) return;
      const updated = await app.configs.set(
        guild.id,
        interaction.user.id,
        ['antinuke', 'revert'],
        !config.antinuke.revert,
      );
      await update(interaction, await antinukePanel(app, guild, interaction.user.id, updated));
    },
  },
  {
    id: 'anp:snapshot',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, config }) {
      if (!interaction.isButton()) return;
      const row = await app.snapshots.capture(
        guild,
        'manual',
        'From the Anti-Nuke panel',
        interaction.user.id,
      );
      await update(interaction, await antinukePanel(app, guild, interaction.user.id, config));
      await reply(
        interaction,
        Card.create()
          .header({ title: `Snapshot #${row.id} saved`, emoji: E.camera, level: 3 })
          .text(
            `${row.roleCount} roles · ${row.channelCount} channels. Restore with \`/backup restore id:${row.id}\`.`,
          )
          .build(),
        { ephemeral: true },
      );
    },
  },
  {
    id: 'anp:punish',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild }) {
      if (!interaction.isStringSelectMenu()) return;
      const value = interaction.values[0] as AntiNukePunishment;
      if (!ANTINUKE_PUNISHMENTS.includes(value)) return;
      const updated = await app.configs.set(guild.id, interaction.user.id, ['antinuke', 'punishment'], value);
      await update(interaction, await antinukePanel(app, guild, interaction.user.id, updated));
    },
  },
  {
    id: 'anp:modules',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, config }) {
      if (!interaction.isStringSelectMenu()) return;
      const selected = new Set(interaction.values as AntiNukeAction[]);
      // Modules are on by default: enabling removes the override, disabling stores `false`.
      const changes = ANTINUKE_ACTIONS.filter(
        (action) => config.antinuke.modules[action].enabled !== selected.has(action),
      ).map((action) => ({
        path: ['antinuke', 'modules', action, 'enabled'],
        value: selected.has(action) ? undefined : false,
      }));
      const updated =
        changes.length > 0 ? await app.configs.update(guild.id, interaction.user.id, changes) : config;
      await update(interaction, await antinukePanel(app, guild, interaction.user.id, updated));
    },
  },
];
