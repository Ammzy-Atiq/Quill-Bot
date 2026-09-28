import {
  type DetectorContext,
  extractInviteCodes,
  type MessageInput,
  normalize,
  type RecentMessage,
  type RiskDecision,
  runDetectors,
  type Violation,
} from '@quill/core';
import {
  type DetectorKey,
  type DetectorResponse,
  type GuildConfig,
  MOD_ACTION_RANK,
  type ModAction,
  redisKeys,
} from '@quill/shared';
import { type GuildMember, type Message, PermissionFlagsBits } from 'discord.js';
import type { App } from '../../app.js';
import { LruCache } from '../../lib/lru.js';
import { v2Message } from '../../ui/respond.js';
import { baseVars, renderTemplate } from '../../ui/templates.js';
import { automodLogCard } from './cards.js';
import { dHashUrl } from './image-hash.js';

const HISTORY_SIZE = 40;
const HISTORY_TTL_SECONDS = 15 * 60;

const inviteCache = new LruCache<string, string | null>(20_000, 60 * 60_000);

function strongest(actions: Array<ModAction | null | undefined>): ModAction | null {
  let best: ModAction | null = null;
  for (const action of actions) {
    if (
      action &&
      action.type !== 'none' &&
      (!best || MOD_ACTION_RANK[action.type] > MOD_ACTION_RANK[best.type])
    ) {
      best = action;
    }
  }
  return best;
}

export class AutomodService {
  constructor(private readonly app: App) {}

  /** Entry point for messageCreate / messageUpdate. */
  async handle(message: Message, edited = false): Promise<void> {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
    const config = await this.app.configs.get(message.guildId);
    const automod = config.automod;
    if (!automod.enabled) return;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member || member.id === message.guild.ownerId) return;
    const parentId = 'parentId' in message.channel ? message.channel.parentId : null;
    if (automod.exempt.userIds.includes(member.id)) return;
    if (
      automod.exempt.channelIds.includes(message.channelId) ||
      (parentId && automod.exempt.channelIds.includes(parentId))
    ) {
      return;
    }
    if (member.roles.cache.some((r) => automod.exempt.roleIds.includes(r.id))) return;
    if (
      automod.exempt.manageMessagesBypass &&
      member.permissionsIn(message.channelId).has(PermissionFlagsBits.ManageMessages)
    ) {
      return;
    }

    const started = Date.now();
    const input = await this.buildInput(message, member, config);
    const data = await this.app.automodData.guild(message.guildId);
    const historyKey = redisKeys.spamRecent(message.guildId, member.id);
    const history = (await this.app.store.list(historyKey))
      .map((raw) => {
        try {
          return JSON.parse(raw) as RecentMessage;
        } catch {
          return null;
        }
      })
      .filter((m): m is RecentMessage => m !== null);

    const ctx: DetectorContext = {
      config: automod,
      normalized: normalize([input.content, ...input.extraText].join('\n'), automod.normalizer),
      builtin: this.app.automodData.builtin(),
      custom: data.custom,
      history,
      now: started,
      scam: await this.app.automodData.scam(message.guildId),
      policies: data.policies,
      memberRoleIds: [...member.roles.cache.keys()],
    };
    const result = runDetectors(input, ctx);
    if (!edited)
      await this.app.store.pushCapped(
        historyKey,
        JSON.stringify(result.record),
        HISTORY_SIZE,
        HISTORY_TTL_SECONDS,
      );

    const violations = [...result.violations];
    let aiNote: string | null = null;
    if (
      automod.ai.enabled &&
      input.content.length >= automod.ai.minMessageLength &&
      (automod.ai.mode === 'all' || result.borderline)
    ) {
      const outcome = await this.app.ai.classify(message.guildId, {
        text: input.content,
        hints: violations.map((v) => v.reason),
      });
      if (outcome.status === 'ok') {
        const v = outcome.verdict;
        aiNote = `${v.flagged ? 'flagged' : 'clean'} · ${v.category} · ${Math.round(v.confidence * 100)}%`;
        if (v.flagged && v.category !== 'none' && v.confidence >= automod.ai.threshold) {
          violations.push({
            detector: 'ai',
            category: v.category,
            severity: v.category === 'sexual_minors' ? 5 : v.confidence >= 0.95 ? 4 : 3,
            reason: `AI: ${v.reason}`,
            evidence: [`${v.category} ${Math.round(v.confidence * 100)}%`],
            flags: ['ai'],
          });
        }
      } else if (outcome.status !== 'no_key') {
        aiNote = outcome.status === 'error' ? `error: ${outcome.error}` : outcome.status.replace('_', ' ');
      }
    }

