import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  type MessageActionRowComponentBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';

export interface HeaderOptions {
  title: string;
  emoji?: string;
  subtitle?: string;
  /** Thumbnail image URL shown to the right of the header. */
  thumbnail?: string | null;
  /** Markdown heading level (1 = biggest). Defaults to 2. */
  level?: 1 | 2 | 3;
}

export interface Field {
  name: string;
  value: string;
}

/**
 * Fluent builder for QUILL's Components V2 cards.
 *
 * RULES (enforced here, see AGENTS.md):
 * - never set an accent colour → no side bar;
 * - content goes into Text Displays (markdown), never `content`/embeds.
 */
export class Card {
  private readonly container = new ContainerBuilder();
  private hasContent = false;

  static create(): Card {
    return new Card();
  }

  /** Title (+ optional subtitle and thumbnail accessory). */
  header(options: HeaderOptions): this {
    const hashes = '#'.repeat(options.level ?? 2);
    const title = `${hashes} ${options.emoji ? `${options.emoji} ` : ''}${options.title}`;
    const lines = options.subtitle ? [title, options.subtitle] : [title];
    if (options.thumbnail) {
      const section = new SectionBuilder()
        .addTextDisplayComponents(...lines.map((l) => new TextDisplayBuilder().setContent(l)))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.thumbnail));
      this.container.addSectionComponents(section);
    } else {
      this.container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }
    this.hasContent = true;
    return this;
  }

  /** A markdown text block. Empty strings are skipped. */
  text(content: string | undefined | null): this {
    if (!content?.trim()) return this;
    this.container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    this.hasContent = true;
    return this;
  }

  /** Name/value pairs rendered as one text block (bold names). */
  fields(fields: Field[]): this {
    const visible = fields.filter((f) => f.value.trim().length > 0);
    if (visible.length === 0) return this;
    return this.text(visible.map((f) => `**${f.name}**\n${f.value}`).join('\n\n'));
  }

  /** `label: value` lines rendered as one compact text block. */
  lines(pairs: Array<[label: string, value: string]>): this {
    if (pairs.length === 0) return this;
    return this.text(pairs.map(([label, value]) => `**${label}:** ${value}`).join('\n'));
  }

  /** Text with a button or thumbnail on the right (1–3 text blocks). */
  section(content: string | string[], accessory: ButtonBuilder | ThumbnailBuilder | string): this {
    const texts = (Array.isArray(content) ? content : [content]).slice(0, 3);
    const section = new SectionBuilder().addTextDisplayComponents(
      ...texts.map((t) => new TextDisplayBuilder().setContent(t)),
    );
    if (accessory instanceof ButtonBuilder) section.setButtonAccessory(accessory);
    else if (typeof accessory === 'string')
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(accessory));
    else section.setThumbnailAccessory(accessory);
    this.container.addSectionComponents(section);
    this.hasContent = true;
    return this;
  }

  divider(options: { spacing?: 'small' | 'large'; visible?: boolean } = {}): this {
    this.container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(options.visible ?? true)
        .setSpacing(options.spacing === 'large' ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small),
    );
    return this;
  }

  /** Image gallery (1–10 image URLs). */
  gallery(urls: string[]): this {
    const items = urls.slice(0, 10).map((url) => new MediaGalleryItemBuilder().setURL(url));
    if (items.length === 0) return this;
    this.container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...items));
    this.hasContent = true;
    return this;
  }

  /** Adds pre-built action rows (buttons or a select menu). */
  actions(...rows: ActionRowBuilder<MessageActionRowComponentBuilder>[]): this {
    const nonEmpty = rows.filter((r) => r.components.length > 0);
    if (nonEmpty.length > 0) this.container.addActionRowComponents(...nonEmpty);
    return this;
  }

  /** Adds buttons, automatically split into rows of 5. */
  buttons(...buttons: Array<ButtonBuilder | null | undefined | false>): this {
    const list = buttons.filter((b): b is ButtonBuilder => b instanceof ButtonBuilder);
    for (let i = 0; i < list.length; i += 5) {
      this.actions(new ActionRowBuilder<ButtonBuilder>().addComponents(...list.slice(i, i + 5)));
    }
    return this;
  }

  /** Small grey footer text, separated by a thin divider. */
  footer(text: string | undefined | null): this {
    if (!text?.trim()) return this;
    this.divider({ spacing: 'small' });
    this.container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${text}`));
    return this;
  }

  build(): ContainerBuilder {
    if (!this.hasContent) {
      this.container.addTextDisplayComponents(new TextDisplayBuilder().setContent('​'));
    }
    return this.container;
  }
}

export const card = () => Card.create();
