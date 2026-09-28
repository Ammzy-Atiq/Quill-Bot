import type { Database } from '@quill/db';
import { MemberPullJob, QUEUES } from '@quill/shared';
import { type Job, Worker } from 'bullmq';
import type { REST } from 'discord.js';
import type { Redis } from 'ioredis';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { runMemberPull } from './member-pull.js';
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

  // One pull at a time per worker: each pull is bound by Discord's per-guild rate limits anyway.
  const memberPull = new Worker(
    QUEUES.memberPull,
    async (job: Job) => runMemberPull(ctx, MemberPullJob.parse(job.data)),
    { connection: ctx.connection, concurrency: 1 },
  );

  const workers = [maintenance, memberPull];
  for (const worker of workers) {
    worker.on('failed', (job, err) => ctx.logger.error({ err, job: job?.name, id: job?.id }, 'job failed'));
  }
  return workers;
}
