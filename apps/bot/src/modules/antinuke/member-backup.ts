import { securityRepo, verificationRepo } from '@quill/db';
import {
  type APIGuild,
  PermissionFlagsBits,
  Routes,
  type SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { lockedId } from '../../framework/custom-id.js';
import { type CommandContext, type ComponentHandler, UserError } from '../../framework/types.js';
import { relative } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { confirmCard, successCard } from '../../ui/presets.js';
import { reply, update } from '../../ui/respond.js';

const SNOWFLAKE = /^\d{17,20}$/;

export const serverGroup = (g: SlashCommandSubcommandGroupBuilder) =>
  g
    .setName('server')
    .setDescription('Backup servers for member recovery (members who consented can be re-added).')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Register a backup server you also own (run in your main server).')
        .addStringOption((o) =>
          o.setName('server_id').setDescription('Backup server ID — QUILL must be in it').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Unregister a backup server.')
        .addStringOption((o) => o.setName('server_id').setDescription('Backup server ID').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List backup servers of this server.'));

export const membersGroup = (g: SlashCommandSubcommandGroupBuilder) =>
  g
    .setName('members')
    .setDescription('Re-add verified members who consented (run in the backup server).')
    .addSubcommand((s) =>
      s
        .setName('pull')
        .setDescription('Re-add consenting members of your main server into this backup server.')
        .addStringOption((o) =>
          o.setName('main_server_id').setDescription('ID of the main server').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Recent member pulls into this server.'));

const readId = (value: string) => {
  const id = value.trim();
  if (!SNOWFLAKE.test(id))
    throw new UserError(
      'That is not a server ID (enable Developer Mode → right-click the server → Copy Server ID).',
    );
  return id;
};

export async function handleMemberBackup(
  { app, interaction, guild, config }: CommandContext,
  group: string,
  sub: string,
) {
  const userId = interaction.user.id;
  if (group === 'server') {
    if (sub === 'list') {
      const rows = await securityRepo.listBackupServers(app.db, guild.id);
      const consenting = (await verificationRepo.backupConsentingUserIds(app.db, guild.id)).length;
      await reply(
        interaction,
        Card.create()
          .header({
            title: 'Backup servers',
            emoji: E.backup,
            subtitle: `${consenting} verified member(s) consented to be re-added`,
          })
          .text(
            rows
              .map(
                (r) =>
                  `• ${app.client.guilds.cache.get(r.targetGuildId)?.name ?? 'Server'} · \`${r.targetGuildId}\` · added ${relative(r.createdAt)}`,
              )
              .join('\n') || 'No backup servers yet — `/backup server add`.',
          )
          .footer(
            config.verification.backup.enabled
              ? 'Members are asked for consent while verifying on the website.'
              : 'Turn on consent with /verification settings backup_consent:true — without it nobody can be re-added.',
          )
          .build(),
        { ephemeral: true },
      );
      return;
    }
    const targetId = readId(interaction.options.getString('server_id', true));
    if (sub === 'remove') {
      const removed = await securityRepo.removeBackupServer(app.db, guild.id, targetId);
      if (!removed) throw new UserError('That server is not registered as a backup.');
      await reply(interaction, successCard('Backup server removed', `\`${targetId}\``), { ephemeral: true });
      return;
    }
    if (targetId === guild.id) throw new UserError('A server cannot be its own backup.');
    const target = (await app.client.rest.get(Routes.guild(targetId)).catch(() => null)) as APIGuild | null;
    if (!target) throw new UserError('QUILL is not in that server — invite QUILL there first.');
    if (target.owner_id !== userId) throw new UserError('You must own the backup server as well.');
    await securityRepo.addBackupServer(app.db, {
      sourceGuildId: guild.id,
      targetGuildId: targetId,
      ownerId: userId,
    });
    await reply(
      interaction,
      successCard(
        'Backup server registered',
        `**${target.name}** can now receive members of **${guild.name}** who consented. If this server is ever destroyed, run \`/backup members pull main_server_id:${guild.id}\` in **${target.name}**.${
          config.verification.backup.enabled
            ? ''
            : `\n${E.warn} Turn on consent: \`/verification settings backup_consent:true\`.`
        }`,
      ),
      { ephemeral: true },
    );
    return;
  }

  if (sub === 'status') {
    const jobs = await securityRepo.listPullJobs(app.db, guild.id, 10);
    await reply(
      interaction,
      Card.create()
        .header({ title: 'Member pulls', emoji: E.backup, level: 3 })
        .text(
          jobs
            .map(
              (j) =>
                `**#${j.id}** · ${j.status} · ${j.added}/${j.total} added · ${j.skipped} skipped · ${j.failed} failed · ${relative(j.createdAt)}${j.error ? `\n-# ${j.error}` : ''}`,
            )
            .join('\n') || 'No member pulls yet.',
        )
        .build(),
      { ephemeral: true },
    );
    return;
  }

  const sourceId = readId(interaction.options.getString('main_server_id', true));
  const link = await securityRepo.getBackupLink(app.db, sourceId, guild.id);
  if (!link) {
    throw new UserError(
      'That server has not registered this one as its backup. Run `/backup server add` in the main server first.',
    );
  }
  if (link.ownerId !== userId)
    throw new UserError('Only the owner who registered this backup can pull members.');
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
    throw new UserError('QUILL needs the **Create Invite** permission here to add members.');
  }
  if (!app.jobs.available) throw new UserError('Member pulls need Redis and the QUILL worker process.');
  const count = (await verificationRepo.backupConsentingUserIds(app.db, sourceId)).length;
  if (count === 0) throw new UserError('No verified members of that server have consented to backups yet.');
  await reply(
    interaction,
    confirmCard({
      title: `Re-add ${count} member(s)?`,
      body: `QUILL will add every verified member of \`${sourceId}\` who consented into **${guild.name}**, using their Discord authorisation. This runs in the background and respects Discord's rate limits.`,
      confirmId: lockedId(userId, 'bk', 'pull', sourceId),
      cancelId: lockedId(userId, 'bk', 'cancel'),
      confirmLabel: 'Start pull',
    }),
    { ephemeral: true },
  );
}

export const memberBackupComponents: ComponentHandler[] = [
  {
    id: 'bk:pull',
    permission: 'owner',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isButton()) return;
      const sourceGuildId = args[0]!;
      const link = await securityRepo.getBackupLink(app.db, sourceGuildId, guild.id);
      if (!link || link.ownerId !== interaction.user.id)
        throw new UserError('This backup link no longer exists.');
      const job = await securityRepo.createPullJob(app.db, {
        sourceGuildId,
        targetGuildId: guild.id,
        requestedBy: interaction.user.id,
      });
      try {
        await app.jobs.enqueueMemberPull({
          jobId: job.id,
          sourceGuildId,
          targetGuildId: guild.id,
          requestedBy: interaction.user.id,
        });
      } catch (error) {
        await securityRepo.updatePullJob(app.db, job.id, {
          status: 'failed',
          error: 'could not queue the job',
        });
        throw error;
      }
      await update(
        interaction,
        successCard(
          'Member pull started',
          `Job **#${job.id}** is running in the background. You'll get a DM when it finishes; progress: \`/backup members status\`.`,
        ),
      );
    },
  },
];
