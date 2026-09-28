/**
 * Shard entrypoint. Spawned by the ShardingManager (src/index.ts) in production,
 * or run directly for development (`pnpm dev:bot`) as a single shard.
 *
 * `--dry-run` validates env, modules, command JSON and component ids without
 * connecting to Discord, Postgres or Redis.
 */
import { createDb } from '@quill/db';
import { App } from './app.js';
import { loadEnv } from './env.js';
import { Registry } from './framework/registry.js';
import { migrate } from './lib/migrations.js';
import { MemoryStore, RedisStore } from './lib/store.js';
import { createLogger } from './logger.js';
import { MODULES } from './modules/index.js';

const dryRun = process.argv.includes('--dry-run');
const spawnedByManager = process.env.SHARDING_MANAGER === 'true';

async function main() {
  const env = loadEnv({ dryRun });
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development', {
    shard: process.env.SHARDS ?? '0',
  });

  if (dryRun) {
    const registry = new Registry(MODULES);
    const commands = registry.commandJson();
    const names = commands.map((c) => `/${c.name}`).join(' ');
    logger.info(
      { commands: commands.length, components: registry.components.size, events: registry.events.length },
      `dry run OK — ${names}`,
    );
    return;
  }

  if (!spawnedByManager && env.AUTO_MIGRATE) {
    await migrate(env.DATABASE_URL);
    logger.info('database migrations applied');
  }

  const dbHandle = createDb(env.DATABASE_URL, { max: env.DB_POOL_MAX, applicationName: 'quill-shard' });
  const store = env.REDIS_URL
    ? RedisStore.connect(env.REDIS_URL, (err) => logger.error({ err }, 'redis error'))
    : new MemoryStore();
  if (!env.REDIS_URL) {
    if (spawnedByManager) throw new Error('REDIS_URL is required when running multiple shards.');
    logger.warn('REDIS_URL not set — using the in-memory store (single process only, not for production)');
  }

  const app = new App(env, logger, dbHandle.db, store, MODULES);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'received shutdown signal');
    await app.shutdown().catch(() => undefined);
    await dbHandle.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));

  await app.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
