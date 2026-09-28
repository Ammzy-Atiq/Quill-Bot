import { type MemberPullJob, QUEUES } from '@quill/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { UserError } from '../framework/types.js';

/** BullMQ producers for work that runs in the worker process (REST only). Created lazily. */
export class JobQueues {
  private connection: Redis | null = null;
  private memberPull: Queue | null = null;

  constructor(private readonly redisUrl: string | undefined) {}

  get available(): boolean {
    return Boolean(this.redisUrl);
  }

  async enqueueMemberPull(data: MemberPullJob): Promise<void> {
    if (!this.redisUrl) {
      throw new UserError(
        'Member pulls need Redis and the QUILL worker process (set REDIS_URL, run dist/worker.js).',
      );
    }
    this.connection ??= new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.memberPull ??= new Queue(QUEUES.memberPull, { connection: this.connection });
    await this.memberPull.add('pull', data, {
      jobId: `pull-${data.jobId}`,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }

  async close(): Promise<void> {
    await this.memberPull?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
