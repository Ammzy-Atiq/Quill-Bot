import { Redis } from 'ioredis';

/**
 * Fast shared state for rate windows, risk scores, locks and pub/sub.
 * Production uses Redis (shared by all shards + worker + website).
 * Development/tests may use the in-memory implementation (single process only).
 */
export interface KeyValueStore {
  readonly kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Set only if missing. Returns true when the key was set (use for locks / dedupe). */
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  /**
   * Adds an event at `nowMs` to a rolling window and returns how many events are
   * inside the last `windowMs` (including this one).
   */
  hit(key: string, nowMs: number, windowMs: number, member?: string): Promise<number>;
  /** Returns event timestamps currently inside the window (oldest first). */
  windowEntries(key: string, nowMs: number, windowMs: number): Promise<Array<{ member: string; at: number }>>;
  /** Push to a capped list (newest last) with a TTL. */
  pushCapped(key: string, value: string, maxLength: number, ttlSeconds: number): Promise<void>;
  list(key: string): Promise<string[]>;
  /** Scheduling (sorted set): add or move `member` to fire at `atMs`. */
  scheduleAdd(key: string, member: string, atMs: number): Promise<void>;
  /** Members due at or before `nowMs`, oldest first (they stay until `scheduleRemove`). */
  scheduleDue(key: string, nowMs: number, limit: number): Promise<string[]>;
  scheduleRemove(key: string, member: string): Promise<void>;
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, handler: (message: unknown) => void): Promise<void>;
  close(): Promise<void>;
}

