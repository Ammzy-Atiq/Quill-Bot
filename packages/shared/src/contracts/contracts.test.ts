import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hmacHash, ipPrefix, parseEncryptionKey } from '../crypto.js';
import { signVerificationToken, verifyVerificationToken } from './verification-token.js';

const SECRET = 'test-secret-value-that-is-long-enough';

describe('verification token', () => {
  it('round-trips', () => {
    const { token, payload } = signVerificationToken(
      { guildId: '123456789012345678', userId: '223456789012345678' },
      SECRET,
    );
    const result = verifyVerificationToken(token, SECRET);
    expect(result).toEqual({ ok: true, payload });
  });

  it('rejects a tampered token', () => {
    const { token } = signVerificationToken(
      { guildId: '123456789012345678', userId: '223456789012345678' },
      SECRET,
    );
    const [body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), uid: '1' }),
    ).toString('base64url');
    expect(verifyVerificationToken(`${forged}.${sig}`, SECRET)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired token', () => {
    const { token } = signVerificationToken(
      { guildId: '123456789012345678', userId: '223456789012345678', ttlSeconds: 60, now: 0 },
      SECRET,
    );
    expect(verifyVerificationToken(token, SECRET, 120_000)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('crypto', () => {
  const key = parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'));

  it('encrypts and decrypts secrets', () => {
    const enc = encryptSecret('sk-live-abc', key);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('sk-live-abc');
    expect(decryptSecret(enc, key)).toBe('sk-live-abc');
  });

  it('hashes deterministically with a pepper', () => {
    expect(hmacHash('1.2.3.4', 'pepper')).toBe(hmacHash('1.2.3.4', 'pepper'));
    expect(hmacHash('1.2.3.4', 'pepper')).not.toBe(hmacHash('1.2.3.4', 'other'));
  });

  it('computes network prefixes', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd::/48');
  });
});
