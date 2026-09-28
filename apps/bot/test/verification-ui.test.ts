import { DEFAULT_GUILD_CONFIG } from '@quill/shared';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import {
  blockedLogCard,
  linkCard,
  type ReviewData,
  reviewCard,
  verifiedLogCard,
} from '../src/modules/verification/cards.js';
import { verificationSummary } from '../src/modules/verification/command.js';
import { assertV2 } from '../src/ui/limits.js';

const app = {
  logo: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  env: { WEBSITE_URL: 'https://quill.example' },
} as unknown as App;

const worst: ReviewData = {
  userId: '200000000000000001',
  method: 'oauth',
  reasons: [
    'alt_of_banned',
    'alt_of_punished',
    'network_signal',
    'vpn_or_proxy',
    'new_account',
    'x'.repeat(200),
  ],
  confidence: 0.97,
  linked: Array.from({ length: 40 }, (_, i) => ({
    userId: String(300000000000000000n + BigInt(i)),
    confidence: 0.99,
    bannedHere: i % 2 === 0,
    punishedHere: true,
    networkBans: 12,
  })),
};

describe('Verification UI stays within Components V2 limits', () => {
  it('review card: open, decided, blocked', () => {
    const open = reviewCard(worst);
    assertV2([open]);
    expect(JSON.stringify(open.toJSON())).toContain('qg:vr:approve:200000000000000001');
    const decided = reviewCard(worst, { decision: 'ban', by: '100000000000000001', reason: 'r'.repeat(300) });
    assertV2([decided]);
    expect(JSON.stringify(decided.toJSON())).not.toContain('custom_id');
    assertV2([blockedLogCard(worst, 'Banned')]);
    assertV2([verifiedLogCard(worst.userId, 'sso', 1, 3)]);
  });

  it('verification link is a link button, never a custom id', () => {
    const card = linkCard('https://quill.example/verify/abc.def', 'Test Server', 'https://quill.example/');
    assertV2([card]);
    const json = JSON.stringify(card.toJSON());
    expect(json).toContain('https://quill.example/verify/abc.def');
    expect(json).not.toContain('custom_id');
  });

  it('settings summary', () => {
    assertV2([verificationSummary(app, DEFAULT_GUILD_CONFIG)]);
  });
});
