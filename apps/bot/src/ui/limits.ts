import { DISCORD_LIMITS } from '@quill/shared';
import type { ContainerBuilder } from 'discord.js';

interface ComponentJson {
  type: number;
  content?: string;
  components?: ComponentJson[];
  accessory?: ComponentJson;
  accent_color?: number | null;
  items?: unknown[];
}

export interface V2Stats {
  components: number;
  textCharacters: number;
  hasAccentColor: boolean;
}

/** Counts components (nested included) and text characters exactly like Discord does. */
export function measureV2(containers: readonly ContainerBuilder[]): V2Stats {
  const stats: V2Stats = { components: 0, textCharacters: 0, hasAccentColor: false };
  const visit = (c: ComponentJson) => {
    stats.components += 1;
    if (typeof c.content === 'string') stats.textCharacters += c.content.length;
    if (c.accent_color !== undefined && c.accent_color !== null) stats.hasAccentColor = true;
    c.components?.forEach(visit);
    if (c.accessory) visit(c.accessory);
  };
  for (const container of containers) visit(container.toJSON() as ComponentJson);
  return stats;
}

export class V2LimitError extends Error {}

/** Throws if a message would be rejected by Discord or breaks the QUILL no-side-bar rule. */
export function assertV2(containers: readonly ContainerBuilder[]): V2Stats {
  const stats = measureV2(containers);
  if (stats.components > DISCORD_LIMITS.v2ComponentsPerMessage) {
    throw new V2LimitError(
      `Too many components: ${stats.components}/${DISCORD_LIMITS.v2ComponentsPerMessage}`,
    );
  }
  if (stats.textCharacters > DISCORD_LIMITS.v2TextCharacters) {
    throw new V2LimitError(`Too much text: ${stats.textCharacters}/${DISCORD_LIMITS.v2TextCharacters}`);
  }
  if (stats.hasAccentColor) {
    throw new V2LimitError('QUILL containers must not have an accent colour (no side bar rule)');
  }
  return stats;
}
