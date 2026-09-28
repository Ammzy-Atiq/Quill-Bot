import { securityRepo, verificationRepo } from '@quill/db';
import { decryptSecret, encryptSecret, type MemberPullJob, parseEncryptionKey } from '@quill/shared';
import { DiscordAPIError, MessageFlags, Routes } from 'discord.js';
import { Card } from '../ui/card.js';
import { E } from '../ui/emojis.js';
import type { WorkerContext } from './jobs.js';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** A usable `guilds.join` access token for the user (refreshed and re-encrypted when expired). */
async function accessToken(ctx: WorkerContext, key: Buffer, userId: string): Promise<string | null> {
  const grant = await verificationRepo.getOAuthGrant(ctx.db, userId);
  if (!grant || grant.revokedAt || !grant.scopes.includes('guilds.join')) return null;
  if (grant.expiresAt.getTime() > Date.now() + 60_000) return decryptSecret(grant.accessTokenEnc, key);
  if (!ctx.env.DISCORD_CLIENT_SECRET) return null;
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: decryptSecret(grant.refreshTokenEnc, key),
      client_id: ctx.env.DISCORD_CLIENT_ID,
      client_secret: ctx.env.DISCORD_CLIENT_SECRET,
    }),
  }).catch(() => null);
  if (!response?.ok) return null; // authorisation revoked or refresh token expired
  const token = (await response.json()) as TokenResponse;
  await verificationRepo.upsertOAuthGrant(ctx.db, {
    userId,
    accessTokenEnc: encryptSecret(token.access_token, key),
    refreshTokenEnc: encryptSecret(token.refresh_token, key),
    scopes: token.scope.split(' '),
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
  });
  return token.access_token;
}

/**
 * Re-adds verified members who consented (`guild_verifications.backup_consent`) to a backup
 * server with their `guilds.join` grant. Progress lives in `member_pull_jobs`; the requester gets
 * a DM at the end. Discord rate limits are handled by the REST client's queue.
 */
export async function runMemberPull(ctx: WorkerContext, data: MemberPullJob) {
  const { db, rest, logger } = ctx;
  const key = parseEncryptionKey(ctx.env.ENCRYPTION_KEY);
  await securityRepo.updatePullJob(db, data.jobId, { status: 'running' });
  const userIds = await verificationRepo.backupConsentingUserIds(db, data.sourceGuildId);
  const counts = { total: userIds.length, added: 0, skipped: 0, failed: 0 };
  await securityRepo.updatePullJob(db, data.jobId, { total: counts.total });

  let fatal: string | null = null;
  for (const [index, userId] of userIds.entries()) {
    try {
      const token = await accessToken(ctx, key, userId);
      if (!token) {
        counts.skipped++;
      } else {
        const result = await rest.put(Routes.guildMember(data.targetGuildId, userId), {
          body: { access_token: token },
        });
        // 201 returns the new member; 204 (empty body) means they were already there.
        if (result && typeof result === 'object' && 'user' in result) counts.added++;
        else counts.skipped++;
      }
    } catch (error) {
      counts.failed++;
      // Missing access / unknown guild: nothing else will work either.
      if (
        error instanceof DiscordAPIError &&
        (error.code === 10004 || error.code === 50001 || error.code === 50013)
      ) {
        fatal = `Discord refused the request (${error.code}: ${error.message})`;
        break;
      }
    }
    if (index % 10 === 9) await securityRepo.updatePullJob(db, data.jobId, counts);
  }

  await securityRepo.updatePullJob(db, data.jobId, {
    ...counts,
    status: fatal ? 'failed' : 'done',
    error: fatal,
  });
  logger.info({ job: data.jobId, ...counts, fatal }, 'member pull finished');

  // Tell the requester (REST only: open a DM channel, send a Components V2 card).
  try {
    const dm = (await rest.post(Routes.userChannels(), { body: { recipient_id: data.requestedBy } })) as {
      id: string;
    };
    const card = Card.create()
      .header({
        title: `Member pull #${data.jobId} ${fatal ? 'stopped' : 'finished'}`,
        emoji: fatal ? E.warn : E.backup,
        level: 3,
      })
      .lines([
        ['Added', String(counts.added)],
        ['Already there / no valid authorisation', String(counts.skipped)],
        ['Failed', String(counts.failed)],
      ])
      .text(fatal ? `${E.cross} ${fatal}` : null)
      .footer(`From server ${data.sourceGuildId} into ${data.targetGuildId}`)
      .build();
    await rest.post(Routes.channelMessages(dm.id), {
      body: {
        flags: MessageFlags.IsComponentsV2,
        components: [card.toJSON()],
        allowed_mentions: { parse: [] },
      },
    });
  } catch (error) {
    logger.warn({ err: error, job: data.jobId }, 'could not DM the member pull result');
  }
  return counts;
}
