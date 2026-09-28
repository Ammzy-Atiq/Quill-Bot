import { builtinWordlist } from '@quill/core';
import { automodRepo } from '@quill/db';
import type { GuildConfig } from '@quill/shared';
import {
  type AutoModerationActionOptions,
  AutoModerationActionType,
  type AutoModerationRule,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  type Guild,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { App } from '../../app.js';
import { type CommandContext, UserError } from '../../framework/types.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { reply } from '../../ui/respond.js';

export const NATIVE_RULE_NAME = 'QUILL GUARD — blocked words';
/** Discord limits for one keyword rule. */
export const MAX_KEYWORDS = 1000;
const MAX_KEYWORD_LENGTH = 60;
const MAX_ALLOW = 100;

/**
 * Keywords mirrored into Discord's own AutoMod: custom words (not regex) plus built-in terms from
 * enabled categories at or above `native.minSeverity`, strongest first. `*term*` = anywhere
 * (substring terms), plain = whole word — the same semantics QUILL uses. Returns the full list so
 * callers can report truncation.
 */
export async function nativeKeywords(app: App, guildId: string, config: GuildConfig): Promise<string[]> {
  const words = config.automod.words;
  const disabled = new Set(words.disabledTermIds);
  const keywords: string[] = [];
  const seen = new Set<string>();
  const add = (term: string, substring: boolean) => {
    const clean = term.trim().toLowerCase();
    if (!clean || clean.length > MAX_KEYWORD_LENGTH - 2) return;
    const keyword = substring ? `*${clean}*` : clean;
    if (seen.has(keyword)) return;
    seen.add(keyword);
    keywords.push(keyword);
  };
  const custom = await automodRepo.listCustomWords(app.db, guildId);
  for (const word of custom) if (word.match !== 'regex') add(word.term, word.match === 'substring');
  const builtin: Array<{ term: string; substring: boolean; severity: number }> = [];
  for (const entry of builtinWordlist()) {
    if (entry.category === 'custom' || disabled.has(entry.id)) continue;
    const category = words.categories[entry.category];
    if (!category.enabled) continue;
    const severity = category.severity ?? entry.severity;
    if (severity >= config.automod.native.minSeverity) {
      builtin.push({ term: entry.term, substring: entry.match === 'substring', severity });
    }
  }
  builtin.sort((a, b) => b.severity - a.severity);
  for (const entry of builtin) add(entry.term, entry.substring);
  return keywords;
}

async function findRule(app: App, guild: Guild, config: GuildConfig): Promise<AutoModerationRule | null> {
  const rules = await guild.autoModerationRules.fetch();
  const byId = config.automod.native.ruleId ? rules.get(config.automod.native.ruleId) : undefined;
  return (
    byId ?? rules.find((r) => r.name === NATIVE_RULE_NAME && r.creatorId === app.client.user?.id) ?? null
  );
}

/** Creates or updates QUILL's Discord AutoMod keyword rule. */
export async function syncNative(app: App, guild: Guild, config: GuildConfig, actorId: string) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserError('QUILL needs **Manage Server** to manage Discord AutoMod rules.');
  }
  const all = await nativeKeywords(app, guild.id, config);
  if (all.length === 0)
    throw new UserError('There are no terms to mirror — enable word categories or add custom words.');
  const keywords = all.slice(0, MAX_KEYWORDS);
  const logChannel = config.logging.channels.automod ?? config.logging.defaultChannelId;
  const actions: AutoModerationActionOptions[] = [
    {
      type: AutoModerationActionType.BlockMessage,
      metadata: { customMessage: config.automod.native.blockMessage },
    },
  ];
  if (logChannel && guild.channels.cache.has(logChannel)) {
    actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: logChannel } });
  }
  const shared = {
    name: NATIVE_RULE_NAME,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerMetadata: {
      keywordFilter: keywords,
      allowList: config.automod.words.allowlist.slice(0, MAX_ALLOW),
    },
    actions,
    enabled: true,
    exemptRoles: config.automod.exempt.roleIds.slice(0, 20),
    exemptChannels: config.automod.exempt.channelIds.slice(0, 50),
    reason: 'QUILL GUARD native AutoMod sync',
  };
  const existing = await findRule(app, guild, config);
  const rule = existing
    ? await existing.edit(shared)
    : await guild.autoModerationRules.create({
        ...shared,
        triggerType: AutoModerationRuleTriggerType.Keyword,
      });
  await app.configs.update(guild.id, actorId, [
    { path: ['automod', 'native', 'ruleId'], value: rule.id },
    { path: ['automod', 'native', 'enabled'], value: true },
  ]);
  return { rule, synced: keywords.length, total: all.length };
}

export async function removeNative(
  app: App,
  guild: Guild,
  config: GuildConfig,
  actorId: string,
): Promise<boolean> {
  const rule = await findRule(app, guild, config).catch(() => null);
  if (rule) await rule.delete('QUILL GUARD native AutoMod sync turned off');
  await app.configs.update(guild.id, actorId, [
    { path: ['automod', 'native', 'ruleId'], value: undefined },
    { path: ['automod', 'native', 'enabled'], value: false },
  ]);
  return Boolean(rule);
}

/** `/automod native action:<sync|status|remove> [min_severity]`. */
export async function handleNative({ app, interaction, guild, config }: CommandContext): Promise<void> {
  const action = interaction.options.getString('action', true);
  const minSeverity = interaction.options.getInteger('min_severity');
  let current = config;
  if (minSeverity !== null) {
    current = await app.configs.set(
      guild.id,
      interaction.user.id,
      ['automod', 'native', 'minSeverity'],
      minSeverity,
    );
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const card = Card.create();

  if (action === 'remove') {
    const removed = await removeNative(app, guild, current, interaction.user.id);
    card
      .header({ title: 'Native AutoMod sync off', emoji: E.automod, level: 3 })
      .text(
        removed
          ? 'QUILL removed its Discord AutoMod rule. QUILL AutoMod keeps working as before.'
          : 'There was no QUILL rule to remove.',
      );
  } else if (action === 'sync') {
    const { rule, synced, total } = await syncNative(app, guild, current, interaction.user.id);
    card
      .header({ title: 'Native AutoMod synced', emoji: E.check, level: 3, subtitle: `Rule: ${rule.name}` })
      .text(
        `Discord now blocks **${synced}** term(s) before messages are posted (severity ≥ ${current.automod.native.minSeverity} + custom words).${
          total > synced
            ? `\n${E.warn} ${total - synced} more matched but Discord allows ${MAX_KEYWORDS} per rule — raise \`min_severity\` to prioritise.`
            : ''
        }\n-# QUILL AutoMod still checks everything else (evasion tricks, spam, scams…). Re-run after changing words.`,
      );
  } else {
    const rule = await findRule(app, guild, current).catch(() => null);
    const count = rule?.triggerMetadata.keywordFilter.length ?? 0;
    const planned = (await nativeKeywords(app, guild.id, current)).length;
    card.header({ title: 'Native AutoMod', emoji: E.automod, level: 3 }).lines([
      ['Sync', status(Boolean(rule) && current.automod.native.enabled)],
      [
        'Rule',
        rule
          ? `${rule.name} · ${rule.enabled ? 'enabled' : 'disabled in Discord'} · ${count} keyword(s)`
          : 'not created',
      ],
      ['Minimum severity', String(current.automod.native.minSeverity)],
      ['Would sync', `${Math.min(planned, MAX_KEYWORDS)} of ${planned} term(s)`],
    ]);
  }
  await reply(interaction, card.build(), { ephemeral: true });
}
