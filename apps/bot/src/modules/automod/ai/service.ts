import { automodRepo } from '@quill/db';
import { decryptSecret, encryptSecret, redisKeys } from '@quill/shared';
import type { App } from '../../../app.js';
import { LruCache } from '../../../lib/lru.js';
import { classifyWithAnthropic } from './anthropic.js';
import { classifyWithGemini } from './gemini.js';
import { classifyWithOpenAiCompatible, classifyWithOpenAiModeration } from './openai.js';
import type { AiCredentials, AiVerdict, Classifier, ClassifyInput } from './types.js';

const CLASSIFIERS: Record<AiCredentials['provider'], Classifier> = {
  anthropic: classifyWithAnthropic,
  openai: classifyWithOpenAiModeration,
  openai_compatible: classifyWithOpenAiCompatible,
  gemini: classifyWithGemini,
};

export type ClassifyOutcome =
  | { status: 'ok'; verdict: AiVerdict }
  | { status: 'no_key' | 'rate_limited' | 'budget_exhausted' | 'no_verdict' }
  | { status: 'error'; error: string };

const monthKey = () => new Date().toISOString().slice(0, 7);

/**
 * Bring-your-own-key AI moderation. Keys are AES-256-GCM encrypted at rest, decrypted only in
 * memory, never logged. Per-minute and monthly caps protect the server owner's bill.
 */
export class AiService {
  private readonly cache = new LruCache<string, AiCredentials | null>(5_000, 5 * 60_000);

  constructor(private readonly app: App) {}

  async credentials(guildId: string): Promise<AiCredentials | null> {
    const cached = this.cache.get(guildId);
    if (cached !== undefined) return cached;
    const row = await automodRepo.getAiCredential(this.app.db, guildId);
    let creds: AiCredentials | null = null;
    if (row) {
      try {
        creds = {
          provider: row.provider as AiCredentials['provider'],
          model: row.model,
          baseUrl: row.baseUrl,
          apiKey: decryptSecret(row.apiKeyEnc, this.app.encryptionKey),
        };
      } catch (err) {
        this.app.logger.error({ err, guildId }, 'could not decrypt AI key (ENCRYPTION_KEY changed?)');
      }
    }
    this.cache.set(guildId, creds);
    return creds;
  }

  async saveCredentials(guildId: string, userId: string, creds: AiCredentials): Promise<void> {
    await automodRepo.saveAiCredential(this.app.db, {
      guildId,
      provider: creds.provider,
      model: creds.model,
      baseUrl: creds.baseUrl,
      apiKeyEnc: encryptSecret(creds.apiKey, this.app.encryptionKey),
      createdBy: userId,
    });
    this.cache.delete(guildId);
  }

  async removeCredentials(guildId: string): Promise<boolean> {
    this.cache.delete(guildId);
    return automodRepo.deleteAiCredential(this.app.db, guildId);
  }

  async usage(guildId: string): Promise<number> {
    return Number((await this.app.store.get(redisKeys.aiUsage(guildId, monthKey()))) ?? 0);
  }

  /** Classifies text with the server's own provider, enforcing its rate and budget limits. */
  async classify(
    guildId: string,
    input: ClassifyInput,
    opts: { bypassLimits?: boolean } = {},
  ): Promise<ClassifyOutcome> {
    const creds = await this.credentials(guildId);
    if (!creds) return { status: 'no_key' };
    const config = (await this.app.configs.get(guildId)).automod.ai;
    if (!opts.bypassLimits) {
      const perMinute = await this.app.store.incr(redisKeys.aiMinute(guildId), 60);
      if (perMinute > config.perMinuteLimit) return { status: 'rate_limited' };
      const monthly = await this.app.store.incr(redisKeys.aiUsage(guildId, monthKey()), 32 * 86_400);
      if (monthly > config.monthlyRequestLimit) return { status: 'budget_exhausted' };
    }
    try {
      const verdict = await CLASSIFIERS[creds.provider](creds, input, AbortSignal.timeout(20_000));
      return verdict ? { status: 'ok', verdict } : { status: 'no_verdict' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.app.logger.warn({ guildId, provider: creds.provider, error: message }, 'AI classification failed');
      return { status: 'error', error: message.replace(creds.apiKey, '[key]').slice(0, 300) };
    }
  }
}
