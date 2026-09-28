import { DEFAULT_TEMPLATES, type GuildConfig, type MessageTemplate, type TemplateKey } from '@quill/shared';
import type { ContainerBuilder, Guild, User } from 'discord.js';
import type { App } from '../app.js';
import { Card } from './card.js';

export type TemplateVars = Record<string, string | number | null | undefined>;

export function templateFor(config: GuildConfig, key: TemplateKey): MessageTemplate {
  return config.messages.templates[key] ?? DEFAULT_TEMPLATES[key];
}

/** Replaces `{var}` placeholders; unknown placeholders are left as-is. */
export function fillTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{([a-z0-9_.]+)\}/gi, (whole, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

export function baseVars(guild: Guild, user?: User | null): TemplateVars {
  return {
    server: guild.name,
    'server.id': guild.id,
    user: user ? `<@${user.id}>` : undefined,
    'user.name': user?.username,
    'user.id': user?.id,
  };
}

/** Renders a server-customisable template into a Components V2 container (no accent colour). */
export function renderTemplate(
  app: App,
  config: GuildConfig,
  key: TemplateKey,
  vars: TemplateVars,
  extra?: (card: Card) => void,
): ContainerBuilder {
  const template = templateFor(config, key);
  const card = Card.create();
  const title = fillTemplate(template.title, vars).trim();
  const thumbnail = template.showThumbnail ? app.logo() : null;
  if (title) {
    card.header({ title, level: 3, thumbnail, subtitle: fillTemplate(template.body, vars) });
  } else {
    card.text(fillTemplate(template.body, vars));
  }
  if (template.imageUrl) card.gallery([template.imageUrl]);
  extra?.(card);
  card.footer(fillTemplate(template.footer, vars));
  return card.build();
}
