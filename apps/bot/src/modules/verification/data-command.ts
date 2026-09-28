import { verificationRepo } from '@quill/db';
import { decryptSecret, type IdentityRevokedMessage, REDIS_CHANNELS } from '@quill/shared';
import { SlashCommandBuilder } from 'discord.js';
import type { App } from '../../app.js';
import { lockedId } from '../../framework/custom-id.js';
import type { ComponentHandler, SlashCommand } from '../../framework/types.js';
import { relative, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { confirmCard, infoCard, successCard } from '../../ui/presets.js';
import { reply, update } from '../../ui/respond.js';

/** Revokes the user's Discord OAuth grant (needs DISCORD_CLIENT_SECRET). */
async function revokeGrant(app: App, userId: string): Promise<boolean> {
  const grant = await verificationRepo.getOAuthGrant(app.db, userId);
  if (!grant || !app.env.DISCORD_CLIENT_SECRET) return false;
  const response = await fetch('https://discord.com/api/v10/oauth2/token/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: decryptSecret(grant.accessTokenEnc, app.encryptionKey),
      token_type_hint: 'access_token',
      client_id: app.env.DISCORD_CLIENT_ID,
      client_secret: app.env.DISCORD_CLIENT_SECRET,
    }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

export const dataCommand: SlashCommand = {
  module: 'verification',
  permission: 'everyone',
  data: new SlashCommandBuilder()
    .setName('data')
    .setDescription('Your QUILL GUARD data: see or delete what verification stored about you.')
    .addSubcommand((s) => s.setName('view').setDescription('See what QUILL stores about you.'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete your verification data everywhere.')),
  async execute({ app, interaction }) {
    const userId = interaction.user.id;
    if (interaction.options.getSubcommand() === 'delete') {
      await reply(
        interaction,
        confirmCard({
          title: 'Delete your QUILL verification data?',
          body: 'This deletes your device/network hashes, linked-account records, OAuth authorisation and verification history in **every** server. You keep your roles here, but servers may ask you to verify again. Moderation records (cases, bans) belong to the servers and are not deleted.',
          confirmId: lockedId(userId, 'data', 'delete'),
          cancelId: lockedId(userId, 'data', 'cancel'),
          confirmLabel: 'Delete my data',
          danger: true,
        }),
        { ephemeral: true },
      );
      return;
    }
    const summary = await verificationRepo.userDataSummary(app.db, userId);
    const servers = summary.servers
      .slice(0, 10)
      .map((s) => `• ${truncate(s.name ?? s.guildId, 40)} — ${s.status} (${s.method})`)
      .join('\n');
    await reply(
      interaction,
      Card.create()
        .header({ title: 'Your QUILL data', emoji: E.fingerprint, level: 3 })
        .lines([
          [
            'QUILL identity',
            summary.identity
              ? `verified ${summary.identity.verificationCount}× · first ${relative(summary.identity.firstVerifiedAt)} · last ${relative(summary.identity.lastVerifiedAt)}`
              : 'none',
          ],
          ['Device / network hashes', `${summary.fingerprints} (one-way hashes — never your raw IP)`],
          ['Linked-account records', String(summary.identityLinks)],
          [
            'Discord authorisation',
            summary.oauth
              ? `${summary.oauth.scopes.join(', ')} · since ${relative(summary.oauth.createdAt)}${summary.oauth.revoked ? ' · revoked' : ''}`
              : 'none',
          ],
        ])
        .text(
          summary.servers.length
            ? `**Servers (${summary.servers.length})**\n${servers}${summary.servers.length > 10 ? '\n…' : ''}`
            : null,
        )
        .footer(`Delete everything with /data delete · ${app.env.WEBSITE_URL.replace(/\/$/, '')}/privacy`)
        .build(),
      { ephemeral: true },
    );
  },
};

export const dataComponents: ComponentHandler[] = [
  {
    id: 'data:delete',
    permission: 'everyone',
    locked: true,
    async execute({ app, interaction }) {
      if (!interaction.isButton()) return;
      const userId = interaction.user.id;
      const revoked = await revokeGrant(app, userId);
      const counts = await verificationRepo.deleteUserData(app.db, userId);
      await app.store.publish(REDIS_CHANNELS.identityRevoked, { userId } satisfies IdentityRevokedMessage);
      await update(
        interaction,
        successCard(
          'Your data was deleted',
          `${counts.fingerprints} hash record(s), ${counts.identityLinks} link(s), ${counts.sessions} session(s) removed; ${counts.guildVerificationsRevoked} server verification(s) revoked.${
            counts.oauthGrants
              ? revoked
                ? ' Discord authorisation revoked.'
                : ' Discord authorisation removed.'
              : ''
          }`,
        ),
      );
    },
  },
  {
    id: 'data:cancel',
    permission: 'everyone',
    locked: true,
    async execute({ interaction }) {
      if (!interaction.isButton()) return;
      await update(interaction, infoCard('Cancelled', 'Nothing was deleted.'));
    },
  },
];
