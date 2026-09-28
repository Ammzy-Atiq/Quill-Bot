/**
 * Background worker (REST only, no gateway): snapshot restores, member pulls,
 * OAuth token refresh and retention cleanup. Jobs arrive through BullMQ queues
 * (see QUEUES in @quill/shared). Run as many workers as you like.
 */
import { createDb } from '@quill/db';
import { QUEUES } from '@quill/shared';
import { Queue, type Worker } from 'bullmq';
import { REST } from 'discord.js';
import { Redis } from 'ioredis';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { registerJobs } from './worker/jobs.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development', { role: 'worker' });
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required for the worker.');

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const dbHandle = createDb(env.DATABASE_URL, { max: env.DB_POOL_MAX, applicationName: 'quill-worker' });
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  const workers = registerJobs({ env, logger, db: dbHandle.db, rest, connection });

  // Repeatable maintenance (retention cleanup etc.)
  const maintenance = new Queue(QUEUES.maintenance, { connection });
  await maintenance.upsertJobScheduler(
    'daily-retention',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'retention' },
  );

  logger.info({ queues: workers.map((w: Worker) => w.name) }, 'worker ready');

  const shutdown = async () => {
    await Promise.all(workers.map((w: Worker) => w.close()));
    await maintenance.close();
    await dbHandle.close();
    connection.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
