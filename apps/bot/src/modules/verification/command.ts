import { verificationRepo } from '@quill/db';
import type { GuildConfig } from '@quill/shared';
import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Guild,
  MessageFlags,
  PermissionFlagsBits,
  type Role,
  SlashCommandBuilder,
} from 'discord.js';
import type { App } from '../../app.js';
import { cid } from '../../framework/custom-id.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { relative } from '../../lib/format.js';
import type { ConfigChange } from '../../services/guild-config.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { infoCard, successCard } from '../../ui/presets.js';
import { followUp, reply, send, v2Edit } from '../../ui/respond.js';
import { baseVars, renderTemplate } from '../../ui/templates.js';
import { dangerousNames, hasDangerous } from '../antinuke/mapping.js';
import { linkCard, linkedText, METHOD_LABELS, type ReviewDecision } from './cards.js';

function assertAssignable(guild: Guild, role: Role, label: string) {
  if (role.id === guild.id) throw new UserError(`The ${label} cannot be @everyone.`);
  if (role.managed) throw new UserError(`The ${label} is managed by an integration.`);
  const me = guild.members.me;
  if (me && role.comparePositionTo(me.roles.highest) >= 0) {
    throw new UserError(`The ${label} is above QUILL's role — move QUILL higher in the role list.`);
  }
  if (hasDangerous(role.permissions.bitfield)) {
    throw new UserError(
      `The ${label} has dangerous permissions (${dangerousNames(role.permissions.bitfield).join(', ')}). Verification roles must never grant moderation powers.`,
    );
  }
}

export function verificationSummary(app: App, config: GuildConfig) {
  const v = config.verification;
  const e = v.evasion;
  return Card.create()
    .header({
      title: 'Verification',
      emoji: E.verify,
      subtitle: `${status(v.enabled)} · ${v.mode === 'oauth' ? 'website + Discord login + device check' : 'one-click button'}`,
      thumbnail: app.logo(),
    })
    .lines([
      [
        'Roles',
        `verified ${v.verifiedRoleId ? `<@&${v.verifiedRoleId}>` : '`not set`'} · unverified ${v.unverifiedRoleId ? `<@&${v.unverifiedRoleId}>` : '—'}`,
      ],
      ['Panel', v.panel.channelId ? `<#${v.panel.channelId}>` : 'not posted — `/verification panel`'],
      [
        'On join',
        `${v.assignUnverifiedOnJoin && v.unverifiedRoleId ? 'unverified role' : 'no role'}${v.kickUnverifiedAfterMinutes ? ` · kick if unverified after ${v.kickUnverifiedAfterMinutes} min` : ''}`,
      ],
      [
        'Alt & evasion checks',
        e.enabled
          ? `matches ≥ ${Math.round(e.minConfidence * 100)}% → **${e.onMatch}**${e.onMatch === 'block' ? ` (${e.blockAction})` : ''} · VPN: ${e.vpnPolicy}${e.minAccountAgeDays ? ` · accounts < ${e.minAccountAgeDays}d flagged` : ''}`
          : 'off',
      ],
      ['SSO', v.sso.accept ? `accepted (verified elsewhere within ${v.sso.maxAgeDays} days)` : 'off'],
      ['Partner signals', v.network.shareSignals ? 'shared with opted-in servers' : 'off'],
      ['Backup consent', v.backup.enabled ? 'asked during verification' : 'off'],
      ['Whitelist', `${v.whitelistUserIds.length} user(s) · ${v.whitelistRoleIds.length} role(s)`],
    ])
    .footer(
      `Verification link: ${app.env.WEBSITE_URL.replace(/\/$/, '')}/verify/… · reviews appear in the verification log`,
    )
    .build();
}

