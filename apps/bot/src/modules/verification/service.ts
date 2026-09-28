import { evaluateVerification, type LinkedAccount, type VerificationEvaluation } from '@quill/core';
import { verificationRepo } from '@quill/db';
import {
  type GuildConfig,
  IdentityRevokedMessage,
  REDIS_CHANNELS,
  redisKeys,
  signVerificationToken,
  VerificationCompletedMessage,
  VerificationReviewMessage,
} from '@quill/shared';
import type { Guild, GuildMember, User } from 'discord.js';
import type { App } from '../../app.js';
import { v2Edit, v2Message } from '../../ui/respond.js';
import { baseVars, renderTemplate } from '../../ui/templates.js';
import {
  blockedLogCard,
  type ReviewData,
  type ReviewDecision,
  reasonsText,
  reviewCard,
  verifiedLogCard,
} from './cards.js';

const DAY = 86_400_000;
const SWEEP_INTERVAL_MS = 60_000;

export type VerifyMethod = 'oauth' | 'simple' | 'sso' | 'manual';

export interface VerdictInput {
  verdict: VerificationEvaluation['verdict'];
  method: VerifyMethod;
  reasons: string[];
  confidence: number;
  linked: LinkedAccount[];
  /** Write `guild_verifications` (false for website results — the website already wrote them). */
  record: boolean;
}

export type VerdictOutcome = 'verified' | 'flagged' | 'blocked' | 'failed';

/**
 * Bot side of verification: the Verify button (simple mode, SSO or a signed website link), the
 * website's verdicts (`quill:verification:completed`), staff reviews (buttons + dashboard),
 * SSO/rejoin checks on join and the kick-if-unverified timer.
 */
