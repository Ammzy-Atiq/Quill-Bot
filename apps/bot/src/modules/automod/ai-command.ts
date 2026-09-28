import { maskSecret } from '@quill/shared';
import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { lockedId } from '../../framework/custom-id.js';
import { type ComponentHandler, type SlashCommand, UserError } from '../../framework/types.js';
import { code } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';
import { type AiCredentials, DEFAULT_MODELS } from './ai/types.js';

const PROVIDERS: Array<{ name: string; value: AiCredentials['provider'] }> = [
  { name: 'Anthropic (Claude)', value: 'anthropic' },
  { name: 'OpenAI (Moderation API)', value: 'openai' },
  { name: 'OpenAI-compatible (OpenRouter, Groq, local…)', value: 'openai_compatible' },
  { name: 'Google Gemini', value: 'gemini' },
];

const MODEL_HINT: Record<AiCredentials['provider'], string> = {
  anthropic: 'Default claude-opus-5. For lower cost on busy servers use e.g. claude-haiku-4-5.',
  openai: 'Default omni-moderation-latest (OpenAI moderation endpoint).',
  openai_compatible: 'Required, e.g. meta-llama/llama-3.3-70b-instruct',
  gemini: 'Required: a Gemini model name from Google AI Studio.',
};

export const aiCommand: SlashCommand = {
  module: 'automod',
  permission: 'manager',
  subcommandPermissions: { key: 'extra_owner', remove: 'extra_owner' },
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('AI analysis with your own API key.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('key')
        .setDescription('Set your provider and API key (stored encrypted).')
        .addStringOption((o) =>
          o
            .setName('provider')
            .setDescription('AI provider')
            .setRequired(true)
            .addChoices(...PROVIDERS),
        ),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show AI settings and usage.'))
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('How and when AI analysis runs.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn AI analysis on/off'))
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Which messages are analysed')
            .addChoices(
              { name: 'Borderline only (recommended, cheap)', value: 'borderline' },
              { name: 'Every message (costly)', value: 'all' },
            ),
        )
        .addNumberOption((o) =>
          o
            .setName('threshold')
            .setDescription('Min confidence 0.1–1 (default 0.8)')
            .setMinValue(0.1)
            .setMaxValue(1),
        )
        .addIntegerOption((o) =>
          o
            .setName('monthly_limit')
            .setDescription('Max requests per month')
            .setMinValue(0)
            .setMaxValue(1_000_000),
        )
        .addIntegerOption((o) =>
          o.setName('per_minute').setDescription('Max requests per minute').setMinValue(1).setMaxValue(600),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Send a test message to your AI provider.')
        .addStringOption((o) =>
          o.setName('text').setDescription('Text to classify').setRequired(true).setMaxLength(1000),
        ),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Delete the stored API key.')),
  async execute({ app, interaction, guild, config }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'key') {
      const provider = interaction.options.getString('provider', true) as AiCredentials['provider'];
      const modal = new ModalBuilder()
        .setCustomId(lockedId(interaction.user.id, 'ai', 'key', provider))
        .setTitle('QUILL GUARD · AI provider')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('API key')
            .setDescription('Stored with AES-256 encryption. Never shown again.')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('key')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(300),
            ),
          new LabelBuilder()
            .setLabel('Model')
            .setDescription(MODEL_HINT[provider].slice(0, 100))
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('model')
                .setStyle(TextInputStyle.Short)
                .setRequired(DEFAULT_MODELS[provider] === null)
                .setMaxLength(128)
                .setPlaceholder(DEFAULT_MODELS[provider] ?? 'model name'),
            ),
          new LabelBuilder()
            .setLabel('Base URL (optional)')
            .setDescription(
              provider === 'openai_compatible'
                ? 'Required, e.g. https://openrouter.ai/api/v1'
                : 'Leave empty for the official API',
            )
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('base')
                .setStyle(TextInputStyle.Short)
                .setRequired(provider === 'openai_compatible')
                .setMaxLength(300),
            ),
        );
      await interaction.showModal(modal);
      return;
    }
    if (sub === 'remove') {
      const removed = await app.ai.removeCredentials(guild.id);
      await app.configs.set(guild.id, interaction.user.id, ['automod', 'ai', 'enabled'], false);
      await reply(
        interaction,
        successCard(removed ? 'API key deleted' : 'No API key was stored', 'AI analysis is off.'),
        { ephemeral: true },
      );
      return;
    }
    if (sub === 'settings') {
      const changes: Array<{ path: string[]; value: unknown }> = [];
      const opts: Array<[string, string, 'bool' | 'str' | 'num' | 'int']> = [
        ['enabled', 'enabled', 'bool'],
        ['mode', 'mode', 'str'],
        ['threshold', 'threshold', 'num'],
        ['monthly_limit', 'monthlyRequestLimit', 'int'],
        ['per_minute', 'perMinuteLimit', 'int'],
      ];
      for (const [option, key, kind] of opts) {
        const value =
          kind === 'bool'
            ? interaction.options.getBoolean(option)
            : kind === 'str'
              ? interaction.options.getString(option)
              : kind === 'num'
                ? interaction.options.getNumber(option)
                : interaction.options.getInteger(option);
        if (value !== null) changes.push({ path: ['automod', 'ai', key], value });
      }
      if (changes.length === 0) throw new UserError('Choose at least one option to change.');
      if (
        changes.some((c) => c.path[2] === 'enabled' && c.value === true) &&
        !(await app.ai.credentials(guild.id))
      ) {
        throw new UserError('Set an API key first with /ai key.', 'No API key');
      }
      const ai = (await app.configs.update(guild.id, interaction.user.id, changes)).automod.ai;
      await reply(
        interaction,
        successCard(
          'AI settings saved',
          `${status(ai.enabled)} · ${ai.mode} · threshold ${ai.threshold} · ${ai.perMinuteLimit}/min · ${ai.monthlyRequestLimit}/month`,
        ),
        { ephemeral: true },
      );
      return;
    }
    if (sub === 'test') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const outcome = await app.ai.classify(
        guild.id,
        { text: interaction.options.getString('text', true) },
        { bypassLimits: true },
      );
      const body =
        outcome.status === 'ok'
          ? `**Flagged:** ${outcome.verdict.flagged ? 'yes' : 'no'} · **${outcome.verdict.category}** · ${Math.round(outcome.verdict.confidence * 100)}%\n${outcome.verdict.reason}`
          : outcome.status === 'error'
            ? `${E.cross} ${outcome.error}`
            : outcome.status === 'no_key'
              ? 'No API key set. Use /ai key.'
              : `No verdict (${outcome.status}).`;
      await reply(
        interaction,
        Card.create().header({ title: 'AI test', emoji: E.brain, level: 3 }).text(body).build(),
      );
      return;
    }
    // status
    const creds = await app.ai.credentials(guild.id);
    const ai = config.automod.ai;
    const used = await app.ai.usage(guild.id);
    await reply(
      interaction,
      Card.create()
        .header({ title: 'AI analysis', emoji: E.brain, level: 3, subtitle: status(ai.enabled) })
        .lines([
          ['Provider', creds ? `${creds.provider} · ${code(creds.model)}` : 'not set — /ai key'],
          ['API key', creds ? maskSecret(creds.apiKey) : '—'],
          ['Mode', ai.mode === 'all' ? 'every message' : 'borderline messages only'],
          ['Threshold', `${Math.round(ai.threshold * 100)}% confidence`],
          ['Usage this month', `${used} / ${ai.monthlyRequestLimit}`],
          ['Rate limit', `${ai.perMinuteLimit} per minute`],
        ])
        .footer('Your key is only used for this server and is stored encrypted.')
        .build(),
      { ephemeral: true },
    );
  },
};

