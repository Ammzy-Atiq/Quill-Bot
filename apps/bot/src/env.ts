import { SNOWFLAKE_REGEX } from '@quill/shared';
import { z } from 'zod';

const snowflake = z.string().regex(SNOWFLAKE_REGEX);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DISCORD_TOKEN: z.string().min(20, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: snowflake,
  /** Needed by the worker to refresh OAuth tokens for member backups. */
  DISCORD_CLIENT_SECRET: z.string().optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
  /** Apply pending database migrations on startup (manager process, or single-process dev). */
  AUTO_MIGRATE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Optional in development (in-memory fallback, single process only). Required for sharding/worker. */
  REDIS_URL: z.string().optional(),

  /** 32 random bytes, base64 (openssl rand -base64 32). Encrypts OAuth tokens and BYOK AI keys. */
  ENCRYPTION_KEY: z.string().min(40, 'ENCRYPTION_KEY must be 32 bytes base64'),
  /** HMAC secret shared with the website for verification links. */
  VERIFY_TOKEN_SECRET: z.string().min(32, 'VERIFY_TOKEN_SECRET must be at least 32 characters'),
  /** Public website base URL (verification pages, dashboard, privacy policy). */
  WEBSITE_URL: z.url().default('http://localhost:3000'),
  /** Public URL of the logo (PNG/WebP) used as thumbnail; defaults to the bot avatar. */
  BRAND_LOGO_URL: z.url().optional(),
  SUPPORT_SERVER_URL: z.url().optional(),

  /** Register slash commands to this guild when running `commands:deploy --dev`. */
  DEV_GUILD_ID: snowflake.optional(),
  /** `auto` or a number of shards. */
  SHARD_COUNT: z.union([z.literal('auto'), z.coerce.number().int().min(1)]).default('auto'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Placeholder values used by `--dry-run` so the boot check works without secrets. */
const DRY_RUN_DEFAULTS: Record<string, string> = {
  DISCORD_TOKEN: 'dry-run-token-placeholder-value',
  DISCORD_CLIENT_ID: '100000000000000000',
  DATABASE_URL: 'postgres://dry-run',
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  VERIFY_TOKEN_SECRET: 'dry-run-secret-dry-run-secret-dry-run',
};

export function loadEnv(options: { dryRun?: boolean; source?: NodeJS.ProcessEnv } = {}): Env {
  const source = { ...(options.dryRun ? DRY_RUN_DEFAULTS : {}), ...(options.source ?? process.env) };
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example for every variable.`);
  }
  return parsed.data;
}
