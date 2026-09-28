import { type AutomodConfig, DEFAULT_GUILD_CONFIG, setAtPath } from '@quill/shared/config';
import { describe, expect, it } from 'vitest';
import { SEED_SCAM_DOMAINS } from '../data/scam.js';
import { builtinWordlist } from '../data/wordlists/index.js';
import { WordMatcher } from '../matcher/word-matcher.js';
import { normalize } from '../normalizer/normalize.js';
import { runDetectors } from './pipeline.js';
import { compilePolicy } from './policies.js';
import { classifyDomain } from './scam.js';
import { extractInviteCodes, extractUrls } from './text.js';
import type { CompiledPolicy, DetectorContext, MessageInput, RecentMessage } from './types.js';

const builtin = new WordMatcher(builtinWordlist());
const NOW = Date.UTC(2026, 5, 1, 12);
const GUILD = '100000000000000001';

function input(content: string, extra: Partial<MessageInput> = {}): MessageInput {
  return {
    guildId: GUILD,
    channelId: '300000000000000001',
    authorId: '200000000000000001',
    content,
    extraText: [],
    createdAt: NOW,
    mentions: { users: 0, roles: 0, everyone: false },
    targetUserIds: [],
    attachments: [],
    accountCreatedAt: Date.UTC(2020, 0, 1),
    canMentionEveryone: false,
    inviteGuilds: {},
    ...extra,
  };
}

function run(
  content: string,
  opts: {
    input?: Partial<MessageInput>;
    config?: (c: AutomodConfig) => AutomodConfig;
    history?: RecentMessage[];
    policies?: CompiledPolicy[];
  } = {},
) {
  const config = opts.config ? opts.config(DEFAULT_GUILD_CONFIG.automod) : DEFAULT_GUILD_CONFIG.automod;
  const ctx: DetectorContext = {
    config,
    normalized: normalize(content),
    builtin,
    custom: null,
    history: opts.history ?? [],
    now: NOW,
    scam: { domains: new Set(SEED_SCAM_DOMAINS), imageHashes: ['ffffffff00000000'] },
    policies: opts.policies ?? [],
    memberRoleIds: [],
  };
  return runDetectors(input(content, opts.input), ctx);
}

const categories = (content: string, opts: Parameters<typeof run>[1] = {}) =>
  run(content, opts).violations.map((v) => `${v.detector}:${v.category}`);

describe('text helpers', () => {
  it('extracts urls, bare domains and keeps unicode hosts', () => {
    expect(extractUrls('see https://example.com/a and discord.gg/abc').map((u) => u.host)).toEqual([
      'example.com',
      'discord.gg',
    ]);
    expect(extractUrls('go to https://dіscord.com/login')[0]?.host).toBe('dіscord.com');
    expect(extractUrls('https://discord.com@evil.xyz/login')[0]?.host).toBe('evil.xyz');
    expect(extractUrls('version 1.2.3 and file.txt')).toEqual([]);
  });

  it('finds obfuscated invites', () => {
    expect(extractInviteCodes('join discord . gg / abc123')).toEqual(['abc123']);
    expect(extractInviteCodes('discord(.)gg/xyz and discord.com/invite/qqq')).toEqual(['qqq', 'xyz']);
    expect(extractInviteCodes('ｄｉｓｃｏｒｄ．ｇｇ/full')).toEqual(['full']);
  });
});

describe('classifyDomain', () => {
  const known = new Set(SEED_SCAM_DOMAINS);
  it.each([
    ['discord.com', null],
    ['cdn.discordapp.com', null],
    ['discord.js.org', null],
    ['steamgifts.com', null],
    ['dlscord.com', 5],
    ['steamcommunlty.com', 5],
    ['dіscord.com', 5],
    ['discord-nitro-gift.xyz', 4],
    ['free-nitro-discord.ru', 4],
    ['steamcornmunity.com', 5],
    ['robiox.com', 4],
    ['paypa1.com', 5],
    ['disc0rd-gift.com', 4],
    ['stream.com', null],
    ['disco.com', null],
  ])('%s', (host, severity) => {
    expect(classifyDomain(host, known)?.severity ?? null).toBe(severity);
  });
});

describe('scam detector', () => {
  it('flags free nitro with a link', () => {
    expect(categories('FREE NITRO for everyone!! https://nitro-drop.xyz/claim')).toContain('scam:scam');
  });

  it('ignores free nitro talk without a link', () => {
    expect(categories('lol who would believe free nitro messages')).not.toContain('scam:scam');
  });

  it('flags the MrBeast/Elon crypto giveaway even without a link', () => {
    expect(categories('MrBeast is doing a crypto giveaway, use promo code BEAST for 0.3 BTC')).toContain(
      'scam:scam',
    );
    expect(categories('Elon Musk giveaway: withdraw with promo code ELON2026')).toContain('scam:scam');
  });

  it('flags the "I accidentally reported you" scam', () => {
    expect(categories('hey sorry i accidentally reported your account, contact this staff')).toContain(
      'scam:scam',
    );
  });

  it('matches known scam images by perceptual hash', () => {
    const r = run('look at this', {
      input: {
        attachments: [
          { name: 'a.png', contentType: 'image/png', size: 1, url: 'x', imageHash: 'fffffff100000000' },
        ],
      },
    });
    expect(r.violations.find((v) => v.detector === 'scam')?.reason).toBe('Known scam image');
  });

  it('detects compromised accounts blasting links across channels', () => {
    const content = 'check this out https://example-shop.com/deal';
    const first = run(content);
    const history = [
      { ...first.record, channelId: '300000000000000002', at: NOW - 5_000 },
      { ...first.record, channelId: '300000000000000003', at: NOW - 3_000 },
    ];
    const r = run(content, { history });
    const scam = r.violations.find((v) => v.detector === 'scam');
    expect(scam?.flags).toContain('compromised');
    expect(scam?.severity).toBe(5);
  });

  it('flags @everyone + link from members without permission', () => {
    const r = run('@everyone free stuff https://example-shop.com', {
      input: { mentions: { users: 0, roles: 0, everyone: true }, accountCreatedAt: NOW - 86_400_000 },
    });
    expect(r.violations.find((v) => v.detector === 'scam')?.severity).toBe(5);
  });
});

