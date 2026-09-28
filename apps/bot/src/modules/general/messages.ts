import {
  DEFAULT_TEMPLATES,
  MessageTemplateSchema,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  TEMPLATE_VARIABLES,
  type TemplateKey,
} from '@quill/shared';
import {
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { App } from '../../app.js';
import { lockedId } from '../../framework/custom-id.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';
import { renderTemplate, type TemplateVars, templateFor } from '../../ui/templates.js';

const TEMPLATE_CHOICES = TEMPLATE_KEYS.map((key) => ({ name: TEMPLATE_LABELS[key], value: key }));

/** Example values so previews look like the real thing. */
const SAMPLE: TemplateVars = {
  reason: 'Posting a scam link',
  detector: 'Scams',
  action: 'Timeout 1h',
  case: 42,
  channel: '#general',
  score: 48,
  duration: '15m',
  moderator: 'moderator',
};

const variablesFor = (key: TemplateKey) =>
  ['{user}', '{user.name}', '{server}', ...TEMPLATE_VARIABLES[key].map((v) => `{${v}}`)].join(' ');

function preview(
  app: App,
  config: Parameters<typeof renderTemplate>[1],
  key: TemplateKey,
  guildName: string,
  userId: string,
) {
  return renderTemplate(app, config, key, {
    ...SAMPLE,
    server: guildName,
    'server.id': '0',
    user: `<@${userId}>`,
    'user.name': 'member',
    'user.id': userId,
  });
}

export const messagesCommand: SlashCommand = {
  module: 'general',
  permission: 'manager',
  data: new SlashCommandBuilder()
    .setName('messages')
    .setDescription('Customise the messages QUILL sends (DMs, notices, verification panel).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('list').setDescription('All templates and whether they are customised.'))
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit a template.')
        .addStringOption((o) =>
          o
            .setName('template')
            .setDescription('Template')
            .setRequired(true)
            .addChoices(...TEMPLATE_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('preview')
        .setDescription('Preview a template with example values.')
        .addStringOption((o) =>
          o
            .setName('template')
            .setDescription('Template')
            .setRequired(true)
            .addChoices(...TEMPLATE_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription('Reset a template to the QUILL default.')
        .addStringOption((o) =>
          o
            .setName('template')
            .setDescription('Template')
            .setRequired(true)
            .addChoices(...TEMPLATE_CHOICES),
        ),
    ),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      await reply(
        interaction,
        Card.create()
          .header({
            title: 'Message templates',
            emoji: E.scroll,
            subtitle: 'Edit with /messages edit — no coloured side bar, ever.',
          })
          .text(
            TEMPLATE_KEYS.map(
              (key) =>
                `${config.messages.templates[key] ? E.sparkles : E.dot} **${TEMPLATE_LABELS[key]}**${config.messages.templates[key] ? ' · customised' : ''}\n-# ${variablesFor(key)}`,
            ).join('\n'),
          )
          .build(),
        { ephemeral: true },
      );
      return;
    }
    const key = interaction.options.getString('template', true) as TemplateKey;
    if (!TEMPLATE_KEYS.includes(key)) throw new UserError('Unknown template.');

    if (sub === 'preview') {
      await reply(interaction, preview(app, config, key, guild.name, interaction.user.id), {
        ephemeral: true,
      });
      return;
    }
    if (sub === 'reset') {
      await app.configs.reset(guild.id, interaction.user.id, ['messages', 'templates', key]);
      await reply(
        interaction,
        successCard('Template reset', `**${TEMPLATE_LABELS[key]}** uses the QUILL default again.`),
        { ephemeral: true },
      );
      return;
    }

    const current = templateFor(config, key);
    const text = (
      id: string,
      label: string,
      value: string,
      opts: { paragraph?: boolean; max: number; required?: boolean; description?: string },
    ) => {
      const input = new TextInputBuilder()
        .setCustomId(id)
        .setStyle(opts.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setMaxLength(opts.max)
        .setRequired(opts.required ?? false);
      if (value) input.setValue(value);
      const labelBuilder = new LabelBuilder().setLabel(label).setTextInputComponent(input);
      if (opts.description) labelBuilder.setDescription(truncate(opts.description, 100));
      return labelBuilder;
    };
    const modal = new ModalBuilder()
      .setCustomId(lockedId(interaction.user.id, 'msg', 'save', key))
      .setTitle(truncate(TEMPLATE_LABELS[key], 45))
      .addLabelComponents(
        text('title', 'Title', current.title, { max: 200, description: 'Leave empty for no title' }),
        text('body', 'Message', current.body, {
          paragraph: true,
          max: 2000,
          required: true,
          description: `Variables: ${variablesFor(key)}`,
        }),
        text('footer', 'Footer', current.footer, { max: 200 }),
        text('image', 'Image URL (https, optional)', current.imageUrl ?? '', { max: 400 }),
        new LabelBuilder()
          .setLabel('Show the QUILL logo')
          .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId('thumb')
              .addOptions(
                new StringSelectMenuOptionBuilder()
                  .setLabel('Yes')
                  .setValue('yes')
                  .setDefault(current.showThumbnail),
                new StringSelectMenuOptionBuilder()
                  .setLabel('No')
                  .setValue('no')
                  .setDefault(!current.showThumbnail),
              ),
          ),
      );
    await interaction.showModal(modal);
  },
};

export const messagesComponents: ComponentHandler[] = [
  {
    id: 'msg:save',
    permission: 'manager',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isModalSubmit()) return;
      const key = args[0] as TemplateKey;
      if (!TEMPLATE_KEYS.includes(key)) return;
      const image = interaction.fields.getTextInputValue('image').trim();
      const parsed = MessageTemplateSchema.safeParse({
        title: interaction.fields.getTextInputValue('title').trim(),
        body: interaction.fields.getTextInputValue('body').trim(),
        footer: interaction.fields.getTextInputValue('footer').trim(),
        showThumbnail: interaction.fields.getStringSelectValues('thumb')[0] !== 'no',
        imageUrl: image || null,
      });
      if (!parsed.success) {
        throw new UserError(
          image && !/^https:\/\//.test(image)
            ? 'The image URL must start with https://'
            : 'The message body cannot be empty.',
          'Invalid template',
        );
      }
      const same = JSON.stringify(parsed.data) === JSON.stringify(DEFAULT_TEMPLATES[key]);
      const updated = await app.configs.set(
        guild.id,
        interaction.user.id,
        ['messages', 'templates', key],
        same ? undefined : parsed.data,
      );
      await reply(
        interaction,
        [
          successCard('Template saved', `**${TEMPLATE_LABELS[key]}** — preview:`),
          preview(app, updated, key, guild.name, interaction.user.id),
        ],
        {
          ephemeral: true,
        },
      );
    },
  },
];
