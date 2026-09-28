import { securityRepo } from '@quill/db';
import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { lockedId } from '../../framework/custom-id.js';
import { hasLevel } from '../../framework/permissions.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { formatDuration, relative, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { confirmCard, infoCard, successCard } from '../../ui/presets.js';
import { reply, update } from '../../ui/respond.js';
import { handleMemberBackup, membersGroup, serverGroup } from './member-backup.js';
import type { GuildSnapshotData } from './serialize.js';
import type { RestoreReport } from './snapshots.js';

const KIND_LABEL = { auto: 'automatic', manual: 'manual', pre_emergency: 'before emergency' } as const;

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const ago = (date: Date) => `${formatDuration((Date.now() - date.getTime()) / 1000) || 'just now'} ago`;

const CHANNEL_KIND: Record<number, string> = {
  [ChannelType.GuildCategory]: 'categories',
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildForum]: 'forum',
};

function progressCard(id: number, message: string) {
  return Card.create()
    .header({ title: `Restoring snapshot #${id}`, emoji: E.backup, level: 3 })
    .text(`${E.clock} ${message}`)
    .footer('Keep QUILL at the top of the role list. Large servers take a few minutes (Discord rate limits).')
    .build();
}

function restoreResultCard(id: number, mode: string, report: RestoreReport, by: string) {
  return Card.create()
    .header({
      title: `Snapshot #${id} restored`,
      emoji: report.errors.length ? E.warn : E.check,
      level: 3,
      subtitle: `${mode === 'full' ? 'Full restore' : 'Missing roles & channels only'} · by <@${by}>`,
    })
    .lines([
      ['Roles', `${report.rolesCreated} re-created · ${report.rolesUpdated} permissions reset`],
      ['Channels', `${report.channelsCreated} re-created · ${report.channelsUpdated} overwrites reset`],
      ['Members', `${report.membersReassigned} role(s) given back`],
    ])
    .text(
      report.errors.length
        ? `**${report.errors.length} problem(s):**\n${report.errors
            .slice(0, 8)
            .map((e) => `• ${truncate(e, 150)}`)
            .join('\n')}`
        : null,
    )
    .build();
}

