import {
  builtinWordlist,
  type CompiledPolicy,
  compilePolicy,
  type ScamData,
  SEED_SCAM_DOMAINS,
  type WordEntry,
  WordMatcher,
} from '@quill/core';
import { automodRepo } from '@quill/db';
import { CustomPolicyDefinitionSchema, REDIS_CHANNELS, WordlistInvalidateMessage } from '@quill/shared';
import type { App } from '../../app.js';
import { LruCache } from '../../lib/lru.js';

interface GuildWordData {
  custom: WordMatcher | null;
  customCount: number;
  policies: CompiledPolicy[];
  imageHashes: string[];
}

const SCAM_REFRESH_MS = 10 * 60_000;

/**
 * Per-process AutoMod data: the shared built-in matcher (built once), per-guild custom word
 * matchers + compiled policies (LRU, invalidated over Redis), and scam intelligence.
 */
export class AutomodData {
  private builtinMatcher: WordMatcher | null = null;
  private readonly guilds = new LruCache<string, GuildWordData>(5_000, 30 * 60_000);
  private scamDomains = new Set<string>(SEED_SCAM_DOMAINS);
  private scamLoadedAt = 0;

  constructor(private readonly app: App) {}

  async init(): Promise<void> {
    this.builtin(); // build eagerly at startup (~200 ms) instead of on the first message
    await this.app.store.subscribe(REDIS_CHANNELS.wordlistInvalidate, (message) => {
      const parsed = WordlistInvalidateMessage.safeParse(message);
      if (parsed.success && parsed.data.origin !== this.app.instanceId)
        this.guilds.delete(parsed.data.guildId);
    });
  }

  builtin(): WordMatcher {
    if (!this.builtinMatcher) this.builtinMatcher = new WordMatcher(builtinWordlist());
    return this.builtinMatcher;
  }

  async guild(guildId: string): Promise<GuildWordData> {
    const cached = this.guilds.get(guildId);
    if (cached) return cached;
    const [words, policies, imageHashes] = await Promise.all([
      automodRepo.listCustomWords(this.app.db, guildId),
      automodRepo.listPolicies(this.app.db, guildId),
      automodRepo.listScamImageHashes(this.app.db, guildId),
    ]);
    const entries: WordEntry[] = words.map((w) => ({
      id: `custom:${w.id}`,
      term: w.term,
      category: 'custom',
      severity: Math.min(5, Math.max(1, w.severity)) as WordEntry['severity'],
      match: w.match,
      lang: 'multi',
    }));
    const compiled: CompiledPolicy[] = [];
    for (const row of policies) {
      if (!row.enabled) continue;
      const def = CustomPolicyDefinitionSchema.safeParse(row.definition);
      if (def.success) compiled.push(compilePolicy(row.id, row.name, def.data));
    }
    const data: GuildWordData = {
      custom: entries.length > 0 ? new WordMatcher(entries) : null,
      customCount: entries.length,
      policies: compiled,
      imageHashes,
    };
    this.guilds.set(guildId, data);
    return data;
  }

  async scam(guildId: string): Promise<ScamData> {
    if (Date.now() - this.scamLoadedAt > SCAM_REFRESH_MS) {
      this.scamLoadedAt = Date.now();
      try {
        const stored = await automodRepo.listScamDomains(this.app.db);
        this.scamDomains = new Set([...SEED_SCAM_DOMAINS, ...stored]);
      } catch (err) {
        this.app.logger.warn({ err }, 'could not refresh scam domains');
      }
    }
    return { domains: this.scamDomains, imageHashes: (await this.guild(guildId)).imageHashes };
  }

  /** Call after changing custom words, policies or scam images of a guild. */
  async invalidate(guildId: string): Promise<void> {
    this.guilds.delete(guildId);
    this.scamLoadedAt = 0;
    await this.app.store.publish(REDIS_CHANNELS.wordlistInvalidate, {
      guildId,
      origin: this.app.instanceId,
    } satisfies WordlistInvalidateMessage);
  }
}
