import { z } from 'zod';
import { hmacSign, randomToken, safeEqual } from '../crypto.js';

/**
 * Verification link token (bot → website).
 *
 * The bot creates it when a member presses "Verify" and sends them
 * `${WEBSITE_URL}/verify/${token}`. The website verifies it with the same
 * VERIFY_TOKEN_SECRET, and the Discord OAuth `identify` result MUST match `uid`.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256(payloadPart, secret))>`
 */
export const VerificationTokenPayloadSchema = z.object({
  /** Token format version. */
  v: z.literal(1),
  /** Guild ID being verified for. */
  gid: z.string(),
  /** Discord user ID that pressed the button. */
  uid: z.string(),
  /** Random nonce; also used as the verification session id seed. */
  n: z.string(),
  /** Expiry, unix seconds. */
  exp: z.number().int(),
});
export type VerificationTokenPayload = z.infer<typeof VerificationTokenPayloadSchema>;

export const VERIFICATION_TOKEN_TTL_SECONDS = 15 * 60;

export function signVerificationToken(
  input: { guildId: string; userId: string; ttlSeconds?: number; now?: number },
  secret: string,
): { token: string; payload: VerificationTokenPayload } {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: VerificationTokenPayload = {
    v: 1,
    gid: input.guildId,
    uid: input.userId,
    n: randomToken(12),
    exp: now + (input.ttlSeconds ?? VERIFICATION_TOKEN_TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${body}.${hmacSign(body, secret)}`, payload };
}

export type VerifyTokenResult =
  | { ok: true; payload: VerificationTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyVerificationToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): VerifyTokenResult {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return { ok: false, reason: 'malformed' };
  if (!safeEqual(signature, hmacSign(body, secret))) return { ok: false, reason: 'bad_signature' };
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const parsed = VerificationTokenPayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  if (parsed.data.exp * 1000 < nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, payload: parsed.data };
}