export const backupCommand: SlashCommand = {
  module: 'backup',
  permission: 'extra_owner',
  subcommandPermissions: { 'server add': 'owner', 'server remove': 'owner', 'members pull': 'owner' },
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Server snapshots: roles, channels, permissions and settings — restore after a nuke.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Take a snapshot now.')
        .addStringOption((o) =>
          o.setName('label').setDescription('Name for this snapshot').setMaxLength(100),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List snapshots.'))
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Show what a snapshot contains.')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Snapshot').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('restore')
        .setDescription('Rebuild the server from a snapshot.')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Snapshot').setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('What to restore (default: missing only)')
            .addChoices(
              { name: 'Missing only — re-create deleted roles and channels', value: 'missing' },
              { name: 'Full — also reset permissions and server settings', value: 'full' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a snapshot.')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Snapshot').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommandGroup(serverGroup)
    .addSubcommandGroup(membersGroup),
  async autocomplete({ app, interaction, guild }) {
    const config = await app.configs.get(guild.id);
    if (!(await hasLevel(app, interaction.member, config, 'extra_owner'))) return interaction.respond([]);
    const query = String(interaction.options.getFocused() ?? '').toLowerCase();
    const rows = await securityRepo.listSnapshots(app.db, guild.id, 25);
    const choices = rows
      .map((r) => ({
        name: truncate(
          `#${r.id} · ${KIND_LABEL[r.kind]}${r.label ? ` · ${r.label}` : ''} · ${ago(r.createdAt)} · ${r.roleCount} roles, ${r.channelCount} channels`,
          100,
        ),
        value: r.id,
      }))
      .filter((c) => !query || c.name.toLowerCase().includes(query));
    return interaction.respond(choices.slice(0, 25));
  },
  async execute(ctx) {
    const { app, interaction, guild } = ctx;
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    if (group) {
      await handleMemberBackup(ctx, group, sub);
      return;
    }
    const userId = interaction.user.id;

    if (sub === 'create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const row = await app.snapshots.capture(
        guild,
        'manual',
        interaction.options.getString('label'),
        userId,
      );
      await reply(
        interaction,
        successCard(
          `Snapshot #${row.id} saved`,
          `${row.roleCount} roles · ${row.channelCount} channels · ${kb(row.sizeBytes)}\nRestore with \`/backup restore id:${row.id}\`.`,
        ),
        { ephemeral: true },
      );
      return;
    }

    if (sub === 'list') {
      const rows = await securityRepo.listSnapshots(app.db, guild.id, 20);
      await reply(
        interaction,
        Card.create()
          .header({ title: 'Snapshots', emoji: E.backup, subtitle: `${rows.length} most recent` })
          .text(
            rows
              .map(
                (r) =>
                  `**#${r.id}** · ${KIND_LABEL[r.kind]}${r.label ? ` · ${truncate(r.label, 40)}` : ''} · ${r.roleCount} roles · ${r.channelCount} channels · ${kb(r.sizeBytes)} · ${relative(r.createdAt)}`,
              )
              .join('\n') || 'No snapshots yet — take one with `/backup create`.',
          )
          .footer(
            'Automatic snapshots follow /antinuke settings snapshot_hours. Manual ones are never pruned.',
          )
          .build(),
        { ephemeral: true },
      );
      return;
    }

    const id = interaction.options.getInteger('id', true);
    const row = await securityRepo.getSnapshot(app.db, guild.id, id);
    if (!row) throw new UserError(`Snapshot #${id} does not exist.`);

    if (sub === 'view') {
      const data = row.data as unknown as GuildSnapshotData;
      const byKind = new Map<string, number>();
      for (const channel of data.channels) {
        const kind = CHANNEL_KIND[channel.type] ?? 'other';
        byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
      }
      const roles = [...data.roles].sort((a, b) => b.position - a.position);
      await reply(
        interaction,
        Card.create()
          .header({
            title: `Snapshot #${row.id}`,
            emoji: E.backup,
            subtitle: `${KIND_LABEL[row.kind]}${row.label ? ` · ${row.label}` : ''} · ${relative(row.createdAt)}${row.createdBy ? ` · by <@${row.createdBy}>` : ''}`,
          })
          .lines([
            ['Server', data.guild.name],
            ['Channels', [...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(' · ') || 'none'],
            [
              'Roles',
              `${roles.length}: ${roles
                .slice(0, 12)
                .map((r) => truncate(r.name, 24))
                .join(', ')}${roles.length > 12 ? '…' : ''}`,
            ],
            ['Size', kb(row.sizeBytes)],
          ])
          .footer(
            `Restore with /backup restore id:${row.id} — "missing" re-creates deleted things, "full" also resets permissions.`,
          )
          .build(),
        { ephemeral: true },
      );
      return;
    }

    if (sub === 'restore') {
      const mode = interaction.options.getString('mode') ?? 'missing';
      await reply(
        interaction,
        confirmCard({
          title: `Restore snapshot #${row.id}?`,
          body:
            mode === 'full'
              ? `**Full restore:** re-creates deleted roles and channels **and resets permissions, overwrites and server settings** to ${relative(row.createdAt)}. Changes made since then are lost. QUILL takes a safety snapshot first.`
              : `Re-creates roles and channels that exist in the snapshot but are missing now (with their permissions and members). Nothing existing is changed. QUILL takes a safety snapshot first.`,
          confirmId: lockedId(userId, 'bk', 'restore', row.id, mode),
          cancelId: lockedId(userId, 'bk', 'cancel'),
          confirmLabel: mode === 'full' ? 'Full restore' : 'Restore missing',
          danger: mode === 'full',
        }),
        { ephemeral: true },
      );
      return;
    }

    await reply(
      interaction,
      confirmCard({
        title: `Delete snapshot #${row.id}?`,
        body: `${KIND_LABEL[row.kind]} snapshot from ${relative(row.createdAt)} (${row.roleCount} roles, ${row.channelCount} channels). This cannot be undone.`,
        confirmId: lockedId(userId, 'bk', 'delete', row.id),
        cancelId: lockedId(userId, 'bk', 'cancel'),
        confirmLabel: 'Delete',
        danger: true,
      }),
      { ephemeral: true },
    );
  },
};

export const backupComponents: ComponentHandler[] = [
  {
    id: 'bk:restore',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const id = Number(args[0]);
      const mode = args[1] === 'full' ? 'full' : 'missing';
      const row = await securityRepo.getSnapshot(app.db, guild.id, id);
      if (!row) throw new UserError(`Snapshot #${id} does not exist.`);
      const lockKey = `quill:restore:lock:${guild.id}`;
      if (!(await app.store.setNx(lockKey, interaction.user.id, 3_600))) {
        throw new UserError('A restore is already running in this server.');
      }
      try {
        await update(interaction, progressCard(id, 'Taking a safety snapshot of the current state…'));
        await app.snapshots.capture(guild, 'manual', `Before restoring #${id}`, interaction.user.id);
        let lastEdit = 0;
        const report = await app.snapshots.restore(
          guild,
          row.data as unknown as GuildSnapshotData,
          mode,
          async (message) => {
            if (Date.now() - lastEdit < 2_000) return;
            lastEdit = Date.now();
            await update(interaction, progressCard(id, message)).catch(() => undefined);
          },
        );
        const result = restoreResultCard(id, mode, report, interaction.user.id);
        await update(interaction, result).catch(() => undefined);
        await app.logs.send(guild, 'antinuke', restoreResultCard(id, mode, report, interaction.user.id));
      } finally {
        await app.store.del(lockKey);
      }
    },
  },
  {
    id: 'bk:delete',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const id = Number(args[0]);
      const deleted = await securityRepo.deleteSnapshot(app.db, guild.id, id);
      await update(
        interaction,
        deleted
          ? successCard(`Snapshot #${id} deleted`)
          : infoCard('Already gone', `Snapshot #${id} no longer exists.`),
      );
    },
  },
  {
    id: 'bk:cancel',
    permission: 'extra_owner',
    locked: true,
    async execute({ interaction }) {
      if (!interaction.isButton()) return;
      await update(interaction, infoCard('Cancelled', 'Nothing was changed.'));
    },
  },
];
