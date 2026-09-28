import { ConfigVersionConflictError, guildRepo } from '@quill/db';
import {
  ConfigInvalidateMessage,
  type ConfigPath,
  type GuildConfig,
  type GuildConfigInput,
  getAtPath,
  parseGuildConfig,
  REDIS_CHANNELS,
  setAtPath,
  unsetAtPath,
  validateGuildConfig,
} from '@quill/shared';
import type { App } from '../app.js';
import { UserError } from '../framework/types.js';
import { LruCache } from '../lib/lru.js';

interface CachedConfig {
  config: GuildConfig;
  raw: GuildConfigInput;
  version: number;
}

export interface ConfigChange {
  path: ConfigPath;
  /** `undefined` removes the override (back to the default). */
  value: unknown;
}

/**
 * Loads, caches and updates guild configs.
 * Cache: per-shard LRU; invalidated through Redis pub/sub when any process writes.
 */
export class GuildConfigService {
  private readonly cache = new LruCache<string, CachedConfig>(10_000, 10 * 60_000);
  private readonly pending = new Map<string, Promise<CachedConfig>>();

  constructor(private readonly app: App) {}

  async init(): Promise<void> {
    await this.app.store.subscribe(REDIS_CHANNELS.configInvalidate, (message) => {
      const parsed = ConfigInvalidateMessage.safeParse(message);
      if (!parsed.success || parsed.data.origin === this.app.instanceId) return;
      this.cache.delete(parsed.data.guildId);
    });
  }

  async get(guildId: string): Promise<GuildConfig> {
    return (await this.entry(guildId)).config;
  }

  async entry(guildId: string): Promise<CachedConfig> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const inflight = this.pending.get(guildId);
    if (inflight) return inflight;
    const promise = this.fetch(guildId).finally(() => this.pending.delete(guildId));
    this.pending.set(guildId, promise);
    return promise;
  }

  private async fetch(guildId: string): Promise<CachedConfig> {
    const stored = await guildRepo.getGuildSettings(this.app.db, guildId);
    const { config, invalidModules } = parseGuildConfig(stored.config);
    if (invalidModules.length > 0) {
      this.app.logger.warn(
        { guildId, invalidModules },
        'stored config had invalid modules; using defaults for them',
      );
    }
    const entry = { config, raw: stored.config, version: stored.version };
    this.cache.set(guildId, entry);
    return entry;
  }

  /** Applies changes atomically (optimistic concurrency with retries), audits and broadcasts them. */
  async update(guildId: string, actorId: string, changes: ConfigChange[]): Promise<GuildConfig> {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.cache.delete(guildId);
      const current = await this.fetch(guildId);
      let raw = current.raw as Record<string, unknown>;
      for (const change of changes) {
        raw =
          change.value === undefined
            ? unsetAtPath(raw, change.path)
            : setAtPath(raw, change.path, change.value);
      }
      const validated = validateGuildConfig(raw);
      if (!validated.ok) throw new UserError(validated.error, 'Invalid setting');
      try {
        const version = await guildRepo.saveGuildSettings(this.app.db, {
          guildId,
          config: raw as GuildConfigInput,
          expectedVersion: current.version,
          updatedBy: actorId,
        });
        const entry = { config: validated.config, raw: raw as GuildConfigInput, version };
        this.cache.set(guildId, entry);
        await this.app.store.publish(REDIS_CHANNELS.configInvalidate, {
          guildId,
          version,
          source: 'bot',
          origin: this.app.instanceId,
        } satisfies ConfigInvalidateMessage);
        await Promise.all(
          changes.map((change) =>
            guildRepo
              .recordConfigChange(this.app.db, {
                guildId,
                userId: actorId,
                source: 'bot',
                path: change.path.join('.'),
                oldValue: getAtPath(current.config, change.path),
                newValue: getAtPath(validated.config, change.path),
              })
              .catch((err: unknown) => this.app.logger.warn({ err }, 'config audit write failed')),
          ),
        );
        return validated.config;
      } catch (error) {
        if (error instanceof ConfigVersionConflictError && attempt < 2) continue;
        throw error;
      }
    }
    throw new UserError('Could not save the setting, please try again.');
  }

  /**
   * Replaces every reference to `oldId` in the stored config (single values and id lists) with
   * `newId`. Used after QUILL re-creates a deleted channel/role so log channels, exempt lists and
   * roles keep working. Returns how many settings changed.
   */
  async replaceId(guildId: string, actorId: string, oldId: string, newId: string): Promise<number> {
    const { raw } = await this.entry(guildId);
    const changes: ConfigChange[] = [];
    const walk = (value: unknown, path: string[]) => {
      if (value === oldId) changes.push({ path, value: newId });
      else if (Array.isArray(value)) {
        if (value.includes(oldId)) changes.push({ path, value: value.map((v) => (v === oldId ? newId : v)) });
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
      }
    };
    walk(raw, []);
    if (changes.length > 0) await this.update(guildId, actorId, changes);
    return changes.length;
  }

  set(guildId: string, actorId: string, path: ConfigPath, value: unknown): Promise<GuildConfig> {
    return this.update(guildId, actorId, [{ path, value }]);
  }

  reset(guildId: string, actorId: string, path: ConfigPath): Promise<GuildConfig> {
    return this.update(guildId, actorId, [{ path, value: undefined }]);
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
