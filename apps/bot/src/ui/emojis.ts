/**
 * Emoji set used across every QUILL message. Unicode by default so the bot works
 * out of the box; swap values for application emoji strings (`<:name:id>`) to use
 * branded icons — nothing else needs to change.
 */
export const E = {
  quill: '🪶',
  shield: '🛡️',
  automod: '🧹',
  verify: '✅',
  antinuke: '⚡',
  antiraid: '🚧',
  risk: '📈',
  logs: '📜',
  gear: '⚙️',
  key: '🔑',
  lock: '🔒',
  unlock: '🔓',
  siren: '🚨',
  check: '✅',
  cross: '❌',
  warn: '⚠️',
  info: 'ℹ️',
  on: '🟢',
  off: '⚫',
  shadow: '👁️',
  user: '👤',
  bot: '🤖',
  crown: '👑',
  star: '⭐',
  clock: '⏱️',
  hammer: '🔨',
  boot: '👢',
  mute: '🔇',
  trash: '🗑️',
  link: '🔗',
  brain: '🧠',
  fingerprint: '🧬',
  backup: '💾',
  scroll: '📜',
  chart: '📊',
  sparkles: '✨',
  bolt: '⚡',
  target: '🎯',
  arrowRight: '➜',
  dot: '•',
} as const;

export type EmojiKey = keyof typeof E;

/** Status dot for boolean settings. */
export const status = (on: boolean) => (on ? `${E.on} On` : `${E.off} Off`);