export const aiComponents: ComponentHandler[] = [
  {
    id: 'ai:key',
    permission: 'extra_owner',
    locked: true,
    async execute({ app, interaction, guild, args }) {
      if (!interaction.isModalSubmit()) return;
      const provider = args[0] as AiCredentials['provider'];
      if (!Object.hasOwn(DEFAULT_MODELS, provider)) return;
      const apiKey = interaction.fields.getTextInputValue('key').trim();
      const model = interaction.fields.getTextInputValue('model').trim() || DEFAULT_MODELS[provider];
      const baseUrl = interaction.fields.getTextInputValue('base').trim() || null;
      if (!model) throw new UserError('This provider needs a model name.');
      if (baseUrl && !/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
        throw new UserError('The base URL must start with https://');
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await app.ai.saveCredentials(guild.id, interaction.user.id, { provider, model, baseUrl, apiKey });
      const outcome = await app.ai.classify(
        guild.id,
        { text: 'Hello everyone, have a nice day!' },
        { bypassLimits: true },
      );
      if (outcome.status === 'error') {
        await reply(
          interaction,
          Card.create()
            .header({ title: 'Key saved, but the test failed', emoji: E.warn, level: 3 })
            .text(`${outcome.error}\nCheck the key, model and base URL, then run /ai key again.`)
            .build(),
        );
        return;
      }
      await app.configs.set(guild.id, interaction.user.id, ['automod', 'ai', 'enabled'], true);
      await reply(
        interaction,
        successCard(
          'AI analysis enabled',
          `${provider} · ${code(model)} · key ${maskSecret(apiKey)}\nBorderline messages will now get a second opinion.`,
        ),
      );
    },
  },
];
