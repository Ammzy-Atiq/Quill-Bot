import { trust as trustRepo } from '@quill/db';
import { type AntiNukeAction, REDIS_CHANNELS, TrustInvalidateMessage } from '@quill/shared';
import type { App } from '../app.js';
import { LruCache } from '../lib/lru.js';

export interface GuildTrust {
  extraOwners: Set<string>;
  /** userId → whitelisted anti-nuke actions */
  whitelist: Map<string, Set<AntiNukeAction>>;
}

/** Extra owners + per-action whitelist (Olympus-style), cached per shard. */
export class TrustService {
  private readonly cache = new LruCache<string, GuildTrust>(10_000, 10 * 60_000);

  constructor(private readonly app: App) {}

  async init(): Promise<void> {
    await this.app.store.subscribe(REDIS_CHANNELS.trustInvalidate, (message) => {
      const parsed = TrustInvalidateMessage.safeParse(message);
      if (parsed.success && parsed.data.origin !== this.app.instanceId)
        this.cache.delete(parsed.data.guildId);
    });
  }

  async get(guildId: string): Promise<GuildTrust> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const rows = await trustRepo.listTrustEntries(this.app.db, guildId);
    const trust: GuildTrust = { extraOwners: new Set(), whitelist: new Map() };
    for (const row of rows) {
      if (row.kind === 'extra_owner') trust.extraOwners.add(row.userId);
      else trust.whitelist.set(row.userId, new Set(row.permissions as AntiNukeAction[]));
    }
    this.cache.set(guildId, trust);
    return trust;
  }

  async isExtraOwner(guildId: string, userId: string): Promise<boolean> {
    return (await this.get(guildId)).extraOwners.has(userId);
  }

  /** Call after any change to trust entries. */
  async invalidate(guildId: string): Promise<void> {
    this.cache.delete(guildId);
    await this.app.store.publish(REDIS_CHANNELS.trustInvalidate, {
      guildId,
      origin: this.app.instanceId,
    } satisfies TrustInvalidateMessage);
  }
}
