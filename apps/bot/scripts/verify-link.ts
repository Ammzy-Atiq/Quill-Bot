/**
 * Dev helper for the website: prints a verification link exactly like the bot's "Verify" button
 * (the button itself ships with the bot-side verification module). Reads VERIFY_TOKEN_SECRET and
 * WEBSITE_URL from the environment or the repo-root .env.
 *
 *   pnpm verify:link <guildId> <userId> [ttlMinutes]
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signVerificationToken } from '@quill/shared/contracts';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [guildId, userId, ttlMinutes] = process.argv.slice(2);
const snowflake = /^\d{17,20}$/;
if (!guildId || !userId || !snowflake.test(guildId) || !snowflake.test(userId)) {
  console.error('Usage: pnpm verify:link <guildId> <userId> [ttlMinutes]');
  process.exit(1);
}
const secret = process.env.VERIFY_TOKEN_SECRET;
if (!secret || secret.length < 32) {
  console.error('VERIFY_TOKEN_SECRET (at least 32 characters) is not set.');
  process.exit(1);
}
const base = (process.env.WEBSITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const { token, payload } = signVerificationToken(
  { guildId, userId, ttlSeconds: ttlMinutes ? Number(ttlMinutes) * 60 : undefined },
  secret,
);
console.log(`${base}/verify/${token}`);
console.log(`expires ${new Date(payload.exp * 1000).toISOString()} · nonce ${payload.n}`);
