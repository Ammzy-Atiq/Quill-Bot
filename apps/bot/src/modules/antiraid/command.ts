import type { GuildConfig } from '@quill/shared';
import { type Guild, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { App } from '../../app.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { ACTION_CHOICES, actionFromOptions } from '../../lib/actions.js';
import { relative } from '../../lib/format.js';
import type { ConfigChange } from '../../services/guild-config.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';

async function statusCard(app: App, guild: Guild, config: GuildConfig) {
  const cfg = config.antiraid;
  const raid = await app.antiraid.state(guild.id);
  const filters = [
    cfg.minAccountAgeDays > 0 ? `accounts younger than ${cfg.minAccountAgeDays}d` : null,
    cfg.requireAvatar ? 'no avatar' : null,
    cfg.similarNames ? 'look-alike name waves' : null,
  ].filter(Boolean);
  return Card.create()
    .header({
      title: 'Anti-Raid',
      emoji: E.antiraid,
      subtitle: `${status(cfg.enabled)} · raid mode ${raid ? `**ACTIVE** until ${relative(raid.endsAt)}` : 'off'}`,
      thumbnail: app.logo(),
    })
    .lines([
      [
        'Raid trigger',
        `${cfg.joinRate.count} joins in ${cfg.joinRate.windowSeconds}s${cfg.raidMode.autoEnable ? '' : ' (alert only — auto raid mode off)'}`,
      ],
      [
        'During a raid',
        `${app.moderation.describe(cfg.raidMode.joinAction)} every new join for ${cfg.raidMode.durationMinutes} min`,
      ],
      [
        'Raid extras',
        `${cfg.raidMode.pauseInvites ? 'pause invites' : 'invites stay open'} · ${cfg.raidMode.tightenAntiNuke ? 'Anti-Nuke limits halved' : 'Anti-Nuke unchanged'}`,
      ],
      [
        'Join filters',
        filters.length ? `${filters.join(', ')} → ${app.moderation.describe(cfg.filterAction)}` : 'none',
      ],
    ])
    .text(raid ? `${E.siren} **Raid:** ${raid.reason}${raid.by ? ` · started by <@${raid.by}>` : ''}` : null)
    .footer('Tune with /antiraid settings · start or stop raid mode with /antiraid start | end')
    .build();
}

export const antiraidCommand: SlashCommand = {
  module: 'antiraid',
  permission: 'manager',
  data: new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('Anti-Raid: join spikes, raid mode and join filters.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show Anti-Raid settings and raid mode.'))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn Anti-Raid on.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn Anti-Raid off.'))
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start raid mode now.')
        .addIntegerOption((o) =>
          o.setName('minutes').setDescription('How long').setMinValue(1).setMaxValue(1440),
        )
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(200)),
    )
    .addSubcommand((s) => s.setName('end').setDescription('End raid mode.'))
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('Tune raid detection and responses.')
        .addIntegerOption((o) =>
          o
            .setName('join_count')
            .setDescription('Joins that start raid mode')
            .setMinValue(2)
            .setMaxValue(500),
        )
        .addIntegerOption((o) =>
          o
            .setName('join_seconds')
            .setDescription('…within this many seconds')
            .setMinValue(1)
            .setMaxValue(600),
        )
        .addBooleanOption((o) => o.setName('auto_raid_mode').setDescription('Start raid mode automatically'))
        .addIntegerOption((o) =>
          o.setName('raid_minutes').setDescription('Raid mode length').setMinValue(1).setMaxValue(1440),
        )
        .addStringOption((o) =>
          o
            .setName('raid_action')
            .setDescription('Action on joins during a raid')
            .addChoices(...ACTION_CHOICES),
        )
        .addStringOption((o) =>
          o.setName('raid_duration').setDescription('Timeout length for the raid action, e.g. 1h'),
        )
        .addBooleanOption((o) => o.setName('pause_invites').setDescription('Pause invites during a raid'))
        .addBooleanOption((o) =>
          o.setName('tighten_antinuke').setDescription('Halve Anti-Nuke limits during a raid'),
        )
        .addIntegerOption((o) =>
          o
            .setName('min_account_age')
            .setDescription('Filter accounts younger than N days (0 = off)')
            .setMinValue(0)
            .setMaxValue(365),
        )
        .addBooleanOption((o) =>
          o.setName('require_avatar').setDescription('Filter accounts without an avatar'),
        )
        .addBooleanOption((o) =>
          o.setName('similar_names').setDescription('Filter look-alike username waves'),
        )
        .addStringOption((o) =>
          o
            .setName('filter_action')
            .setDescription('Action for filtered joins')
            .addChoices(...ACTION_CHOICES),
        )
        .addStringOption((o) =>
          o.setName('filter_duration').setDescription('Timeout length for the filter action, e.g. 1h'),
        ),
    ),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    switch (sub) {
      case 'status':
        await reply(interaction, await statusCard(app, guild, config), { ephemeral: true });
        return;
      case 'enable':
      case 'disable': {
        const updated = await app.configs.set(guild.id, userId, ['antiraid', 'enabled'], sub === 'enable');
        await reply(interaction, await statusCard(app, guild, updated), { ephemeral: true });
        return;
      }
      case 'start': {
        const minutes = interaction.options.getInteger('minutes') ?? config.antiraid.raidMode.durationMinutes;
        const reason =
          interaction.options.getString('reason') ?? `Started manually by ${interaction.user.username}`;
        if (!(await app.antiraid.start(guild, reason, userId, minutes)))
          throw new UserError('Raid mode is already active.');
        await reply(
          interaction,
          successCard(
            'Raid mode started',
            `New joins get **${app.moderation.describe(config.antiraid.raidMode.joinAction)}** for ${minutes} min.`,
          ),
          {
            ephemeral: true,
          },
        );
        return;
      }
      case 'end':
        if (!(await app.antiraid.end(guild, userId))) throw new UserError('Raid mode is not active.');
        await reply(interaction, successCard('Raid mode ended', 'Joins are back to normal.'), {
          ephemeral: true,
        });
        return;
    }

    const o = interaction.options;
    const changes: ConfigChange[] = [];
    const push = (value: unknown, path: string[]) => {
      if (value !== null && value !== undefined) changes.push({ path, value });
    };
    push(o.getInteger('join_count'), ['antiraid', 'joinRate', 'count']);
    push(o.getInteger('join_seconds'), ['antiraid', 'joinRate', 'windowSeconds']);
    push(o.getBoolean('auto_raid_mode'), ['antiraid', 'raidMode', 'autoEnable']);
    push(o.getInteger('raid_minutes'), ['antiraid', 'raidMode', 'durationMinutes']);
    push(o.getBoolean('pause_invites'), ['antiraid', 'raidMode', 'pauseInvites']);
    push(o.getBoolean('tighten_antinuke'), ['antiraid', 'raidMode', 'tightenAntiNuke']);
    push(o.getInteger('min_account_age'), ['antiraid', 'minAccountAgeDays']);
    push(o.getBoolean('require_avatar'), ['antiraid', 'requireAvatar']);
    push(o.getBoolean('similar_names'), ['antiraid', 'similarNames']);
    const raidAction = o.getString('raid_action');
    if (raidAction)
      push(actionFromOptions(raidAction, o.getString('raid_duration')), [
        'antiraid',
        'raidMode',
        'joinAction',
      ]);
    const filterAction = o.getString('filter_action');
    if (filterAction)
      push(actionFromOptions(filterAction, o.getString('filter_duration')), ['antiraid', 'filterAction']);
    if (changes.length === 0) throw new UserError('Choose at least one option to change.');
    const updated = await app.configs.update(guild.id, userId, changes);
    await reply(interaction, await statusCard(app, guild, updated), { ephemeral: true });
  },
};

export const antiraidComponents: ComponentHandler[] = [
  {
    id: 'raid:end',
    permission: 'manager',
    async execute({ app, interaction, guild }) {
      if (!interaction.isButton()) return;
      const ended = await app.antiraid.end(guild, interaction.user.id);
      await reply(
        interaction,
        ended
          ? successCard('Raid mode ended', 'Joins are back to normal.')
          : successCard('Already over', 'Raid mode is not active.'),
        { ephemeral: true },
      );
    },
  },
];
