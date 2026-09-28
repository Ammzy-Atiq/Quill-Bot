import type { Database } from '@quill/db';
import { QUEUES } from '@quill/shared';
import { type Job, Worker } from 'bullmq';
import type { REST } from 'discord.js';
import type { Redis } from 'ioredis';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { runRetention } from './retention.js';

export interface WorkerContext {
  env: Env;
  logger: Logger;
  db: Database;
  rest: REST;
  connection: Redis;
}

/** Registers a BullMQ worker per queue. Job handlers live next to this file. */
export function registerJobs(ctx: WorkerContext): Worker[] {
  const maintenance = new Worker(
    QUEUES.maintenance,
    async (job: Job) => {
      if (job.name === 'retention') return runRetention(ctx);
      ctx.logger.warn({ job: job.name }, 'unknown maintenance job');
      return null;
    },
    { connection: ctx.connection, concurrency: 1 },
  );

  for (const worker of [maintenance]) {
    worker.on('failed', (job, err) => ctx.logger.error({ err, job: job?.name, id: job?.id }, 'job failed'));
  }
  return [maintenance];
}
