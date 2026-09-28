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
import { EmergencyService } from './modules/antinuke/emergency.js';
import { AntiNukeService } from './modules/antinuke/service.js';
import { SnapshotService } from './modules/antinuke/snapshots.js';
import { AntiRaidService } from './modules/antiraid/service.js';
import { AiService } from './modules/automod/ai/service.js';
import { AutomodData } from './modules/automod/data.js';
import { AutomodService } from './modules/automod/service.js';
import { CaseService } from './services/cases.js';
import { GuildConfigService } from './services/guild-config.js';
import { LogService } from './services/logs.js';
import { ModerationService } from './services/moderation.js';
import { RiskService } from './services/risk.js';
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
  readonly moderation: ModerationService;
  readonly risk: RiskService;
  readonly automodData: AutomodData;
  readonly automod: AutomodService;
  readonly ai: AiService;
  readonly snapshots: SnapshotService;
  readonly emergency: EmergencyService;
  readonly antinuke: AntiNukeService;
  readonly antiraid: AntiRaidService;

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
    this.moderation = new ModerationService(this);
    this.risk = new RiskService(this);
    this.automodData = new AutomodData(this);
    this.automod = new AutomodService(this);
    this.ai = new AiService(this);
    this.snapshots = new SnapshotService(this);
    this.emergency = new EmergencyService(this);
    this.antinuke = new AntiNukeService(this);
    this.antiraid = new AntiRaidService(this);
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
    await this.automodData.init();
    this.antinuke.start();
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
    this.snapshots.stop();
    this.antinuke.stop();
    await this.client.destroy();
    await this.store.close();
  }
}
