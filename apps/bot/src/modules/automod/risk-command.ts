import { decayScore, riskLevel } from '@quill/core';
import { riskRepo } from '@quill/db';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { type SlashCommand, UserError } from '../../framework/types.js';
import { ACTION_CHOICES, actionFromOptions } from '../../lib/actions.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';

const LEVEL_EMOJI = { low: '🟢', elevated: '🟡', high: '🟠', critical: '🔴' } as const;

export const riskCommand: SlashCommand = {
  module: 'risk',
  permission: 'moderator',
  subcommandPermissions: {
    'ladder-set': 'manager',
    'ladder-remove': 'manager',
    settings: 'manager',
    reset: 'moderator',
  },
  data: new SlashCommandBuilder()
    .setName('risk')
    .setDescription('Risk Engine: decaying scores and the escalation ladder.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription("Show a member's risk score.")
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription("Reset a member's risk score to 0.")
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('top').setDescription('Members with the highest risk.'))
    .addSubcommand((s) => s.setName('ladder').setDescription('Show the escalation ladder.'))
    .addSubcommand((s) =>
      s
        .setName('ladder-set')
        .setDescription('Add or change a ladder step.')
        .addIntegerOption((o) =>
          o
            .setName('threshold')
            .setDescription('Risk score')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10_000),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Action')
            .setRequired(true)
            .addChoices(...ACTION_CHOICES),
        )
        .addStringOption((o) => o.setName('duration').setDescription('Timeout length, e.g. 1h')),
    )
    .addSubcommand((s) =>
      s
        .setName('ladder-remove')
        .setDescription('Remove a ladder step.')
        .addIntegerOption((o) => o.setName('threshold').setDescription('Step threshold').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('Tune scoring.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Risk Engine on/off'))
        .addNumberOption((o) =>
          o
            .setName('half_life_hours')
            .setDescription('Hours until a score halves (default 24)')
            .setMinValue(1)
            .setMaxValue(2160),
        )
        .addNumberOption((o) =>
          o
            .setName('repeat_multiplier')
            .setDescription('Multiplier for quick repeats (default 1.5)')
            .setMinValue(1)
            .setMaxValue(5),
        )
        .addIntegerOption((o) =>
          o
            .setName('warn_expiry_days')
            .setDescription('Days until warnings expire')
            .setMinValue(1)
            .setMaxValue(365),
        ),
    ),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    const risk = config.risk;
    if (sub === 'view') {
      const user = interaction.options.getUser('user', true);
      const score = await app.risk.score(guild.id, user.id);
      const level = riskLevel(score, risk);
      const next = risk.ladder.find((s) => s.threshold > score);
      await reply(
        interaction,
        Card.create()
          .header({
            title: 'Risk score',
            emoji: E.risk,
            level: 3,
            subtitle: `<@${user.id}>`,
            thumbnail: user.displayAvatarURL({ extension: 'png', size: 128 }),
          })
          .lines([
            ['Score', `${LEVEL_EMOJI[level]} **${score}** (${level})`],
            [
              'Next step',
              next ? `${app.moderation.describe(next.action)} at ${next.threshold}` : 'top of the ladder',
            ],
            ['Decay', `halves every ${risk.halfLifeHours}h`],
          ])
          .build(),
        { ephemeral: true },
      );
      return;
    }
    if (sub === 'reset') {
      const user = interaction.options.getUser('user', true);
      await app.risk.reset(guild.id, user.id);
      await reply(interaction, successCard('Risk score reset', `<@${user.id}> is back to 0.`), {
        ephemeral: true,
      });
      return;
    }
    if (sub === 'top') {
      const rows = await riskRepo.topRisk(app.db, guild.id, 25);
      const now = Date.now();
      const scored = rows
        .map((r) => ({
          userId: r.userId,
          score: Math.round(decayScore(r.score, r.updatedAt.getTime(), now, risk.halfLifeHours) * 10) / 10,
        }))
        .filter((r) => r.score >= 1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      await reply(
        interaction,
        Card.create()
          .header({ title: 'Highest risk', emoji: E.chart, level: 3 })
          .text(
            scored
              .map((r, i) => `${i + 1}. <@${r.userId}> — ${LEVEL_EMOJI[riskLevel(r.score, risk)]} ${r.score}`)
              .join('\n') || 'Nobody has a risk score right now. ✨',
          )
          .build(),
        { ephemeral: true },
      );
      return;
    }
    if (sub === 'ladder') {
      await reply(
        interaction,
        Card.create()
          .header({
            title: 'Escalation ladder',
            emoji: E.risk,
            level: 3,
            subtitle: risk.enabled ? 'Active' : 'Risk Engine is off',
          })
          .text(
            risk.ladder
              .map((s) => `**${s.threshold}** ${E.arrowRight} ${app.moderation.describe(s.action)}`)
              .join('\n'),
          )
          .text(
            `-# Points per severity: ${risk.severityPoints.join(' / ')} · repeats within ${risk.repeatWindowMinutes} min ×${risk.repeatMultiplier} · half-life ${risk.halfLifeHours}h`,
          )
          .build(),
        { ephemeral: true },
      );
      return;
    }
    if (sub === 'ladder-set' || sub === 'ladder-remove') {
      const threshold = interaction.options.getInteger('threshold', true);
      let ladder = risk.ladder.filter((s) => s.threshold !== threshold);
      if (sub === 'ladder-set') {
        const action = actionFromOptions(
          interaction.options.getString('action', true),
          interaction.options.getString('duration'),
        );
        ladder = [...ladder, { threshold, action }];
      } else if (ladder.length === risk.ladder.length) {
        throw new UserError(`There is no step at ${threshold}.`);
      }
      if (ladder.length > 15) throw new UserError('The ladder can have at most 15 steps.');
      const updated = await app.configs.set(guild.id, interaction.user.id, ['risk', 'ladder'], ladder);
      await reply(
        interaction,
        successCard(
          'Ladder saved',
          updated.risk.ladder
            .map((s) => `**${s.threshold}** ${E.arrowRight} ${app.moderation.describe(s.action)}`)
            .join('\n'),
        ),
        { ephemeral: true },
      );
      return;
    }
    const changes: Array<{ path: string[]; value: unknown }> = [];
    const enabled = interaction.options.getBoolean('enabled');
    const halfLife = interaction.options.getNumber('half_life_hours');
    const repeat = interaction.options.getNumber('repeat_multiplier');
    const warnExpiry = interaction.options.getInteger('warn_expiry_days');
    if (enabled !== null) changes.push({ path: ['risk', 'enabled'], value: enabled });
    if (halfLife !== null) changes.push({ path: ['risk', 'halfLifeHours'], value: halfLife });
    if (repeat !== null) changes.push({ path: ['risk', 'repeatMultiplier'], value: repeat });
    if (warnExpiry !== null) changes.push({ path: ['risk', 'warnExpiryDays'], value: warnExpiry });
    if (changes.length === 0) throw new UserError('Choose at least one option to change.');
    const r = (await app.configs.update(guild.id, interaction.user.id, changes)).risk;
    await reply(
      interaction,
      successCard(
        'Risk settings saved',
        `${r.enabled ? 'On' : 'Off'} · half-life ${r.halfLifeHours}h · repeat ×${r.repeatMultiplier} · warnings expire after ${r.warnExpiryDays}d`,
      ),
      { ephemeral: true },
    );
  },
};
