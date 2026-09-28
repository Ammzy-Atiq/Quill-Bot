import type { LinkedAccount } from '@quill/core';
import { ButtonBuilder, ButtonStyle, type ContainerBuilder } from 'discord.js';
import { cid } from '../../framework/custom-id.js';
import { relative, snowflakeDate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';

export const REASON_LABELS: Record<string, string> = {
  alt_of_banned: 'Alt of a banned member',
  alt_of_punished: 'Alt of a recently punished member',
  alt_linked: 'Linked to another account',
  vpn_or_proxy: 'VPN / proxy',
  new_account: 'New Discord account',
  network_signal: 'Banned in partner servers',
  manual_block: 'Blocked by staff',
};

export const METHOD_LABELS: Record<string, string> = {
  oauth: 'Website (Discord login + device check)',
  simple: 'One-click',
  sso: 'QUILL SSO (verified in another server)',
  manual: 'Staff',
};

export type ReviewDecision = 'approve' | 'deny' | 'ban';

const DECISION_LABEL: Record<ReviewDecision, string> = {
  approve: `${E.check} Approved`,
  deny: `${E.cross} Denied`,
  ban: `${E.hammer} Banned`,
};

export const reasonsText = (reasons: readonly string[]) =>
  reasons.map((r) => REASON_LABELS[r] ?? r).join(', ') || 'none';

export function linkedText(linked: readonly LinkedAccount[]): string {
  if (linked.length === 0) return 'none';
  const lines = linked.slice(0, 6).map((l) => {
    const standing = l.bannedHere ? ' · **banned here**' : l.punishedHere ? ' · punished here' : '';
    const network = l.networkBans ? ` · ${l.networkBans} partner ban(s)` : '';
    return `<@${l.userId}> · ${Math.round(l.confidence * 100)}%${standing}${network}`;
  });
  return `${lines.join('\n')}${linked.length > 6 ? `\n…and ${linked.length - 6} more` : ''}`;
}

export function verifiedLogCard(userId: string, method: string, confidence: number, linked: number) {
  return Card.create()
    .header({ title: 'Member verified', emoji: E.verify, level: 3 })
    .lines([
      ['Member', `<@${userId}> · \`${userId}\``],
      ['Method', METHOD_LABELS[method] ?? method],
      [
        'Confidence',
        `${Math.round(confidence * 100)}%${linked ? ` · ${linked} linked account(s) below the threshold` : ''}`,
      ],
    ])
    .build();
}

export interface ReviewData {
  userId: string;
  method: string;
  reasons: readonly string[];
  confidence: number;
  linked: readonly LinkedAccount[];
}

/** Staff review card for a flagged member (buttons until a decision is made). */
export function reviewCard(
  data: ReviewData,
  decision?: { decision: ReviewDecision; by: string; reason?: string },
) {
  const card = Card.create()
    .header({
      title: decision ? 'Verification reviewed' : 'Verification needs review',
      emoji: E.fingerprint,
      subtitle: `<@${data.userId}> · \`${data.userId}\``,
      level: 3,
    })
    .lines([
      ['Why', reasonsText(data.reasons)],
      ['Evasion confidence', `${Math.round(data.confidence * 100)}%`],
      ['Account created', relative(snowflakeDate(data.userId))],
      ['Method', METHOD_LABELS[data.method] ?? data.method],
    ])
    .text(`**Linked accounts**\n${linkedText(data.linked)}`);
  if (decision) {
    card.text(
      `${DECISION_LABEL[decision.decision]} by <@${decision.by}>${decision.reason ? ` — ${decision.reason}` : ''}`,
    );
  } else {
    card.buttons(
      new ButtonBuilder()
        .setCustomId(cid('vr', 'approve', data.userId))
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cid('vr', 'deny', data.userId))
        .setLabel('Deny')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(cid('vr', 'ban', data.userId))
        .setLabel('Ban')
        .setEmoji(E.hammer)
        .setStyle(ButtonStyle.Danger),
    );
  }
  return card
    .footer('Reviews need Manage Server (or a manager role). The member stays unverified until approved.')
    .build();
}

export function blockedLogCard(data: ReviewData, action: string) {
  return Card.create()
    .header({
      title: 'Verification blocked',
      emoji: E.cross,
      subtitle: `<@${data.userId}> · \`${data.userId}\``,
      level: 3,
    })
    .lines([
      ['Why', reasonsText(data.reasons)],
      ['Evasion confidence', `${Math.round(data.confidence * 100)}%`],
      ['Action', action],
    ])
    .text(`**Linked accounts**\n${linkedText(data.linked)}`)
    .build();
}

/** The personal website link shown after pressing Verify (ephemeral). */
export function linkCard(url: string, guildName: string, websiteUrl: string): ContainerBuilder {
  return Card.create()
    .header({ title: 'Verify on the QUILL website', emoji: E.verify, level: 3, subtitle: guildName })
    .text(
      'Log in with Discord, and QUILL checks that this is not an alt of a banned member. This link is **only for you** and expires in **15 minutes**.',
    )
    .buttons(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(url)
        .setLabel('Open verification')
        .setEmoji(E.lock),
    )
    .footer(`No raw IP address is ever stored · ${websiteUrl.replace(/\/$/, '')}/privacy`)
    .build();
}
