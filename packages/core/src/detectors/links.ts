import { extractInviteCodes, extractMaskedLinks, extractUrls, type FoundUrl, hostMatches } from './text.js';
import type { DetectorContext, MessageInput, Violation } from './types.js';

const DOMAIN_LIKE_RE = /(?:[a-z0-9-]+\.)+[a-z]{2,24}/i;

export const isInviteUrl = (u: FoundUrl) =>
  u.host === 'discord.gg' ||
  ((u.host === 'discord.com' || u.host === 'discordapp.com') && u.path.startsWith('/invite/'));

/** Links & advertising: Discord invites, domain allow/block lists, masked links. */
export function detectLinks(
  input: MessageInput,
  urls: readonly FoundUrl[],
  ctx: DetectorContext,
): Violation[] {
  const cfg = ctx.config.links;
  if (!cfg.enabled) return [];
  const out: Violation[] = [];
  const text = [input.content, ...input.extraText].join('\n');

  if (cfg.invites.block) {
    const foreign = extractInviteCodes(text).filter((code) => {
      const guildId = input.inviteGuilds[code];
      if (guildId === undefined || guildId === null) return true; // unknown/unresolved → treat as foreign
      if (cfg.invites.allowOwnServer && guildId === input.guildId) return false;
      return !cfg.invites.allowedGuildIds.includes(guildId);
    });
    if (foreign.length > 0) {
      out.push({
        detector: 'links',
        category: 'invite',
        severity: 2,
        reason: 'Server invite / advertising',
        evidence: foreign.map((c) => `discord.gg/${c}`),
        flags: [],
      });
    }
  }

  if (cfg.mode !== 'off' && urls.length > 0) {
    const listed = (host: string) => cfg.domains.some((d) => hostMatches(host, d));
    const blocked = urls.filter((u) => (cfg.mode === 'allowlist' ? !listed(u.host) : listed(u.host)));
    // Discord invite links are handled by the invite rule above.
    const relevant = blocked.filter((u) => !isInviteUrl(u));
    if (relevant.length > 0) {
      out.push({
        detector: 'links',
        category: 'domain',
        severity: 2,
        reason: 'Link not allowed here',
        evidence: [...new Set(relevant.map((u) => u.host))],
        flags: [],
      });
    }
  }

  if (cfg.maskedLinks) {
    for (const link of extractMaskedLinks(input.content)) {
      const shown = link.text
        .match(DOMAIN_LIKE_RE)?.[0]
        ?.toLowerCase()
        .replace(/^www\./, '');
      if (!shown) continue;
      const target = extractUrls(link.url)[0];
      if (target && !hostMatches(target.host, shown) && !hostMatches(shown, target.host)) {
        out.push({
          detector: 'links',
          category: 'masked',
          severity: 3,
          reason: 'Disguised link',
          evidence: [`${shown} → ${target.host}`],
          flags: ['masked'],
        });
        break;
      }
    }
  }
  return out;
}
