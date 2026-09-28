import { cases as caseRepo } from '@quill/db';
import { DISCORD_LIMITS, type ModAction } from '@quill/shared';
import {
  type Collection,
  type GuildMember,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandStringOption,
  type SlashCommandUserOption,
  type User,
} from 'discord.js';
import { type CommandContext, type SlashCommand, UserError } from '../../framework/types.js';
import { parseDuration, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';
import { baseVars, renderTemplate } from '../../ui/templates.js';

const PERMISSION_NAMES = new Map<bigint, string>([
  [PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
  [PermissionFlagsBits.KickMembers, 'Kick Members'],
  [PermissionFlagsBits.BanMembers, 'Ban Members'],
  [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
  [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
]);

function requirePermission({ interaction }: CommandContext, flag: bigint) {
  if (!interaction.member.permissions.has(flag)) {
    throw new UserError(
      `You need the **${PERMISSION_NAMES.get(flag) ?? 'required'}** permission.`,
      'Missing permission',
    );
  }
}

/** The moderator must outrank the target (the owner outranks everyone). */
function assertHierarchy({ interaction, guild }: CommandContext, member: GuildMember | null) {
  if (!member) return;
  if (member.id === interaction.user.id) throw new UserError('You cannot moderate yourself.');
  if (member.id === guild.ownerId) throw new UserError('The server owner cannot be moderated.');
  if (
    interaction.user.id !== guild.ownerId &&
    member.roles.highest.comparePositionTo(interaction.member.roles.highest) >= 0
  ) {
    throw new UserError("That member's highest role is not below yours.");
  }
}

const reasonOf = (ctx: CommandContext) => ctx.interaction.options.getString('reason') ?? 'No reason provided';

/** Runs a punishment through ModerationService (hierarchy checks, DM first, case + log). */
async function act(ctx: CommandContext, user: User, action: ModAction, label: string) {
  const { app, interaction, guild, config } = ctx;
  const member = await guild.members.fetch(user.id).catch(() => null);
  assertHierarchy(ctx, member);
  const reason = reasonOf(ctx);
  const dm = renderTemplate(app, config, 'moderation_dm', {
    ...baseVars(guild, user),
    action: label,
    reason,
    moderator: interaction.user.username,
  });
  const result = await app.moderation.apply(guild, user, member, action, {
    reason,
    source: 'manual',
    moderatorId: interaction.user.id,
    dm,
  });
  if (!result.ok) throw new UserError(result.error ?? 'The action failed.');
  return { result, reason };
}

const userOption = (o: SlashCommandUserOption) =>
  o.setName('user').setDescription('Member').setRequired(true);
const reasonOption = (o: SlashCommandStringOption) =>
  o.setName('reason').setDescription('Reason').setMaxLength(500);

/** A punishment command: permission check → ModerationService → case → confirmation. */
function punishCommand(options: {
  data: SlashCommand['data'];
  flag: bigint;
  emoji: string;
  build: (ctx: CommandContext) => ModAction;
}): SlashCommand {
  return {
    module: 'moderation',
    permission: 'moderator',
    data: options.data,
    async execute(ctx) {
      requirePermission(ctx, options.flag);
      const user = ctx.interaction.options.getUser('user', true);
      const action = options.build(ctx);
      const label = ctx.app.moderation.describe(action);
      const { result, reason } = await act(ctx, user, action, label);
      await reply(
        ctx.interaction,
        successCard(
          `${options.emoji} ${label} · case #${result.caseRow?.caseNumber ?? '—'}`,
          `<@${user.id}> — ${truncate(reason, 300)}`,
        ),
        { ephemeral: true },
      );
    },
  };
}

export const kickCommand = punishCommand({
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(userOption)
    .addStringOption(reasonOption),
  flag: PermissionFlagsBits.KickMembers,
  emoji: E.boot,
  build: () => ({ type: 'kick' }),
});

export const softbanCommand = punishCommand({
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Kick a member and delete their last day of messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(userOption)
    .addStringOption(reasonOption),
  flag: PermissionFlagsBits.BanMembers,
  emoji: E.boot,
  build: () => ({ type: 'softban' }),
});

export const banCommand = punishCommand({
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user (works for people who already left).')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(userOption)
    .addStringOption(reasonOption)
    .addIntegerOption((o) =>
      o
        .setName('delete_messages')
        .setDescription('Delete their recent messages')
        .addChoices(
          { name: "Don't delete", value: 0 },
          { name: 'Last hour', value: 3_600 },
          { name: 'Last 24 hours', value: 86_400 },
          { name: 'Last 7 days', value: 604_800 },
        ),
    ),
  flag: PermissionFlagsBits.BanMembers,
  emoji: E.hammer,
  build: (ctx) => ({
    type: 'ban',
    deleteMessageSeconds: Math.min(
      ctx.interaction.options.getInteger('delete_messages') ?? 0,
      DISCORD_LIMITS.banDeleteMessageMaxSeconds,
    ),
  }),
});

export const quarantineCommand = punishCommand({
  data: new SlashCommandBuilder()
    .setName('quarantine')
    .setDescription('Take every role away and lock the member into the quarantine role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(userOption)
    .addStringOption(reasonOption),
  flag: PermissionFlagsBits.ManageRoles,
  emoji: E.lock,
  build: () => ({ type: 'quarantine' }),
});

export const timeoutCommand = punishCommand({
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time a member out.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(userOption)
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('How long, e.g. 10m, 2h, 7d (max 28d)')
        .setRequired(true)
        .setMaxLength(20),
    )
    .addStringOption(reasonOption),
  flag: PermissionFlagsBits.ModerateMembers,
  emoji: E.mute,
  build: (ctx) => {
    const seconds = parseDuration(ctx.interaction.options.getString('duration', true));
    if (!seconds) throw new UserError('Use a duration like `10m`, `2h` or `7d`.', 'Invalid duration');
    return {
      type: 'timeout',
      durationSeconds: Math.min(Math.max(seconds, 5), DISCORD_LIMITS.timeoutMaxSeconds),
    };
  },
});

export const warnCommand: SlashCommand = {
  module: 'moderation',
  permission: 'moderator',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member (recorded as a case, expires after the configured days).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500).setRequired(true))
    .addIntegerOption((o) =>
      o.setName('points').setDescription('Risk points to add (default 0)').setMinValue(0).setMaxValue(200),
    ),
  async execute(ctx) {
    const { app, interaction, guild } = ctx;
    const user = interaction.options.getUser('user', true);
    if (user.bot) throw new UserError('Bots cannot be warned.');
    const { result, reason } = await act(ctx, user, { type: 'warn' }, 'Warning');
    const points = interaction.options.getInteger('points') ?? 0;
    const score = points > 0 ? await app.risk.addPoints(guild.id, user.id, points) : null;
    await reply(
      interaction,
      successCard(
        `${E.warn} Warning · case #${result.caseRow?.caseNumber ?? '—'}`,
        `<@${user.id}> — ${truncate(reason, 300)}${score !== null ? `\n+${points} risk points → score **${score}**` : ''}`,
      ),
      { ephemeral: true },
    );
  },
};

export const untimeoutCommand: SlashCommand = {
  module: 'moderation',
  permission: 'moderator',
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription("Remove a member's timeout.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(userOption)
    .addStringOption(reasonOption),
  async execute(ctx) {
    requirePermission(ctx, PermissionFlagsBits.ModerateMembers);
    const { app, interaction, guild } = ctx;
    const member = await guild.members.fetch(interaction.options.getUser('user', true).id).catch(() => null);
    if (!member?.isCommunicationDisabled()) throw new UserError('That member is not timed out.');
    assertHierarchy(ctx, member);
    const reason = reasonOf(ctx);
    await member.timeout(null, truncate(`QUILL GUARD | ${interaction.user.username}: ${reason}`, 500));
    const row = await app.cases.create(guild, {
      userId: member.id,
      moderatorId: interaction.user.id,
      source: 'manual',
      type: 'untimeout',
      reason,
    });
    await reply(interaction, successCard(`Timeout removed · case #${row.caseNumber}`, `<@${member.id}>`), {
      ephemeral: true,
    });
  },
};

export const unbanCommand: SlashCommand = {
  module: 'moderation',
  permission: 'moderator',
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('User ID').setRequired(true).setMaxLength(20))
    .addStringOption(reasonOption),
  async execute(ctx) {
    requirePermission(ctx, PermissionFlagsBits.BanMembers);
    const { app, interaction, guild } = ctx;
    const userId = interaction.options.getString('user_id', true).trim();
    if (!/^\d{17,20}$/.test(userId)) throw new UserError('That is not a user ID.');
    const reason = reasonOf(ctx);
    const removed = await guild.bans
      .remove(userId, truncate(`QUILL GUARD | ${interaction.user.username}: ${reason}`, 500))
      .then(() => true)
      .catch(() => false);
    if (!removed) throw new UserError('That user is not banned (or QUILL lacks Ban Members).');
    const row = await app.cases.create(guild, {
      userId,
      moderatorId: interaction.user.id,
      source: 'manual',
      type: 'unban',
      reason,
    });
    await reply(
      interaction,
      successCard(`Unbanned · case #${row.caseNumber}`, `<@${userId}> \`${userId}\``),
      { ephemeral: true },
    );
  },
};

export const unquarantineCommand: SlashCommand = {
  module: 'moderation',
  permission: 'moderator',
  data: new SlashCommandBuilder()
    .setName('unquarantine')
    .setDescription('Give a quarantined member their roles back.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(userOption)
    .addStringOption(reasonOption),
  async execute(ctx) {
    requirePermission(ctx, PermissionFlagsBits.ManageRoles);
    const { app, interaction, guild } = ctx;
    const user = interaction.options.getUser('user', true);
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) throw new UserError('That member is not in the server.');
    assertHierarchy(ctx, member);
    const recent = await caseRepo.listUserCases(app.db, guild.id, user.id, { limit: 25 });
    const last = recent.find((c) => c.active && (c.type === 'quarantine' || c.type === 'strip_roles'));
    if (!last) throw new UserError('No active quarantine or role removal found for that member.');
    const details = last.details as { previousRoles?: string[]; quarantineRoleId?: string | null };
    const reason = reasonOf(ctx);
    await app.moderation.restoreRoles(
      member,
      details.previousRoles ?? [],
      truncate(`QUILL GUARD | ${interaction.user.username}: ${reason}`, 500),
      details.quarantineRoleId ?? null,
    );
    await caseRepo.deactivateCase(app.db, guild.id, last.caseNumber);
    const row = await app.cases.create(guild, {
      userId: user.id,
      moderatorId: interaction.user.id,
      source: 'manual',
      type: 'unquarantine',
      reason: `${reason} (reverses case #${last.caseNumber})`,
    });
    await reply(
      interaction,
      successCard(
        `Roles given back · case #${row.caseNumber}`,
        `<@${user.id}> got ${details.previousRoles?.length ?? 0} role(s) back.`,
      ),
      { ephemeral: true },
    );
  },
};

export const purgeCommand: SlashCommand = {
  module: 'moderation',
  permission: 'moderator',
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete recent messages in this channel (max 100, younger than 14 days).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only messages from this user'))
    .addStringOption((o) =>
      o.setName('contains').setDescription('Only messages containing this text').setMaxLength(100),
    )
    .addBooleanOption((o) => o.setName('bots').setDescription('Only messages from bots')),
  async execute(ctx) {
    requirePermission(ctx, PermissionFlagsBits.ManageMessages);
    const { app, interaction, guild } = ctx;
    const channel = interaction.channel;
    if (!channel || !('bulkDelete' in channel)) throw new UserError('Use this in a text channel.');
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');
    const contains = interaction.options.getString('contains')?.toLowerCase() ?? null;
    const bots = interaction.options.getBoolean('bots') ?? false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cutoff = Date.now() - 14 * 86_400_000 + 60_000;
    const fetched: Collection<string, Message> = await channel.messages.fetch({ limit: 100 });
    const targets = fetched
      .filter(
        (m) =>
          !m.pinned &&
          m.createdTimestamp > cutoff &&
          m.id !== interaction.id &&
          (!user || m.author.id === user.id) &&
          (!bots || m.author.bot) &&
          (!contains || m.content.toLowerCase().includes(contains)),
      )
      .first(amount);
    if (targets.length === 0) throw new UserError('No matching messages from the last 14 days.');
    const deleted = await channel.bulkDelete(targets, true);
    await app.logs.send(
      guild,
      'moderation',
      Card.create()
        .header({ title: 'Messages purged', emoji: E.trash, level: 3 })
        .lines([
          ['Channel', `<#${channel.id}>`],
          ['Deleted', String(deleted.size)],
          [
            'Filters',
            [
              user ? `from <@${user.id}>` : null,
              contains ? `containing "${truncate(contains, 40)}"` : null,
              bots ? 'bots only' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'none',
          ],
          ['Moderator', `<@${interaction.user.id}>`],
        ])
        .build(),
    );
    await reply(interaction, successCard('Purged', `Deleted **${deleted.size}** message(s).`), {
      ephemeral: true,
    });
  },
};

export const moderationCommands: SlashCommand[] = [
  warnCommand,
  timeoutCommand,
  untimeoutCommand,
  kickCommand,
  softbanCommand,
  banCommand,
  unbanCommand,
  quarantineCommand,
  unquarantineCommand,
  purgeCommand,
];