describe('links detector', () => {
  const enable = (c: AutomodConfig) => setAtPath(c, ['links', 'enabled'], true) as AutomodConfig;

  it('blocks foreign invites but allows the own server', () => {
    expect(
      categories('join discord.gg/other', {
        config: enable,
        input: { inviteGuilds: { other: '999999999999999999' } },
      }),
    ).toContain('links:invite');
    expect(
      categories('join discord.gg/mine', { config: enable, input: { inviteGuilds: { mine: GUILD } } }),
    ).not.toContain('links:invite');
  });

  it('applies allowlist mode', () => {
    const cfg = (c: AutomodConfig) =>
      setAtPath(
        setAtPath(enable(c), ['links', 'mode'], 'allowlist'),
        ['links', 'domains'],
        ['youtube.com'],
      ) as AutomodConfig;
    expect(categories('https://youtube.com/watch?v=1', { config: cfg })).not.toContain('links:domain');
    expect(categories('https://random.site/page', { config: cfg })).toContain('links:domain');
  });

  it('catches masked links', () => {
    expect(
      categories('[https://discord.com/gift](https://evil.example/steal)', { config: enable }),
    ).toContain('links:masked');
  });
});

describe('spam detector', () => {
  const record = (extra: Partial<RecentMessage>): RecentMessage => ({
    at: NOW - 1000,
    channelId: '300000000000000001',
    hash: 'x',
    links: 0,
    attachments: 0,
    targets: [],
    hostile: false,
    ...extra,
  });

  it('detects message floods and duplicates', () => {
    const history = Array.from({ length: 7 }, (_, i) => record({ at: NOW - i * 500, hash: `h${i}` }));
    expect(categories('hi', { history })).toContain('spam:rate');
    const dupHash = run('buy now').record.hash;
    expect(
      categories('buy now', { history: [record({ hash: dupHash }), record({ hash: dupHash })] }),
    ).toContain('spam:duplicate');
  });

  it('detects mass mentions, caps and zalgo', () => {
    expect(categories('hi', { input: { mentions: { users: 9, roles: 0, everyone: false } } })).toContain(
      'spam:mentions',
    );
    expect(categories('WHY IS EVERYONE IGNORING MY QUESTION ABOUT THE SERVER')).toContain('spam:caps');
    expect(categories('h̸̢̧̛̛̙̙̖̗̘̙̜̝̞̟̠̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼e̵̢̧̨̛̛̛̖̗̘̙̜̝̞̟̠̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼y')).toContain('spam:zalgo');
  });
});

describe('harassment detector', () => {
  it('raises severity for insults aimed at someone', () => {
    const r = run('you are a worthless piece of shit', { input: { targetUserIds: ['400000000000000001'] } });
    const h = r.violations.find((v) => v.detector === 'harassment');
    expect(h?.category).toBe('targeted');
    expect(h?.severity).toBeGreaterThanOrEqual(3);
  });

  it('detects doxxing', () => {
    expect(categories('his ip is 84.23.119.4 go get him')).toContain('harassment:dox');
    expect(categories('the server ip is 127.0.0.1')).not.toContain('harassment:dox');
    expect(categories('our minecraft server ip is 84.23.119.4 join us')).not.toContain('harassment:dox');
  });
});

describe('custom policies', () => {
  it('evaluates keyword and attachment policies', () => {
    const policies = [
      compilePolicy(1, 'no-crypto', {
        trigger: { type: 'keywords', keywords: ['shitcoin'], match: 'boundary' },
        severity: 2,
        reason: 'No crypto shilling',
        deleteMessage: true,
        action: null,
        channelIds: [],
        exemptRoleIds: [],
      }),
      compilePolicy(2, 'no-exe', {
        trigger: { type: 'attachments', extensions: ['exe', 'scr'] },
        severity: 4,
        reason: 'Executable files are not allowed',
        deleteMessage: true,
        action: { type: 'timeout', durationSeconds: 3600 },
        channelIds: [],
        exemptRoleIds: [],
      }),
    ];
    const r = run('buy this sh1tc0in now', {
      policies,
      input: { attachments: [{ name: 'free.exe', contentType: null, size: 1, url: 'x' }] },
    });
    expect(r.violations.filter((v) => v.detector === 'policy').map((v) => v.policyId)).toEqual([1, 2]);
  });
});

describe('pipeline', () => {
  it('leaves normal chat alone', () => {
    const r = run('good morning everyone, the event starts at 5pm https://youtube.com/watch?v=abc');
    expect(r.violations).toEqual([]);
  });

  it('respects detector exemptions', () => {
    const cfg = (c: AutomodConfig) =>
      setAtPath(c, ['words', 'exemptChannelIds'], ['300000000000000001']) as AutomodConfig;
    expect(categories('kill yourself', { config: cfg })).not.toContain('words:self_harm');
  });
});
