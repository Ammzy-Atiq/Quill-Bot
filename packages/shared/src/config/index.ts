import { z } from 'zod';
import { AntiNukeConfigSchema } from './antinuke.js';
import { AntiRaidConfigSchema } from './antiraid.js';
import { AutomodConfigSchema } from './automod.js';
import { GeneralConfigSchema, LoggingConfigSchema } from './logging.js';
import { MessagesConfigSchema } from './messages.js';
import { RiskConfigSchema } from './risk.js';
import { VerificationConfigSchema } from './verification.js';

export * from './antinuke.js';
export * from './antiraid.js';
export * from './automod.js';
export * from './common.js';
export * from './logging.js';
export * from './messages.js';
export * from './paths.js';
export * from './policies.js';
export * from './risk.js';
export * from './verification.js';

export const CONFIG_VERSION = 1;

/**
 * The full per-guild configuration. Stored SPARSE in `guild_settings.config`
 * (only values the server changed) and expanded with defaults by `parseGuildConfig`,
 * so improving a default automatically reaches every server that never touched it.
 */
export const GuildConfigSchema = z.object({
  version: z.number().int().default(CONFIG_VERSION),
  general: GeneralConfigSchema,
  logging: LoggingConfigSchema,
  risk: RiskConfigSchema,
  automod: AutomodConfigSchema,
  antinuke: AntiNukeConfigSchema,
  antiraid: AntiRaidConfigSchema,
  verification: VerificationConfigSchema,
  messages: MessagesConfigSchema,
});
export type GuildConfig = z.infer<typeof GuildConfigSchema>;
/** The sparse, user-provided shape stored in the database. */
export type GuildConfigInput = z.input<typeof GuildConfigSchema>;
export type ConfigModule = Exclude<keyof GuildConfig, 'version'>;

export const CONFIG_MODULES: readonly ConfigModule[] = [
  'general',
  'logging',
  'risk',
  'automod',
  'antinuke',
  'antiraid',
  'verification',
  'messages',
];

export const DEFAULT_GUILD_CONFIG: GuildConfig = GuildConfigSchema.parse({});

export interface ParsedConfig {
  config: GuildConfig;
  /** Modules that failed validation and fell back to defaults. */
  invalidModules: ConfigModule[];
}

/**
 * Parses a stored (sparse) config. Never throws: a module that fails validation
 * falls back to its defaults and is reported in `invalidModules`.
 */
export function parseGuildConfig(raw: unknown): ParsedConfig {
  const full = GuildConfigSchema.safeParse(raw ?? {});
  if (full.success) return { config: full.data, invalidModules: [] };

  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const invalidModules: ConfigModule[] = [];
  const repaired: Record<string, unknown> = { version: CONFIG_VERSION };
  for (const module of CONFIG_MODULES) {
    const schema = GuildConfigSchema.shape[module];
    const result = schema.safeParse(source[module]);
    if (result.success) {
      repaired[module] = source[module];
    } else {
      invalidModules.push(module);
    }
  }
  return { config: GuildConfigSchema.parse(repaired), invalidModules };
}

/** Validates a sparse config; returns the zod error message on failure. */
export function validateGuildConfig(
  raw: unknown,
): { ok: true; config: GuildConfig } | { ok: false; error: string } {
  const result = GuildConfigSchema.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, error: z.prettifyError(result.error) };
}
