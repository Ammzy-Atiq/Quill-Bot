import { SCENARIOS, type SimulationResult, simulate } from '@quill/core';
import {
  ANTINUKE_ACTION_LABELS,
  ANTINUKE_ACTIONS,
  ANTINUKE_PUNISHMENTS,
  type AntiNukeAction,
  type AntiNukeConfig,
  type AntiNukePunishment,
} from '@quill/shared';
import { type Guild, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { App } from '../../app.js';
import { type SlashCommand, UserError } from '../../framework/types.js';
import type { ConfigChange } from '../../services/guild-config.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';
import { auditCard, auditGuild } from './audit.js';
import { PUNISHMENT_LABELS, THREAT_EMOJI } from './cards.js';
import { antinukePanel, ensureBaselineSnapshot } from './panel.js';

const ACTION_CHOICES = ANTINUKE_ACTIONS.map((a) => ({ name: ANTINUKE_ACTION_LABELS[a], value: a }));
const PUNISHMENT_CHOICES = ANTINUKE_PUNISHMENTS.map((p) => ({ name: PUNISHMENT_LABELS[p], value: p }));

/** Security-relevant setting changes are always written to the Anti-Nuke log. */
export async function logSecurityChange(app: App, guild: Guild, userId: string, text: string) {
  await app.logs.send(
    guild,
    'antinuke',
    Card.create()
      .header({ title: 'Anti-Nuke settings changed', emoji: E.gear, level: 3 })
      .text(`${text}\n-# by <@${userId}>`)
      .build(),
  );
}

function describeRun(result: SimulationResult): string {
  if (result.caughtAt === null)
    return `${E.cross} **not stopped** — all ${result.scenario.events.length} actions went through`;
  const seconds = ((result.caughtAfterMs ?? 0) / 1000).toFixed(1);
  return `${E.check} stopped at action **${result.caughtAt}/${result.scenario.events.length}** (${seconds}s) · ${result.damageBeforeCatch} got through first`;
}

export function simulationCard(config: AntiNukeConfig, key: string) {
  const card = Card.create();
  if (key === 'all') {
    const runs = SCENARIOS.map((s) => simulate(s, config, 'untrusted'));
    card
      .header({
        title: 'Red-team simulation — all scenarios',
        emoji: E.target,
        subtitle: `${config.mode} mode · attacker not whitelisted`,
      })
      .text(runs.map((r) => `**${r.scenario.name}** — ${describeRun(r)}`).join('\n'));
    if (runs.some((r) => r.caughtAt === null)) {
      card.text(
        `${E.warn} Some attacks got through: switch to **strict** mode or lower the limits with \`/antinuke module\`.`,
      );
    }
  } else {
    const scenario = SCENARIOS.find((s) => s.key === key);
    if (!scenario) throw new UserError('Unknown scenario.');
    const untrusted = simulate(scenario, config, 'untrusted');
    const betrayal = simulate(scenario, config, 'whitelisted');
    const peak = untrusted.peakThreat;
    card
      .header({
        title: `Red-team simulation — ${scenario.name}`,
        emoji: E.target,
        subtitle: scenario.description,
      })
      .lines([
        ['Attacker not whitelisted', describeRun(untrusted)],
        ['Whitelisted attacker (anti-betray)', describeRun(betrayal)],
        ['Peak threat', `${THREAT_EMOJI[peak.level]} ${peak.level} (score ${peak.score})`],
        [
          'Emergency mode',
          untrusted.emergencyAt ? `triggered at action ${untrusted.emergencyAt}` : 'not triggered',
        ],
        ['Punishment', PUNISHMENT_LABELS[config.punishment]],
      ]);
  }
  return card.footer('Dry run with your current settings — nothing was sent to Discord.').build();
}

export const antinukeCommand: SlashCommand = {
  module: 'antinuke',
  permission: 'extra_owner',
  data: new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Anti-Nuke: stop rogue admins, bots and hacked accounts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('panel').setDescription('Open the Anti-Nuke control panel.'))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn Anti-Nuke on.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn Anti-Nuke off.'))
    .addSubcommand((s) =>
      s
        .setName('mode')
        .setDescription('Strict (punish the first action) or threshold (punish above the limits).')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Detection mode')
            .setRequired(true)
            .addChoices(
              { name: 'Strict — punish the first unwhitelisted action', value: 'strict' },
              { name: 'Threshold — punish above the limits', value: 'threshold' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('punishment')
        .setDescription('What happens to attackers.')
        .addStringOption((o) =>
          o
            .setName('punishment')
            .setDescription('Punishment')
            .setRequired(true)
            .addChoices(...PUNISHMENT_CHOICES),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Only for this protected action (default: all)')
            .addChoices(...ACTION_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('module')
        .setDescription('Tune one protected action.')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Protected action')
            .setRequired(true)
            .addChoices(...ACTION_CHOICES),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('Protect this action'))
        .addIntegerOption((o) =>
          o
            .setName('limit')
            .setDescription('Allowed per window (threshold mode / anti-betray)')
            .setMinValue(0)
            .setMaxValue(100),
        )
        .addIntegerOption((o) =>
          o.setName('window').setDescription('Window in seconds').setMinValue(1).setMaxValue(3600),
        )
        .addBooleanOption((o) => o.setName('reset').setDescription('Reset this action to its defaults')),
    )
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('Revert, anti-betray, emergency and snapshot settings.')
        .addBooleanOption((o) => o.setName('revert').setDescription('Undo destructive actions'))
        .addBooleanOption((o) => o.setName('anti_betray').setDescription('Watch whitelisted users too'))
        .addNumberOption((o) =>
          o
            .setName('betray_multiplier')
            .setDescription('Whitelisted users may do limit × this')
            .setMinValue(1)
            .setMaxValue(20),
        )
        .addBooleanOption((o) =>
          o.setName('monitor_extra_owners').setDescription('Anti-betray also watches extra owners'),
        )
        .addBooleanOption((o) =>
          o.setName('auto_emergency').setDescription('Enter emergency mode automatically'),
        )
        .addStringOption((o) =>
          o
            .setName('emergency_level')
            .setDescription('Threat level that triggers emergency mode')
            .addChoices(
              { name: 'Suspicious', value: 'suspicious' },
              { name: 'High', value: 'high' },
              { name: 'Critical', value: 'critical' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('bot_add_action')
            .setDescription('Bots added without permission are…')
            .addChoices({ name: 'Kicked', value: 'kick' }, { name: 'Banned', value: 'ban' }),
        )
        .addBooleanOption((o) =>
          o.setName('lock_channels').setDescription('Emergency mode locks text channels'),
        )
        .addBooleanOption((o) => o.setName('pause_invites').setDescription('Emergency mode pauses invites'))
        .addIntegerOption((o) =>
          o
            .setName('snapshot_hours')
            .setDescription('Automatic snapshot interval (0 = off)')
            .setMinValue(0)
            .setMaxValue(168),
        )
        .addIntegerOption((o) =>
          o
            .setName('snapshot_keep')
            .setDescription('Automatic snapshots to keep')
            .setMinValue(1)
            .setMaxValue(50),
        )
        .addRoleOption((o) => o.setName('quarantine_role').setDescription('Role used for quarantine')),
    )
    .addSubcommand((s) =>
      s
        .setName('protect')
        .setDescription('Toggle a protected channel (touching it is always treated as dangerous).')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('audit').setDescription('Security audit: how well can QUILL protect this server?'),
    )
    .addSubcommand((s) =>
      s
        .setName('simulate')
        .setDescription('Red-team test: replay an attack against your settings (dry run).')
        .addStringOption((o) =>
          o
            .setName('scenario')
            .setDescription('Attack to simulate')
            .setRequired(true)
            .addChoices(
              { name: 'All scenarios', value: 'all' },
              ...SCENARIOS.map((s) => ({ name: s.name, value: s.key })),
            ),
        ),
    ),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    const an = config.antinuke;
    const userId = interaction.user.id;

    switch (sub) {
      case 'panel':
        await reply(interaction, await antinukePanel(app, guild, userId, config), { ephemeral: true });
        return;
      case 'enable': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await app.configs.set(guild.id, userId, ['antinuke', 'enabled'], true);
        const snapshot = await ensureBaselineSnapshot(app, guild, userId).catch(() => false);
        const report = await auditGuild(app, guild, await app.configs.get(guild.id));
        const top = report.checks.filter((c) => c.level === 'high' || c.level === 'medium').slice(0, 4);
        await logSecurityChange(app, guild, userId, `${E.on} Anti-Nuke **enabled** (${an.mode} mode).`);
        await reply(
          interaction,
          Card.create()
            .header({
              title: 'Anti-Nuke enabled',
              emoji: E.antinuke,
              level: 3,
              subtitle: `${an.mode} mode · ${PUNISHMENT_LABELS[an.punishment]}`,
            })
            .text(
              [
                `${E.warn} **Whitelist your staff and bots now** — in strict mode anyone else who deletes, bans, edits roles or pings @everyone is punished. Use \`/whitelist add\`.`,
                snapshot ? `${E.camera} Took a baseline snapshot for recovery.` : null,
                top.length
                  ? `\n**Fix next** (from \`/antinuke audit\`):\n${top.map((c) => `• ${c.text}`).join('\n')}`
                  : null,
              ]
                .filter(Boolean)
                .join('\n'),
            )
            .build(),
          { ephemeral: true },
        );
        return;
      }
      case 'disable':
        await app.configs.set(guild.id, userId, ['antinuke', 'enabled'], false);
        await logSecurityChange(app, guild, userId, `${E.off} Anti-Nuke **disabled**.`);
        await reply(
          interaction,
          successCard('Anti-Nuke disabled', 'The server is no longer protected against nukes.'),
          {
            ephemeral: true,
          },
        );
        return;
      case 'mode': {
        const mode = interaction.options.getString('mode', true);
        await app.configs.set(guild.id, userId, ['antinuke', 'mode'], mode);
        await logSecurityChange(app, guild, userId, `Detection mode set to **${mode}**.`);
        await reply(interaction, successCard('Mode saved', `Anti-Nuke now runs in **${mode}** mode.`), {
          ephemeral: true,
        });
        return;
      }
      case 'punishment': {
        const punishment = interaction.options.getString('punishment', true) as AntiNukePunishment;
        const action = interaction.options.getString('action') as AntiNukeAction | null;
        const path = action ? ['antinuke', 'modules', action, 'punishment'] : ['antinuke', 'punishment'];
        await app.configs.set(guild.id, userId, path, punishment);
        const scope = action ? ANTINUKE_ACTION_LABELS[action] : 'every protected action';
        await logSecurityChange(
          app,
          guild,
          userId,
          `Punishment for ${scope}: **${PUNISHMENT_LABELS[punishment]}**.`,
        );
        await reply(
          interaction,
          successCard('Punishment saved', `${scope}: **${PUNISHMENT_LABELS[punishment]}**`),
          {
            ephemeral: true,
          },
        );
        return;
      }
      case 'module': {
        const action = interaction.options.getString('action', true) as AntiNukeAction;
        const base = ['antinuke', 'modules', action];
        const changes: ConfigChange[] = [];
        if (interaction.options.getBoolean('reset')) changes.push({ path: base, value: undefined });
        const enabled = interaction.options.getBoolean('enabled');
        const limit = interaction.options.getInteger('limit');
        const window = interaction.options.getInteger('window');
        if (enabled !== null) changes.push({ path: [...base, 'enabled'], value: enabled });
        if (limit !== null) changes.push({ path: [...base, 'limit'], value: limit });
        if (window !== null) changes.push({ path: [...base, 'windowSeconds'], value: window });
        if (changes.length === 0) throw new UserError('Choose at least one option to change.');
        const m = (await app.configs.update(guild.id, userId, changes)).antinuke.modules[action];
        await reply(
          interaction,
          successCard(
            ANTINUKE_ACTION_LABELS[action],
            `${m.enabled ? `${E.on} protected` : `${E.off} not protected`} · limit **${m.limit}** per **${m.windowSeconds}s** · punishment **${PUNISHMENT_LABELS[m.punishment ?? an.punishment]}**`,
          ),
          { ephemeral: true },
        );
        return;
      }
      case 'settings': {
        const o = interaction.options;
        const map: Array<[unknown, string[]]> = [
          [o.getBoolean('revert'), ['antinuke', 'revert']],
          [o.getBoolean('anti_betray'), ['antinuke', 'antiBetray', 'enabled']],
          [o.getNumber('betray_multiplier'), ['antinuke', 'antiBetray', 'multiplier']],
          [o.getBoolean('monitor_extra_owners'), ['antinuke', 'antiBetray', 'monitorExtraOwners']],
          [o.getBoolean('auto_emergency'), ['antinuke', 'autoEmergency', 'enabled']],
          [o.getString('emergency_level'), ['antinuke', 'autoEmergency', 'level']],
          [o.getString('bot_add_action'), ['antinuke', 'botAddAction']],
          [o.getBoolean('lock_channels'), ['antinuke', 'emergency', 'lockChannels']],
          [o.getBoolean('pause_invites'), ['antinuke', 'emergency', 'pauseInvites']],
          [o.getInteger('snapshot_hours'), ['antinuke', 'snapshotIntervalHours']],
          [o.getInteger('snapshot_keep'), ['antinuke', 'snapshotRetention']],
          [o.getRole('quarantine_role')?.id ?? null, ['antinuke', 'quarantineRoleId']],
        ];
        const changes = map.filter(([value]) => value !== null).map(([value, path]) => ({ path, value }));
        if (changes.length === 0) throw new UserError('Choose at least one option to change.');
        const n = (await app.configs.update(guild.id, userId, changes)).antinuke;
        await logSecurityChange(
          app,
          guild,
          userId,
          `Updated: ${changes.map((c) => `\`${c.path.slice(1).join('.')}\``).join(', ')}.`,
        );
        await reply(
          interaction,
          Card.create()
            .header({ title: 'Anti-Nuke settings saved', emoji: E.check, level: 3 })
            .lines([
              ['Revert', n.revert ? 'on' : 'off'],
              [
                'Anti-betray',
                n.antiBetray.enabled
                  ? `on ×${n.antiBetray.multiplier}${n.antiBetray.monitorExtraOwners ? ', extra owners watched' : ''}`
                  : 'off',
              ],
              ['Auto emergency', n.autoEmergency.enabled ? `at ${n.autoEmergency.level}` : 'off'],
              [
                'Emergency',
                `${n.emergency.lockChannels ? 'locks channels' : 'channels stay open'} · ${n.emergency.pauseInvites ? 'pauses invites' : 'invites stay open'}`,
              ],
              ['Unapproved bots', n.botAddAction === 'ban' ? 'banned' : 'kicked'],
              [
                'Snapshots',
                n.snapshotIntervalHours
                  ? `every ${n.snapshotIntervalHours}h, keep ${n.snapshotRetention}`
                  : 'automatic off',
              ],
            ])
            .build(),
          { ephemeral: true },
        );
        return;
      }
      case 'protect': {
        const channel = interaction.options.getChannel('channel', true);
        const list = an.protectedChannelIds.includes(channel.id)
          ? an.protectedChannelIds.filter((id) => id !== channel.id)
          : [...an.protectedChannelIds, channel.id];
        await app.configs.set(guild.id, userId, ['antinuke', 'protectedChannelIds'], list);
        const on = list.includes(channel.id);
        await reply(
          interaction,
          successCard(
            on ? 'Channel protected' : 'Channel unprotected',
            `<#${channel.id}> ${on ? 'is now protected — deleting or editing it is always dangerous.' : 'is a normal channel again.'}\n-# Protected: ${list.map((id) => `<#${id}>`).join(', ') || 'none'}`,
          ),
          { ephemeral: true },
        );
        return;
      }
      case 'audit': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await reply(interaction, auditCard(app, guild, await auditGuild(app, guild, config)), {
          ephemeral: true,
        });
        return;
      }
      case 'simulate':
        await reply(interaction, simulationCard(an, interaction.options.getString('scenario', true)), {
          ephemeral: true,
        });
        return;
    }
  },
};