export const verificationCommand: SlashCommand = {
  module: 'verification',
  permission: 'manager',
  subcommandPermissions: { status: 'moderator' },
  data: new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Verification: website login, alt & ban-evasion checks, SSO.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Choose the roles and turn verification on.')
        .addRoleOption((o) =>
          o.setName('verified_role').setDescription('Given after verification').setRequired(true),
        )
        .addRoleOption((o) =>
          o.setName('unverified_role').setDescription('Given on join until verified (optional)'),
        )
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('How members verify (default: website)')
            .addChoices(
              { name: 'Website — Discord login + alt / ban-evasion checks', value: 'oauth' },
              { name: 'One-click button', value: 'simple' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('panel')
        .setDescription('Post the verification panel.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel (default: here)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('Evasion policy, SSO, timers and more.')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Verification mode')
            .addChoices({ name: 'Website', value: 'oauth' }, { name: 'One-click', value: 'simple' }),
        )
        .addBooleanOption((o) =>
          o.setName('assign_unverified').setDescription('Give the unverified role on join'),
        )
        .addIntegerOption((o) =>
          o
            .setName('kick_after_minutes')
            .setDescription('Kick unverified members after N minutes (0 = never)')
            .setMinValue(0)
            .setMaxValue(10_080),
        )
        .addBooleanOption((o) => o.setName('check_alts').setDescription('Look for alts of punished members'))
        .addStringOption((o) =>
          o
            .setName('on_match')
            .setDescription('When an alt / evader is found')
            .addChoices(
              { name: 'Flag for staff review', value: 'flag' },
              { name: 'Block automatically', value: 'block' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('block_action')
            .setDescription('Action when blocked')
            .addChoices(
              { name: 'Ban', value: 'ban' },
              { name: 'Kick', value: 'kick' },
              { name: 'None', value: 'none' },
            ),
        )
        .addNumberOption((o) =>
          o
            .setName('min_confidence')
            .setDescription('Match confidence needed, 0.3–1 (default 0.75)')
            .setMinValue(0.3)
            .setMaxValue(1),
        )
        .addStringOption((o) =>
          o
            .setName('vpn_policy')
            .setDescription('VPN / proxy users are…')
            .addChoices(
              { name: 'Allowed', value: 'allow' },
              { name: 'Flagged', value: 'flag' },
              { name: 'Blocked', value: 'block' },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName('min_account_age')
            .setDescription('Flag accounts younger than N days (0 = off)')
            .setMinValue(0)
            .setMaxValue(365),
        )
        .addBooleanOption((o) =>
          o.setName('sso').setDescription('Accept members verified in other QUILL servers'),
        )
        .addIntegerOption((o) =>
          o
            .setName('sso_max_age_days')
            .setDescription('How recent an SSO verification must be')
            .setMinValue(1)
            .setMaxValue(365),
        )
        .addBooleanOption((o) =>
          o.setName('share_signals').setDescription('Share ban signals with other opted-in servers'),
        )
        .addBooleanOption((o) =>
          o.setName('backup_consent').setDescription('Ask members to consent to backup-server re-adds'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription("A member's verification status and linked accounts.")
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('approve')
        .setDescription('Verify a member (e.g. after a review).')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('deny')
        .setDescription("Deny a member's verification.")
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((o) =>
          o.setName('reason').setDescription('Reason (sent to the member)').setMaxLength(300),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('whitelist')
        .setDescription('Toggle a user who always passes verification.')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('disable').setDescription('Turn verification off.'))
    .addSubcommand((s) => s.setName('view').setDescription('Show the verification settings.')),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const v = config.verification;

    switch (sub) {
      case 'view':
        await reply(interaction, verificationSummary(app, config), { ephemeral: true });
        return;
      case 'setup': {
        const verified = interaction.options.getRole('verified_role', true);
        const unverified = interaction.options.getRole('unverified_role');
        assertAssignable(guild, verified, 'verified role');
        if (unverified) {
          assertAssignable(guild, unverified, 'unverified role');
          if (unverified.id === verified.id) throw new UserError('Use two different roles.');
        }
        const changes: ConfigChange[] = [
          { path: ['verification', 'verifiedRoleId'], value: verified.id },
          { path: ['verification', 'enabled'], value: true },
        ];
        if (unverified) changes.push({ path: ['verification', 'unverifiedRoleId'], value: unverified.id });
        const mode = interaction.options.getString('mode');
        if (mode) changes.push({ path: ['verification', 'mode'], value: mode });
        const updated = await app.configs.update(guild.id, userId, changes);
        await reply(
          interaction,
          [
            verificationSummary(app, updated),
            infoCard(
              'Next',
              'Post the panel with `/verification panel`. Deny @everyone access to your channels and allow the verified role, so only verified members get in.',
            ),
          ],
          {
            ephemeral: true,
          },
        );
        return;
      }
      case 'panel': {
        if (!v.verifiedRoleId) throw new UserError('Run `/verification setup` first.');
        const picked = interaction.options.getChannel('channel');
        const channel = guild.channels.cache.get(picked?.id ?? interaction.channelId);
        if (!channel?.isSendable()) throw new UserError('QUILL cannot send messages in that channel.');
        const panel = renderTemplate(app, config, 'verification_panel', baseVars(guild), (card) =>
          card.buttons(
            new ButtonBuilder()
              .setCustomId(cid('verify', 'start'))
              .setLabel('Verify')
              .setEmoji(E.verify)
              .setStyle(ButtonStyle.Success),
          ),
        );
        const message = await send(channel, panel);
        await app.configs.update(guild.id, userId, [
          { path: ['verification', 'panel', 'channelId'], value: channel.id },
          { path: ['verification', 'panel', 'messageId'], value: message.id },
        ]);
        await reply(
          interaction,
          successCard(
            'Panel posted',
            `${message.url}\nEdit its text with the \`verification_panel\` template.`,
          ),
          { ephemeral: true },
        );
        return;
      }
      case 'settings': {
        const o = interaction.options;
        const map: Array<[unknown, string[]]> = [
          [o.getString('mode'), ['verification', 'mode']],
          [o.getBoolean('assign_unverified'), ['verification', 'assignUnverifiedOnJoin']],
          [o.getInteger('kick_after_minutes'), ['verification', 'kickUnverifiedAfterMinutes']],
          [o.getBoolean('check_alts'), ['verification', 'evasion', 'checkAlts']],
          [o.getString('on_match'), ['verification', 'evasion', 'onMatch']],
          [o.getString('block_action'), ['verification', 'evasion', 'blockAction']],
          [o.getNumber('min_confidence'), ['verification', 'evasion', 'minConfidence']],
          [o.getString('vpn_policy'), ['verification', 'evasion', 'vpnPolicy']],
          [o.getInteger('min_account_age'), ['verification', 'evasion', 'minAccountAgeDays']],
          [o.getBoolean('sso'), ['verification', 'sso', 'accept']],
          [o.getInteger('sso_max_age_days'), ['verification', 'sso', 'maxAgeDays']],
          [o.getBoolean('share_signals'), ['verification', 'network', 'shareSignals']],
          [o.getBoolean('backup_consent'), ['verification', 'backup', 'enabled']],
        ];
        const changes = map.filter(([value]) => value !== null).map(([value, path]) => ({ path, value }));
        if (changes.length === 0) throw new UserError('Choose at least one option to change.');
        const updated = await app.configs.update(guild.id, userId, changes);
        await reply(interaction, verificationSummary(app, updated), { ephemeral: true });
        return;
      }
      case 'status': {
        const user = interaction.options.getUser('user', true);
        const [row, identity, linked] = await Promise.all([
          verificationRepo.getGuildVerification(app.db, guild.id, user.id),
          verificationRepo.getVerifiedIdentity(app.db, user.id),
          app.verification.linkedWithStanding(guild, user.id, config),
        ]);
        await reply(
          interaction,
          Card.create()
            .header({
              title: 'Verification status',
              emoji: E.fingerprint,
              subtitle: `<@${user.id}>`,
              level: 3,
              thumbnail: user.displayAvatarURL({ size: 128 }),
            })
            .lines([
              [
                'Here',
                row
                  ? `**${row.status}** · ${METHOD_LABELS[row.method] ?? row.method} · ${relative(row.verifiedAt)}${row.reviewedBy ? ` · reviewed by <@${row.reviewedBy}>` : ''}`
                  : 'never verified',
              ],
              [
                'QUILL identity',
                identity
                  ? `verified ${identity.verificationCount}× · last ${relative(identity.lastVerifiedAt)}`
                  : 'none',
              ],
              ['Account created', relative(user.createdAt)],
            ])
            .text(`**Linked accounts (≥ 30%)**\n${linkedText(linked)}`)
            .build(),
          { ephemeral: true },
        );
        return;
      }
      case 'approve':
      case 'deny': {
        const user = interaction.options.getUser('user', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { summary } = await app.verification.review(
          guild,
          user.id,
          sub,
          userId,
          interaction.options.getString('reason') ?? undefined,
        );
        await reply(interaction, successCard(sub === 'approve' ? 'Approved' : 'Denied', summary), {
          ephemeral: true,
        });
        return;
      }
      case 'whitelist': {
        const user = interaction.options.getUser('user', true);
        const on = !v.whitelistUserIds.includes(user.id);
        const list = on
          ? [...v.whitelistUserIds, user.id]
          : v.whitelistUserIds.filter((id) => id !== user.id);
        if (list.length > 100) throw new UserError('The verification whitelist is full (100).');
        await app.configs.set(guild.id, userId, ['verification', 'whitelistUserIds'], list);
        await reply(
          interaction,
          successCard(
            on ? 'Whitelisted' : 'Removed',
            `<@${user.id}> ${on ? 'always passes verification' : 'is verified normally again'}.`,
          ),
          {
            ephemeral: true,
          },
        );
        return;
      }
      case 'disable':
        await app.configs.set(guild.id, userId, ['verification', 'enabled'], false);
        await reply(
          interaction,
          successCard(
            'Verification disabled',
            'The Verify button now tells members that verification is off.',
          ),
          { ephemeral: true },
        );
        return;
    }
  },
};

async function decide(ctx: Parameters<ComponentHandler['execute']>[0], decision: ReviewDecision) {
  const { app, interaction, guild, args } = ctx;
  if (!interaction.isButton()) return;
  if (decision === 'ban' && !interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
    throw new UserError('You need the Ban Members permission.');
  }
  await interaction.deferUpdate();
  const userId = args[0]!;
  const { summary, cardClosed } = await app.verification.review(guild, userId, decision, interaction.user.id);
  if (!cardClosed) {
    // No stored reference (e.g. Redis was flushed): close the card this button belongs to.
    await interaction.editReply(
      v2Edit(
        Card.create()
          .header({ title: 'Verification reviewed', emoji: E.fingerprint, level: 3 })
          .text(`<@${userId}> — **${decision}** by <@${interaction.user.id}>`)
          .build(),
      ) as Parameters<typeof interaction.editReply>[0],
    );
  }
  await followUp(interaction, successCard('Review saved', summary), { ephemeral: true });
}

export const verificationComponents: ComponentHandler[] = [
  {
    id: 'verify:start',
    permission: 'everyone',
    async execute({ app, interaction, guild, config }) {
      if (!interaction.isButton()) return;
      const v = config.verification;
      const member = interaction.member;
      if (!v.enabled || !v.verifiedRoleId)
        throw new UserError('Verification is not enabled in this server right now.', 'Verification off');
      if (app.verification.isVerified(member, config)) {
        await reply(interaction, infoCard('Already verified', 'You already have access. ✨'), {
          ephemeral: true,
        });
        return;
      }
      if (!(await app.store.setNx(`quill:verify:click:${guild.id}:${member.id}`, '1', 5))) {
        throw new UserError('Please wait a few seconds before trying again.', 'Slow down');
      }
      const template = (key: 'verification_success' | 'verification_flagged' | 'verification_blocked') =>
        renderTemplate(app, config, key, { ...baseVars(guild, interaction.user), reason: '' });

      if (app.verification.isWhitelisted(member, config)) {
        await app.verification.grant(member, config, 'QUILL GUARD: whitelisted');
        await reply(interaction, template('verification_success'), { ephemeral: true });
        return;
      }
      const sso = v.mode === 'oauth' && (await app.verification.hasFreshIdentity(member.id, config));
      if (v.mode === 'simple' || sso) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const evaluation = await app.verification.assess(guild, interaction.user, config);
        const outcome = await app.verification.applyVerdict(guild, config, interaction.user, member, {
          ...evaluation,
          method: sso ? 'sso' : 'simple',
          record: true,
        });
        const key =
          outcome === 'flagged'
            ? 'verification_flagged'
            : outcome === 'blocked'
              ? 'verification_blocked'
              : 'verification_success';
        if (outcome === 'failed')
          throw new UserError('QUILL could not give you the verified role. Please tell the staff.');
        await reply(interaction, template(key), { ephemeral: true });
        return;
      }
      await reply(
        interaction,
        linkCard(app.verification.link(guild.id, member.id), guild.name, app.env.WEBSITE_URL),
        {
          ephemeral: true,
        },
      );
    },
  },
  { id: 'vr:approve', permission: 'manager', execute: (ctx) => decide(ctx, 'approve') },
  { id: 'vr:deny', permission: 'manager', execute: (ctx) => decide(ctx, 'deny') },
  { id: 'vr:ban', permission: 'manager', execute: (ctx) => decide(ctx, 'ban') },
];