const HIT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return redis.call('ZCARD', KEYS[1])
`;

let memberSeq = 0;
const uniqueMember = (nowMs: number) => `${nowMs}-${process.pid}-${++memberSeq}`;

export class RedisStore implements KeyValueStore {
  readonly kind = 'redis' as const;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, Set<(message: unknown) => void>>();

  constructor(
    readonly redis: Redis,
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    this.subscriber = redis.duplicate();
    this.subscriber.on('message', (channel: string, raw: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        this.onError(error);
        return;
      }
      for (const handler of set) {
        try {
          handler(parsed);
        } catch (error) {
          this.onError(error);
        }
      }
    });
    redis.defineCommand('quillHit', { numberOfKeys: 1, lua: HIT_SCRIPT });
  }

  static connect(url: string, onError?: (error: unknown) => void): RedisStore {
    const redis = new Redis(url, { maxRetriesPerRequest: 3, enableAutoPipelining: true, lazyConnect: false });
    if (onError) redis.on('error', onError);
    return new RedisStore(redis, onError);
  }

  async get(key: string) {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) await this.redis.set(key, value, 'EX', Math.max(1, Math.ceil(ttlSeconds)));
    else await this.redis.set(key, value);
  }

  async setNx(key: string, value: string, ttlSeconds: number) {
    const result = await this.redis.set(key, value, 'EX', Math.max(1, Math.ceil(ttlSeconds)), 'NX');
    return result === 'OK';
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async incr(key: string, ttlSeconds: number) {
    const [[, value]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, Math.max(1, Math.ceil(ttlSeconds)))
      .exec()) as [[Error | null, number]];
    return value;
  }

  async hit(key: string, nowMs: number, windowMs: number, member?: string) {
    const redis = this.redis as Redis & {
      quillHit: (key: string, now: number, window: number, member: string) => Promise<number>;
    };
    return redis.quillHit(
      key,
      nowMs,
      windowMs,
      member ? `${member}|${uniqueMember(nowMs)}` : uniqueMember(nowMs),
    );
  }

  async windowEntries(key: string, nowMs: number, windowMs: number) {
    const raw = await this.redis.zrangebyscore(key, nowMs - windowMs, '+inf', 'WITHSCORES');
    const out: Array<{ member: string; at: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i]!;
      out.push({
        member: member.includes('|') ? member.slice(0, member.lastIndexOf('|')) : member,
        at: Number(raw[i + 1]),
      });
    }
    return out;
  }

  async pushCapped(key: string, value: string, maxLength: number, ttlSeconds: number) {
    await this.redis
      .multi()
      .rpush(key, value)
      .ltrim(key, -maxLength, -1)
      .expire(key, Math.max(1, Math.ceil(ttlSeconds)))
      .exec();
  }

  async list(key: string) {
    return this.redis.lrange(key, 0, -1);
  }

  async scheduleAdd(key: string, member: string, atMs: number) {
    await this.redis.zadd(key, atMs, member);
  }

  async scheduleDue(key: string, nowMs: number, limit: number) {
    return this.redis.zrangebyscore(key, '-inf', nowMs, 'LIMIT', 0, limit);
  }

  async scheduleRemove(key: string, member: string) {
    await this.redis.zrem(key, member);
  }

  async publish(channel: string, message: unknown) {
    await this.redis.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: (message: unknown) => void) {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(handler);
  }

  async close() {
    this.subscriber.disconnect();
    await this.redis.quit().catch(() => undefined);
  }
}

/** In-memory store for development and tests. Not shared across processes. */
export class MemoryStore implements KeyValueStore {
  readonly kind = 'memory' as const;
  private readonly values = new Map<string, { value: string; expires: number | null }>();
  private readonly windows = new Map<
    string,
    { entries: Array<{ member: string; at: number }>; expires: number }
  >();
  private readonly lists = new Map<string, { items: string[]; expires: number }>();
  private readonly schedules = new Map<string, Map<string, number>>();
  private readonly handlers = new Map<string, Set<(message: unknown) => void>>();

  private alive<T extends { expires: number | null }>(entry: T | undefined): T | undefined {
    if (!entry) return undefined;
    if (entry.expires !== null && entry.expires < Date.now()) return undefined;
    return entry;
  }

  async get(key: string) {
    return this.alive(this.values.get(key))?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    this.values.set(key, { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  async setNx(key: string, value: string, ttlSeconds: number) {
    if (this.alive(this.values.get(key))) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async del(key: string) {
    this.values.delete(key);
    this.windows.delete(key);
    this.lists.delete(key);
  }

  async incr(key: string, ttlSeconds: number) {
    const current = Number((await this.get(key)) ?? 0) + 1;
    const existing = this.alive(this.values.get(key));
    this.values.set(key, {
      value: String(current),
      expires: existing?.expires ?? Date.now() + ttlSeconds * 1000,
    });
    return current;
  }

  async hit(key: string, nowMs: number, windowMs: number, member?: string) {
    const window = this.windows.get(key) ?? { entries: [], expires: 0 };
    window.entries = window.entries.filter((e) => e.at > nowMs - windowMs);
    window.entries.push({ member: member ?? uniqueMember(nowMs), at: nowMs });
    window.expires = nowMs + windowMs;
    this.windows.set(key, window);
    return window.entries.length;
  }

  async windowEntries(key: string, nowMs: number, windowMs: number) {
    const window = this.windows.get(key);
    if (!window) return [];
    return window.entries.filter((e) => e.at >= nowMs - windowMs);
  }

  async pushCapped(key: string, value: string, maxLength: number, ttlSeconds: number) {
    const existing = this.lists.get(key);
    const items = existing && existing.expires > Date.now() ? existing.items : [];
    items.push(value);
    while (items.length > maxLength) items.shift();
    this.lists.set(key, { items, expires: Date.now() + ttlSeconds * 1000 });
  }

  async list(key: string) {
    const existing = this.lists.get(key);
    if (!existing || existing.expires < Date.now()) return [];
    return [...existing.items];
  }

  async scheduleAdd(key: string, member: string, atMs: number) {
    const set = this.schedules.get(key) ?? new Map<string, number>();
    set.set(member, atMs);
    this.schedules.set(key, set);
  }

  async scheduleDue(key: string, nowMs: number, limit: number) {
    const set = this.schedules.get(key);
    if (!set) return [];
    return [...set.entries()]
      .filter(([, at]) => at <= nowMs)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([member]) => member);
  }

  async scheduleRemove(key: string, member: string) {
    this.schedules.get(key)?.delete(member);
  }

  async publish(channel: string, message: unknown) {
    const payload = JSON.parse(JSON.stringify(message)) as unknown;
    for (const handler of this.handlers.get(channel) ?? []) queueMicrotask(() => handler(payload));
  }

  async subscribe(channel: string, handler: (message: unknown) => void) {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
  }

  async close() {
    this.values.clear();
    this.windows.clear();
    this.lists.clear();
    this.schedules.clear();
  }
}