    if (violations.length === 0) return;
    await this.enforce(message, member, config, violations, aiNote);
    this.app.logger.debug(
      { guildId: message.guildId, ms: Date.now() - started, n: violations.length },
      'automod enforced',
    );
  }

  private async buildInput(
    message: Message<true>,
    member: GuildMember,
    config: GuildConfig,
  ): Promise<MessageInput> {
    const extraText = [
      ...message.embeds.flatMap((e) => [e.title ?? '', e.description ?? '', e.author?.name ?? '']),
      ...message.stickers.map((s) => s.name),
      ...(message.poll
        ? [message.poll.question.text ?? '', ...message.poll.answers.map((a) => a.text ?? '')]
        : []),
    ].filter(Boolean);

    const inviteGuilds: Record<string, string | null> = {};
    if (config.automod.links.enabled) {
      for (const code of extractInviteCodes([message.content, ...extraText].join('\n')).slice(0, 5)) {
        let guildId = inviteCache.get(code);
        if (guildId === undefined) {
          guildId = await this.app.client
            .fetchInvite(code)
            .then((inv) => inv.guild?.id ?? null)
            .catch(() => null);
          inviteCache.set(code, guildId);
        }
        inviteGuilds[code] = guildId;
      }
    }

    const hashImages = config.automod.scam.enabled && config.automod.scam.imageHashes;
    const knownHashes = hashImages
      ? (await this.app.automodData.guild(message.guildId)).imageHashes.length > 0
      : false;
    const attachments = await Promise.all(
      [...message.attachments.values()].slice(0, 5).map(async (a) => ({
        name: a.name,
        contentType: a.contentType,
        size: a.size,
        url: a.url,
        imageHash: knownHashes ? await dHashUrl(a.url, a.contentType, a.size) : null,
      })),
    );

    const targets = new Set<string>(
      message.mentions.users.filter((u) => !u.bot && u.id !== member.id).map((u) => u.id),
    );
    if (message.mentions.repliedUser && message.mentions.repliedUser.id !== member.id)
      targets.add(message.mentions.repliedUser.id);

    return {
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: member.id,
      content: message.content,
      extraText,
      createdAt: message.createdTimestamp,
      mentions: {
        users: message.mentions.users.size,
        roles: message.mentions.roles.size,
        everyone: /@(?:everyone|here)\b/.test(message.content),
      },
      targetUserIds: [...targets],
      attachments,
      accountCreatedAt: member.user.createdTimestamp,
      canMentionEveryone: member.permissionsIn(message.channelId).has(PermissionFlagsBits.MentionEveryone),
      inviteGuilds,
    };
  }

  private responseFor(v: Violation, config: GuildConfig): DetectorResponse {
    if (v.detector === 'policy') {
      return {
        deleteMessage: v.policyDelete ?? true,
        pointsMultiplier: 1,
        immediate: v.policyAction ?? null,
        notifyUser: true,
      };
    }
    return config.automod[v.detector as DetectorKey].response;
  }

  private isShadow(v: Violation, config: GuildConfig): boolean {
    return v.detector !== 'policy' && config.automod[v.detector as DetectorKey].shadow;
  }

  private async enforce(
    message: Message<true>,
    member: GuildMember,
    config: GuildConfig,
    all: Violation[],
    aiNote: string | null,
  ): Promise<void> {
    const guild = message.guild;
    const active = all.filter((v) => !this.isShadow(v, config)).sort((a, b) => b.severity - a.severity);
    const shadow = all.filter((v) => this.isShadow(v, config));

    if (active.length === 0) {
      const throttle = await this.app.store.setNx(`quill:am:shadowlog:${guild.id}:${member.id}`, '1', 10);
      if (throttle) {
        await this.app.logs.send(
          guild,
          'automod',
          automodLogCard({ message, member, violations: shadow, shadow: true, deleted: false, ai: aiNote }),
        );
      }
      return;
    }

    const responses = active.map((v) => this.responseFor(v, config));
    const shouldDelete = responses.some((r) => r.deleteMessage);
    let deleted = false;
    if (shouldDelete)
      deleted = await message
        .delete()
        .then(() => true)
        .catch(() => false);

    // Burst protection: one full enforcement per member+reason every few seconds; the rest are only deleted.
    const top = active[0]!;
    const fresh = await this.app.store.setNx(
      `quill:am:burst:${guild.id}:${member.id}:${top.detector}:${top.category}`,
      '1',
      4,
    );
    if (!fresh) return;

    let decision: RiskDecision | null = null;
    if (config.risk.enabled) {
      decision = await this.app.risk.evaluate(
        guild.id,
        member.user,
        member,
        active.map((v, i) => ({
          severity: v.severity,
          pointsMultiplier: responses[i]!.pointsMultiplier,
          detector: v.detector,
        })),
      );
    }

    const immediate = strongest(responses.map((r) => r.immediate));
    const ladder = decision?.step?.action ?? null;
    const finalAction = strongest([immediate, ladder]);
    const fromLadder = finalAction !== null && finalAction === ladder && ladder !== immediate;
    const notify = responses.some((r) => r.notifyUser);
    const vars = {
      ...baseVars(guild, member.user),
      reason: top.reason,
      detector: top.detector,
      channel: `<#${message.channelId}>`,
      score: decision ? Math.round(decision.state.score) : '',
    };

    let actionInfo: { label: string; ok: boolean; error?: string } | null = null;
    let caseNumber: number | null = null;
    const details = {
      detectors: active.map((v) => `${v.detector}:${v.category}`),
      evidence: active.flatMap((v) => v.evidence).slice(0, 10),
      channelId: message.channelId,
      flags: [...new Set(active.flatMap((v) => v.flags))],
    };

    if (finalAction) {
      const label = this.app.moderation.describe(finalAction);
      const dmKey = fromLadder ? 'risk_action_dm' : 'automod_dm';
      const dm = notify
        ? renderTemplate(this.app, config, dmKey, { ...vars, action: label, case: '…' })
        : null;
      const result = await this.app.moderation.apply(guild, member.user, member, finalAction, {
        reason: fromLadder
          ? `${top.reason} (risk score ${Math.round(decision?.state.score ?? 0)})`
          : top.reason,
        source: fromLadder ? 'risk' : 'automod',
        points: decision?.added ?? 0,
        details,
        dm,
        logCase: false,
      });
      actionInfo = { label, ok: result.ok, error: result.error };
      caseNumber = result.caseRow?.caseNumber ?? null;
    } else if (deleted || decision) {
      const row = await this.app.cases.create(guild, {
        userId: member.id,
        moderatorId: null,
        source: 'automod',
        type: deleted ? 'delete' : 'note',
        reason: top.reason,
        details,
        points: decision?.added ?? 0,
        log: false,
      });
      caseNumber = row.caseNumber;
      if (notify && deleted) {
        const dmAllowed = await this.app.store.setNx(`quill:am:dm:${guild.id}:${member.id}`, '1', 30);
        if (dmAllowed) {
          await member.user
            .send(
              v2Message(
                renderTemplate(this.app, config, 'automod_dm', {
                  ...vars,
                  action: 'Message removed',
                  case: row.caseNumber,
                }),
              ),
            )
            .catch(() => undefined);
        }
      }
    }

    if (
      notify &&
      deleted &&
      finalAction?.type !== 'ban' &&
      finalAction?.type !== 'kick' &&
      message.channel.isSendable()
    ) {
      const noticeAllowed = await this.app.store.setNx(`quill:am:notice:${guild.id}:${member.id}`, '1', 20);
      if (noticeAllowed) {
        await this.app.moderation.ephemeralNotice(
          message.channel,
          renderTemplate(this.app, config, 'automod_channel', vars),
          member.id,
        );
      }
    }

    await this.app.logs.send(
      guild,
      'automod',
      automodLogCard({
        message,
        member,
        violations: [...active, ...shadow],
        shadow: false,
        deleted,
        action: actionInfo,
        risk: decision
          ? { before: decision.previousScore, after: decision.state.score, added: decision.added }
          : null,
        caseNumber,
        ai: aiNote,
      }),
    );
  }
}
