import type { Severity } from '../wordlist/types.js';
import { capsRatio, countEmojis } from './text.js';
import type { DetectorContext, MessageInput, RecentMessage, Violation } from './types.js';

const spam = (
  category: string,
  severity: Severity,
  reason: string,
  evidence: string[] = [],
  flags: string[] = [],
) => ({ detector: 'spam', category, severity, reason, evidence, flags }) satisfies Violation;

/** Spam heuristics over the current message and the author's recent history. */
export function detectSpam(input: MessageInput, record: RecentMessage, ctx: DetectorContext): Violation[] {
  const cfg = ctx.config.spam;
  if (!cfg.enabled) return [];
  const now = ctx.now;
  const within = (seconds: number) => ctx.history.filter((m) => m.at >= now - seconds * 1000);
  const out: Violation[] = [];

  const rate = within(cfg.messageRate.windowSeconds).length + 1;
  if (rate > cfg.messageRate.count) {
    out.push(
      spam('rate', 2, 'Sending messages too fast', [`${rate} messages in ${cfg.messageRate.windowSeconds}s`]),
    );
  }

  const hasContent = input.content.trim().length > 0 || input.attachments.length > 0;
  if (hasContent) {
    const dupes = within(cfg.duplicates.windowSeconds).filter((m) => m.hash === record.hash).length + 1;
    if (dupes >= cfg.duplicates.count) {
      out.push(
        spam('duplicate', 2, 'Repeating the same message', [`${dupes}× in ${cfg.duplicates.windowSeconds}s`]),
      );
    }
    const sameContent = within(cfg.crossChannel.windowSeconds).filter((m) => m.hash === record.hash);
    const channels = new Set([...sameContent.map((m) => m.channelId), input.channelId]);
    if (channels.size >= cfg.crossChannel.channels) {
      out.push(
        spam(
          'cross_channel',
          3,
          'Posting the same message in many channels',
          [`${channels.size} channels`],
          ['cross_channel'],
        ),
      );
    }
  }

  const mentions = input.mentions.users + input.mentions.roles;
  if (mentions > cfg.maxMentions) {
    out.push(spam('mentions', 3, 'Mass mentions', [`${mentions} mentions`]));
  }

  const emojis = countEmojis(input.content);
  if (emojis > cfg.maxEmojis) out.push(spam('emojis', 1, 'Too many emojis', [`${emojis} emojis`]));

  if (cfg.caps.enabled) {
    const caps = capsRatio(input.content);
    if (caps.letters >= cfg.caps.minLength && caps.ratio >= cfg.caps.ratio) {
      out.push(spam('caps', 1, 'Excessive caps', [`${Math.round(caps.ratio * 100)}% capitals`]));
    }
  }

  const newlines = (input.content.match(/\n/g) ?? []).length;
  if (newlines > cfg.maxNewlines) out.push(spam('newlines', 1, 'Wall of text', [`${newlines} lines`]));

  if (input.attachments.length > 0) {
    const files =
      within(cfg.attachments.windowSeconds).reduce((sum, m) => sum + m.attachments, 0) +
      input.attachments.length;
    if (files > cfg.attachments.count) {
      out.push(
        spam('attachments', 2, 'Attachment spam', [`${files} files in ${cfg.attachments.windowSeconds}s`]),
      );
    }
  }

  const letters = (input.content.match(/\p{L}/gu) ?? []).length;
  const marks = ctx.normalized.stats.combiningMarks;
  if (marks >= 15 && marks > letters)
    out.push(spam('zalgo', 2, 'Zalgo / glitch text', [`${marks} combining marks`]));

  return out;
}
