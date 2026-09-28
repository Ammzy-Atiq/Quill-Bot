import { decayScore, evaluateRisk, type RiskDecision, type RiskState, type RiskViolation } from '@quill/core';
import { riskRepo } from '@quill/db';
import { redisKeys } from '@quill/shared';
import type { GuildMember, User } from 'discord.js';
import type { App } from '../app.js';

const STATE_TTL_SECONDS = 30 * 86_400;

/**
 * Per-member risk scores. Hot copy in Redis (fast, shared by shards), durable copy in
 * Postgres (written on every change, read when Redis has no entry).
 */
export class RiskService {
  constructor(private readonly app: App) {}

  async state(guildId: string, userId: string): Promise<RiskState | null> {
    const raw = await this.app.store.get(redisKeys.risk(guildId, userId));
    if (raw) return JSON.parse(raw) as RiskState;
    const row = await riskRepo.getRisk(this.app.db, guildId, userId);
    if (!row) return null;
    return {
      score: row.score,
      updatedAt: row.updatedAt.getTime(),
      lastStepThreshold: row.lastStepThreshold,
      lastViolationAt: row.lastViolationAt?.getTime() ?? null,
    };
  }

  /** Current decayed score. */
  async score(guildId: string, userId: string): Promise<number> {
    const state = await this.state(guildId, userId);
    if (!state) return 0;
    const config = await this.app.configs.get(guildId);
    return (
      Math.round(decayScore(state.score, state.updatedAt, Date.now(), config.risk.halfLifeHours) * 10) / 10
    );
  }

  /** Adds violations for a member and returns the decision (ladder step to execute, if any). */
  async evaluate(
    guildId: string,
    user: User,
    member: GuildMember | null,
    violations: RiskViolation[],
  ): Promise<RiskDecision> {
    const config = await this.app.configs.get(guildId);
    const previous = await this.state(guildId, user.id);
    const verifiedRole = config.verification.verifiedRoleId;
    const decision = evaluateRisk(previous, violations, config.risk, {
      now: Date.now(),
      accountCreatedAt: user.createdTimestamp,
      verified: Boolean(verifiedRole && member?.roles.cache.has(verifiedRole)),
      altSuspect: false,
    });
    await this.save(guildId, user.id, decision.state);
    return decision;
  }

  async save(guildId: string, userId: string, state: RiskState): Promise<void> {
    await this.app.store.set(redisKeys.risk(guildId, userId), JSON.stringify(state), STATE_TTL_SECONDS);
    await riskRepo
      .saveRisk(this.app.db, {
        guildId,
        userId,
        score: state.score,
        lastStepThreshold: state.lastStepThreshold,
        lastViolationAt: state.lastViolationAt ? new Date(state.lastViolationAt) : null,
      })
      .catch((err: unknown) => this.app.logger.warn({ err }, 'risk persist failed'));
  }

  /**
   * Adds manual points (e.g. `/warn points:`) to the decayed score without running the ladder —
   * the next AutoMod violation escalates from the new score.
   */
  async addPoints(guildId: string, userId: string, points: number): Promise<number> {
    const config = await this.app.configs.get(guildId);
    const now = Date.now();
    const previous = await this.state(guildId, userId);
    const base = previous
      ? decayScore(previous.score, previous.updatedAt, now, config.risk.halfLifeHours)
      : 0;
    const state: RiskState = {
      score: base + points,
      updatedAt: now,
      lastStepThreshold: previous?.lastStepThreshold ?? 0,
      lastViolationAt: now,
    };
    await this.save(guildId, userId, state);
    return Math.round(state.score * 10) / 10;
  }

  async reset(guildId: string, userId: string): Promise<void> {
    await this.app.store.del(redisKeys.risk(guildId, userId));
    await riskRepo.deleteRisk(this.app.db, guildId, userId);
  }
}
