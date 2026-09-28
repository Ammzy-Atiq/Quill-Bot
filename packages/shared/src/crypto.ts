import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secrets (OAuth tokens, BYOK AI keys) are encrypted with AES-256-GCM.
 * Payload format: `v1.<iv>.<authTag>.<ciphertext>` — each part base64url.
 * The key is 32 random bytes, provided base64-encoded via ENCRYPTION_KEY.
 */
const VERSION = 'v1';

export function parseEncryptionKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64 (generate: openssl rand -base64 32)');
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('Unsupported or malformed encrypted payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Keyed one-way hash used for IP addresses and device fingerprints.
 * Raw IPs are NEVER stored — only `hmacHash(ip, HASH_PEPPER)`.
 */
export function hmacHash(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

export function hmacSign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Masks a secret for display: `sk-a…9xQ2`. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/**
 * Coarse IP prefix used for "same network" matching: /24 for IPv4, /48 for IPv6.
 * The prefix itself is hashed before storage.
 */
export function ipPrefix(ip: string): string {
  if (ip.includes(':')) {
    const parts = expandIpv6(ip).split(':');
    return `${parts.slice(0, 3).join(':')}::/48`;
  }
  const octets = ip.split('.');
  return `${octets.slice(0, 3).join('.')}.0/24`;
}

function expandIpv6(ip: string): string {
  const [head = '', tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const full = [...headParts, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailParts];
  return full.map((p) => p.padStart(4, '0').toLowerCase()).join(':');
}
