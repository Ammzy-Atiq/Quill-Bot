/**
 * Production entrypoint: applies migrations once, then spawns shards (one process each).
 * Shards find each other through Redis; all guild state lives in Postgres/Redis, so this
 * can later be swapped for clustered sharding without touching modules.
 */
import { fileURLToPath } from 'node:url';
import { ShardingManager } from 'discord.js';
import { loadEnv } from './env.js';
import { migrate } from './lib/migrations.js';
import { createLogger } from './logger.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development', { role: 'manager' });

  if (!env.REDIS_URL) throw new Error('REDIS_URL is required for the sharded production entrypoint.');
  if (env.AUTO_MIGRATE) {
    await migrate(env.DATABASE_URL);
    logger.info('database migrations applied');
  }

  const shardFile = fileURLToPath(new URL('./shard.js', import.meta.url));
  const manager = new ShardingManager(shardFile, {
    token: env.DISCORD_TOKEN,
    totalShards: env.SHARD_COUNT,
    respawn: true,
    mode: 'process',
  });
  manager.on('shardCreate', (shard) => {
    logger.info({ shard: shard.id }, 'shard launched');
    shard.on('death', () => logger.warn({ shard: shard.id }, 'shard process died (respawning)'));
  });
  await manager.spawn({ timeout: 120_000 });
  logger.info({ shards: manager.shards.size }, 'all shards spawned');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
