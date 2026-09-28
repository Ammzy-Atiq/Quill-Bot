import { randomBytes } from 'node:crypto';
import type { Database } from '@quill/db';
import { parseEncryptionKey } from '@quill/shared';
import type { Client } from 'discord.js';
import { createClient } from './client.js';
import type { Env } from './env.js';
import { Registry } from './framework/registry.js';
import { routeInteraction } from './framework/router.js';
import type { BotModule } from './framework/types.js';
import type { KeyValueStore } from './lib/store.js';
import type { Logger } from './logger.js';
import { CaseService } from './services/cases.js';
import { GuildConfigService } from './services/guild-config.js';
import { LogService } from './services/logs.js';
import { TrustService } from './services/trust.js';

const FALLBACK_LOGO = 'https://cdn.discordapp.com/embed/avatars/0.png';

/**
 * Per-shard application container. Every command/event/service receives it.
 * Keep state here minimal — anything shared between shards belongs in Postgres/Redis.
 */
export class App {
  /** Unique per process; used to skip our own pub/sub messages. */
  readonly instanceId = `${process.pid}-${randomBytes(4).toString('hex')}`;
  readonly startedAt = Date.now();
  readonly client: Client;
  readonly registry: Registry;
  readonly encryptionKey: Buffer;

  readonly configs: GuildConfigService;
  readonly trust: TrustService;
  readonly logs: LogService;
  readonly cases: CaseService;

  constructor(
    readonly env: Env,
    readonly logger: Logger,
    readonly db: Database,
    readonly store: KeyValueStore,
    modules: BotModule[],
  ) {
    this.client = createClient();
    this.registry = new Registry(modules);
    this.encryptionKey = parseEncryptionKey(env.ENCRYPTION_KEY);
    this.configs = new GuildConfigService(this);
    this.trust = new TrustService(this);
    this.logs = new LogService(this);
    this.cases = new CaseService(this);
  }

  /** Thumbnail used on QUILL cards: BRAND_LOGO_URL, else the bot avatar. */
  logo(): string {
    return (
      this.env.BRAND_LOGO_URL ??
      this.client.user?.displayAvatarURL({ extension: 'png', size: 256 }) ??
      FALLBACK_LOGO
    );
  }

  get shardIds(): number[] {
    return this.client.shard?.ids ?? [0];
  }

  async start(): Promise<void> {
    await this.configs.init();
    await this.trust.init();
    for (const module of this.registry.modules) await module.init?.(this);

    for (const handler of this.registry.events) {
      const listener = async (...args: unknown[]) => {
        try {
          await (handler.execute as (app: App, ...a: unknown[]) => unknown)(this, ...args);
        } catch (error) {
          this.logger.error({ err: error, event: handler.event }, 'event handler failed');
        }
      };
      if (handler.once) this.client.once(handler.event, listener);
      else this.client.on(handler.event, listener);
    }
    this.client.on('interactionCreate', (interaction) => {
      void routeInteraction(this, interaction);
    });
    this.client.on('error', (error) => this.logger.error({ err: error }, 'client error'));
    this.client.on('warn', (message) => this.logger.warn(message));

    await this.client.login(this.env.DISCORD_TOKEN);
  }

  async shutdown(): Promise<void> {
    this.logger.info('shutting down');
    await this.client.destroy();
    await this.store.close();
  }
}