export class VerificationService {
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly app: App) {}

  async init(): Promise<void> {
    const guard = (label: string, run: () => Promise<unknown>) =>
      void run().catch((err: unknown) => this.app.logger.error({ err }, `${label} failed`));
    await this.app.store.subscribe(REDIS_CHANNELS.verificationCompleted, (m) =>
      guard('verification completed', () => this.onCompleted(m)),
    );
    await this.app.store.subscribe(REDIS_CHANNELS.verificationReview, (m) =>
      guard('verification review', () => this.onReviewMessage(m)),
    );
    await this.app.store.subscribe(REDIS_CHANNELS.identityRevoked, (m) => {
      const parsed = IdentityRevokedMessage.safeParse(m);
      // Nothing is cached per identity on the bot side; roles stay until the member leaves.
      if (parsed.success) this.app.logger.debug({ userId: parsed.data.userId }, 'identity revoked');
    });
  }

  start(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(
      () =>
        void this.sweepUnverified().catch((err: unknown) =>
          this.app.logger.warn({ err }, 'unverified sweep failed'),
        ),
      SWEEP_INTERVAL_MS,
    );
    this.sweeper.unref();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  isWhitelisted(member: GuildMember, config: GuildConfig): boolean {
    const v = config.verification;
    return (
      v.whitelistUserIds.includes(member.id) || v.whitelistRoleIds.some((id) => member.roles.cache.has(id))
    );
  }

  isVerified(member: GuildMember, config: GuildConfig): boolean {
    const roleId = config.verification.verifiedRoleId;
    return roleId !== null && member.roles.cache.has(roleId);
  }

  /** Personal verification link (same token format the website verifies). */
  link(guildId: string, userId: string): string {
    const { token } = signVerificationToken({ guildId, userId }, this.app.env.VERIFY_TOKEN_SECRET);
    return `${this.app.env.WEBSITE_URL.replace(/\/$/, '')}/verify/${token}`;
  }

  /** Global QUILL identity recent enough for SSO. */
  async hasFreshIdentity(userId: string, config: GuildConfig): Promise<boolean> {
    const v = config.verification;
    if (!v.sso.accept) return false;
    const identity = await verificationRepo.getVerifiedIdentity(this.app.db, userId);
    return Boolean(identity && Date.now() - identity.lastVerifiedAt.getTime() < v.sso.maxAgeDays * DAY);
  }

  /** Accounts linked to `userId` with their standing in this guild. */
  async linkedWithStanding(guild: Guild, userId: string, config: GuildConfig, only?: readonly string[]) {
    const links = await verificationRepo.linkedAccounts(this.app.db, userId, 0.3);
    const filtered = only ? links.filter((l) => only.includes(l.userId)) : links;
    const ids = filtered.map((l) => l.userId);
    const [standing, network] = await Promise.all([
      verificationRepo.standingInGuild(this.app.db, guild.id, ids),
      config.verification.network.shareSignals
        ? verificationRepo.networkBanCounts(this.app.db, ids, guild.id)
        : Promise.resolve(new Map<string, number>()),
    ]);
    return filtered.map(
      (l): LinkedAccount => ({
        userId: l.userId,
        confidence: l.confidence,
        bannedHere: standing.get(l.userId)?.banned ?? false,
        punishedHere: standing.get(l.userId)?.punished ?? false,
        networkBans: network.get(l.userId) ?? 0,
      }),
    );
  }

  /** The website's evaluation, from stored data only (SSO, rejoin and one-click verification). */
  async assess(
    guild: Guild,
    user: User,
    config: GuildConfig,
  ): Promise<VerificationEvaluation & { linked: LinkedAccount[] }> {
    const linked = await this.linkedWithStanding(guild, user.id, config);
    const member = guild.members.cache.get(user.id);
    const evaluation = evaluateVerification({
      userId: user.id,
      accountCreatedAt: user.createdAt,
      config: config.verification,
      whitelisted: member
        ? this.isWhitelisted(member, config)
        : config.verification.whitelistUserIds.includes(user.id),
      isProxy: false,
      linked,
    });
    return { ...evaluation, linked };
  }

  /** Gives the verified role and removes the unverified role. */
  async grant(
    member: GuildMember,
    config: GuildConfig,
    reason: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const v = config.verification;
    if (!v.verifiedRoleId) return { ok: false, error: 'no verified role is configured' };
    try {
      if (!member.roles.cache.has(v.verifiedRoleId)) await member.roles.add(v.verifiedRoleId, reason);
      if (v.unverifiedRoleId && member.roles.cache.has(v.unverifiedRoleId)) {
        await member.roles.remove(v.unverifiedRoleId, reason);
      }
      await this.app.store.scheduleRemove(redisKeys.verifyKickQueue(member.guild.id), member.id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async dm(
    user: User,
    guild: Guild,
    config: GuildConfig,
    key: 'verification_success' | 'verification_flagged' | 'verification_blocked',
    reason?: string,
  ) {
    const card = renderTemplate(this.app, config, key, { ...baseVars(guild, user), reason: reason ?? '' });
    await user.send(v2Message(card)).catch(() => undefined);
  }

  // ── verdicts ────────────────────────────────────────────────────────────────

  /** Applies a verdict for a member (website result, SSO, rejoin or one-click). */
  async applyVerdict(
    guild: Guild,
    config: GuildConfig,
    user: User,
    member: GuildMember | null,
    input: VerdictInput,
  ): Promise<VerdictOutcome> {
    const v = config.verification;
    const data: ReviewData = {
      userId: user.id,
      method: input.method,
      reasons: input.reasons,
      confidence: input.confidence,
      linked: input.linked,
    };

    if (input.verdict === 'pass') {
      const granted = member
        ? await this.grant(member, config, `QUILL GUARD verification (${input.method})`)
        : { ok: false };
      if (input.record) {
        await verificationRepo.setGuildVerification(this.app.db, {
          guildId: guild.id,
          userId: user.id,
          status: 'verified',
          method: input.method,
        });
      }
      await this.app.logs.send(
        guild,
        'verification',
        verifiedLogCard(user.id, input.method, input.confidence, input.linked.length),
      );
      return granted.ok ? 'verified' : 'failed';
    }

    if (input.verdict === 'flag') {
      if (input.record) {
        await verificationRepo.setGuildVerification(this.app.db, {
          guildId: guild.id,
          userId: user.id,
          status: 'flagged',
          method: input.method,
        });
      }
      if (member && v.unverifiedRoleId && !member.roles.cache.has(v.unverifiedRoleId)) {
        await member.roles
          .add(v.unverifiedRoleId, 'QUILL GUARD: verification under review')
          .catch(() => undefined);
      }
      const message = await this.app.logs.send(guild, 'verification', reviewCard(data));
      if (message) {
        await this.app.store.set(
          redisKeys.verifyReviewCard(guild.id, user.id),
          JSON.stringify({ channelId: message.channelId, messageId: message.id, data }),
          30 * 86_400,
        );
      }
      await this.dm(user, guild, config, 'verification_flagged');
      return 'flagged';
    }

    if (input.record) {
      await verificationRepo.setGuildVerification(this.app.db, {
        guildId: guild.id,
        userId: user.id,
        status: 'denied',
        method: input.method,
      });
    }
    await this.dm(user, guild, config, 'verification_blocked', reasonsText(input.reasons));
    let action = 'none (staff notified)';
    if (v.evasion.blockAction !== 'none') {
      const result = await this.app.moderation.apply(
        guild,
        user,
        member,
        v.evasion.blockAction === 'ban' ? { type: 'ban', deleteMessageSeconds: 0 } : { type: 'kick' },
        {
          reason: `Verification blocked: ${reasonsText(input.reasons)}`,
          source: 'verification',
          logCase: false,
        },
      );
      const label = v.evasion.blockAction === 'ban' ? 'Banned' : 'Kicked';
      action = result.ok ? label : `${label} failed — ${result.error ?? 'unknown error'}`;
    }
    await this.app.logs.send(guild, 'verification', blockedLogCard(data, action));
    return 'blocked';
  }

  /** `quill:verification:completed` from the website (every shard receives it; the owner acts). */
  private async onCompleted(raw: unknown): Promise<void> {
    const parsed = VerificationCompletedMessage.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;
    const guild = this.app.client.guilds.cache.get(msg.guildId);
    if (!guild) return;
    if (!(await this.app.store.setNx(redisKeys.verifyHandled(msg.sessionId), '1', 3_600))) return;
    const config = await this.app.configs.get(guild.id);
    const user = await this.app.client.users.fetch(msg.userId).catch(() => null);
    if (!user) return;
    const member = await guild.members.fetch(msg.userId).catch(() => null);
    const linked = msg.linkedUserIds.length
      ? await this.linkedWithStanding(guild, msg.userId, config, msg.linkedUserIds)
      : [];
    await this.applyVerdict(guild, config, user, member, {
      verdict: msg.verdict,
      method: msg.method,
      reasons: msg.reasons,
      confidence: msg.confidence,
      linked,
      record: false,
    });
  }

  private async onReviewMessage(raw: unknown): Promise<void> {
    const parsed = VerificationReviewMessage.safeParse(raw);
    if (!parsed.success) return;
    const guild = this.app.client.guilds.cache.get(parsed.data.guildId);
    if (!guild) return;
    await this.review(
      guild,
      parsed.data.userId,
      parsed.data.decision,
      parsed.data.reviewerId,
      parsed.data.reason,
    );
  }

  /** Staff decision on a flagged member (review card buttons, /verification approve|deny, dashboard). */
  async review(
    guild: Guild,
    userId: string,
    decision: ReviewDecision,
    reviewerId: string,
    reason?: string,
  ): Promise<{ summary: string; cardClosed: boolean }> {
    const config = await this.app.configs.get(guild.id);
    const user = await this.app.client.users.fetch(userId);
    const member = await guild.members.fetch(userId).catch(() => null);
    const previous = await verificationRepo.getGuildVerification(this.app.db, guild.id, userId);
    const method = previous?.method ?? 'manual';
    let summary: string;
    if (decision === 'approve') {
      const granted = member
        ? await this.grant(member, config, `QUILL GUARD: verification approved by ${reviewerId}`)
        : { ok: false, error: 'not in the server' };
      await verificationRepo.setGuildVerification(this.app.db, {
        guildId: guild.id,
        userId,
        status: 'verified',
        method,
        reviewedBy: reviewerId,
      });
      await this.dm(user, guild, config, 'verification_success');
      summary = granted.ok
        ? `<@${userId}> is verified.`
        : `Approved, but the role could not be given: ${granted.error}`;
    } else if (decision === 'deny') {
      await verificationRepo.setGuildVerification(this.app.db, {
        guildId: guild.id,
        userId,
        status: 'denied',
        method,
        reviewedBy: reviewerId,
      });
      await this.dm(user, guild, config, 'verification_blocked', reason ?? 'Denied by staff');
      summary = `<@${userId}> was denied.`;
    } else {
      const result = await this.app.moderation.apply(
        guild,
        user,
        member,
        { type: 'ban', deleteMessageSeconds: 0 },
        {
          reason: `Verification review: ${reason ?? 'ban evasion'}`,
          source: 'verification',
          moderatorId: reviewerId,
          logCase: false,
        },
      );
      await verificationRepo.setGuildVerification(this.app.db, {
        guildId: guild.id,
        userId,
        status: 'denied',
        method,
        reviewedBy: reviewerId,
      });
      summary = result.ok ? `<@${userId}> was banned.` : `Ban failed: ${result.error ?? 'unknown error'}`;
    }
    const cardClosed = await this.closeReviewCard(guild, userId, decision, reviewerId, reason);
    return { summary, cardClosed };
  }

  /** Replaces the review card buttons with the decision (wherever the decision was made). */
  private async closeReviewCard(
    guild: Guild,
    userId: string,
    decision: ReviewDecision,
    by: string,
    reason?: string,
  ): Promise<boolean> {
    const key = redisKeys.verifyReviewCard(guild.id, userId);
    const raw = await this.app.store.get(key);
    if (!raw) return false;
    await this.app.store.del(key);
    try {
      const ref = JSON.parse(raw) as { channelId: string; messageId: string; data: ReviewData };
      const channel = guild.channels.cache.get(ref.channelId);
      if (!channel?.isTextBased()) return false;
      await channel.messages.edit(ref.messageId, v2Edit(reviewCard(ref.data, { decision, by, reason })));
      return true;
    } catch {
      return false; // card deleted or unreadable
    }
  }

  // ── joins & timers ──────────────────────────────────────────────────────────

  async onJoin(member: GuildMember): Promise<void> {
    if (member.user.bot) return;
    const guild = member.guild;
    const config = await this.app.configs.get(guild.id);
    const v = config.verification;
    if (!v.enabled || !v.verifiedRoleId || this.isVerified(member, config)) return;

    if (this.isWhitelisted(member, config)) {
      await this.grant(member, config, 'QUILL GUARD: whitelisted');
      return;
    }
    if (v.mode === 'oauth') {
      const previous = await verificationRepo.getGuildVerification(this.app.db, guild.id, member.id);
      const rejoin = previous?.status === 'verified';
      if (rejoin || (await this.hasFreshIdentity(member.id, config))) {
        const evaluation = await this.assess(guild, member.user, config);
        await this.applyVerdict(guild, config, member.user, member, {
          ...evaluation,
          method: rejoin ? (previous?.method ?? 'oauth') : 'sso',
          record: true,
        });
        return;
      }
    }
    if (v.assignUnverifiedOnJoin && v.unverifiedRoleId) {
      await member.roles.add(v.unverifiedRoleId, 'QUILL GUARD: awaiting verification').catch(() => undefined);
    }
    if (v.kickUnverifiedAfterMinutes > 0) {
      await this.app.store.scheduleAdd(
        redisKeys.verifyKickQueue(guild.id),
        member.id,
        Date.now() + v.kickUnverifiedAfterMinutes * 60_000,
      );
    }
  }

  /** Kicks members who did not verify in time (per shard, every minute). */
  async sweepUnverified(now = Date.now()): Promise<number> {
    let kicked = 0;
    for (const guild of this.app.client.guilds.cache.values()) kicked += await this.sweepGuild(guild, now);
    return kicked;
  }

  async sweepGuild(guild: Guild, now = Date.now()): Promise<number> {
    const config = await this.app.configs.get(guild.id);
    const v = config.verification;
    if (!v.enabled || v.kickUnverifiedAfterMinutes <= 0 || !v.verifiedRoleId) return 0;
    const key = redisKeys.verifyKickQueue(guild.id);
    let kicked = 0;
    for (const userId of await this.app.store.scheduleDue(key, now, 50)) {
      await this.app.store.scheduleRemove(key, userId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || this.isVerified(member, config) || this.isWhitelisted(member, config)) continue;
      const result = await this.app.moderation.apply(
        guild,
        member.user,
        member,
        { type: 'kick' },
        {
          reason: `Not verified within ${v.kickUnverifiedAfterMinutes} minutes`,
          source: 'verification',
          recordCase: false,
          logCase: false,
        },
      );
      if (result.ok) kicked++;
    }
    return kicked;
  }
}
