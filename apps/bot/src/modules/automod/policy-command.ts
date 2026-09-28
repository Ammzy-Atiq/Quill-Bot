import { automodRepo } from '@quill/db';
import { CustomPolicyDefinitionSchema, isSafeRegex, type PolicyTrigger } from '@quill/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { type SlashCommand, UserError } from '../../framework/types.js';
import { ACTION_CHOICES, actionFromOptions } from '../../lib/actions.js';
import { code, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';

const splitList = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

function buildTrigger(type: string, value: string): PolicyTrigger {
  switch (type) {
    case 'keywords':
      return { type: 'keywords', keywords: splitList(value).slice(0, 100), match: 'boundary' };
    case 'keywords_anywhere':
      return { type: 'keywords', keywords: splitList(value).slice(0, 100), match: 'substring' };
    case 'regex':
      if (!isSafeRegex(value))
        throw new UserError('That regular expression is invalid or could be too slow.', 'Invalid regex');
      return { type: 'regex', pattern: value };
    case 'domains':
      return {
        type: 'domains',
        domains: splitList(value).map((d) => d.toLowerCase().replace(/^https?:\/\//, '')),
      };
    case 'attachments':
      return {
        type: 'attachments',
        extensions: splitList(value).map((e) => e.replace(/^\./, '').toLowerCase()),
      };
    case 'mentions':
    case 'length': {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1) throw new UserError('Enter a positive number as the value.');
      return type === 'mentions' ? { type: 'mentions', max: n } : { type: 'length', max: n };
    }
    default:
      throw new UserError('Unknown trigger type.');
  }
}

function describeTrigger(t: PolicyTrigger): string {
  switch (t.type) {
    case 'keywords':
      return `${t.match === 'substring' ? 'text contains' : 'words'}: ${t.keywords.map((k) => `||${k}||`).join(', ')}`;
    case 'regex':
      return `regex ${code(t.pattern)}`;
    case 'domains':
      return `links to ${t.domains.join(', ')}`;
    case 'attachments':
      return `files: .${t.extensions.join(', .')}`;
    case 'mentions':
      return `more than ${t.max} mentions`;
    case 'length':
      return `longer than ${t.max} characters`;
  }
}

export const policyCommand: SlashCommand = {
  module: 'automod',
  permission: 'manager',
  data: new SlashCommandBuilder()
    .setName('policy')
    .setDescription('Custom server rules for AutoMod.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create or replace a rule.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Short name, e.g. no-crypto').setRequired(true).setMaxLength(64),
        )
        .addStringOption((o) =>
          o
            .setName('trigger')
            .setDescription('What the rule looks for')
            .setRequired(true)
            .addChoices(
              { name: 'Words (whole words, comma separated)', value: 'keywords' },
              { name: 'Text anywhere (comma separated)', value: 'keywords_anywhere' },
              { name: 'Regular expression', value: 'regex' },
              { name: 'Link domains (comma separated)', value: 'domains' },
              { name: 'File extensions (comma separated)', value: 'attachments' },
              { name: 'Mentions over N', value: 'mentions' },
              { name: 'Message longer than N', value: 'length' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('value')
            .setDescription('Words, regex, domains, extensions or number')
            .setRequired(true)
            .setMaxLength(1000),
        )
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('Shown to members and in logs')
            .setRequired(true)
            .setMaxLength(200),
        )
        .addIntegerOption((o) =>
          o.setName('severity').setDescription('1–5 (risk points), default 3').setMinValue(1).setMaxValue(5),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Immediate action')
            .addChoices(...ACTION_CHOICES),
        )
        .addStringOption((o) => o.setName('duration').setDescription('Timeout length, e.g. 1h'))
        .addBooleanOption((o) => o.setName('delete').setDescription('Delete the message (default yes)'))
        .addChannelOption((o) => o.setName('channel').setDescription('Only apply in this channel')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a rule.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Rule').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Enable or disable a rule.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Rule').setRequired(true).setAutocomplete(true),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show all rules.')),
  async autocomplete({ app, interaction, guild }) {
    const focused = interaction.options.getFocused().toLowerCase();
    const rows = await automodRepo.listPolicies(app.db, guild.id);
    await interaction.respond(
      rows
        .filter((r) => r.name.includes(focused))
        .slice(0, 25)
        .map((r) => ({ name: r.name, value: r.name })),
    );
  },
  async execute({ app, interaction, guild }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
      const name = interaction.options
        .getString('name', true)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .slice(0, 64);
      const existing = await automodRepo.listPolicies(app.db, guild.id);
      if (existing.length >= 50 && !existing.some((p) => p.name === name))
        throw new UserError('A server can have 50 rules.');
      const actionType = interaction.options.getString('action');
      const channel = interaction.options.getChannel('channel');
      const definition = CustomPolicyDefinitionSchema.parse({
        trigger: buildTrigger(
          interaction.options.getString('trigger', true),
          interaction.options.getString('value', true),
        ),
        severity: interaction.options.getInteger('severity') ?? 3,
        reason: interaction.options.getString('reason', true),
        deleteMessage: interaction.options.getBoolean('delete') ?? true,
        action:
          actionType && actionType !== 'none'
            ? actionFromOptions(actionType, interaction.options.getString('duration'))
            : null,
        channelIds: channel ? [channel.id] : [],
        exemptRoleIds: [],
      });
      await automodRepo.upsertPolicy(app.db, {
        guildId: guild.id,
        name,
        definition,
        createdBy: interaction.user.id,
      });
      await app.automodData.invalidate(guild.id);
      await reply(interaction, successCard(`Rule \`${name}\` saved`, describeTrigger(definition.trigger)), {
        ephemeral: true,
      });
      return;
    }
    if (sub === 'remove') {
      const name = interaction.options.getString('name', true);
      if (!(await automodRepo.removePolicy(app.db, guild.id, name)))
        throw new UserError(`No rule named ${code(name)}.`);
      await app.automodData.invalidate(guild.id);
      await reply(interaction, successCard(`Rule \`${name}\` deleted`), { ephemeral: true });
      return;
    }
    if (sub === 'toggle') {
      const name = interaction.options.getString('name', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      if (!(await automodRepo.setPolicyEnabled(app.db, guild.id, name, enabled)))
        throw new UserError(`No rule named ${code(name)}.`);
      await app.automodData.invalidate(guild.id);
      await reply(interaction, successCard(`Rule \`${name}\` ${enabled ? 'enabled' : 'disabled'}`), {
        ephemeral: true,
      });
      return;
    }
    const rows = await automodRepo.listPolicies(app.db, guild.id);
    const lines = rows.map((row) => {
      const def = CustomPolicyDefinitionSchema.safeParse(row.definition);
      if (!def.success) return `${E.warn} \`${row.name}\` — invalid definition`;
      const d = def.data;
      const action = d.action ? app.moderation.describe(d.action) : 'risk points only';
      return `${row.enabled ? E.on : E.off} **${row.name}** — ${truncate(describeTrigger(d.trigger), 120)}\n-# ${d.reason} · severity ${d.severity} · ${action}${d.channelIds.length ? ` · <#${d.channelIds[0]}>` : ''}`;
    });
    await reply(
      interaction,
      Card.create()
        .header({ title: 'Server rules', emoji: E.scroll, level: 3, subtitle: `${rows.length} rule(s)` })
        .text(lines.join('\n') || 'No rules yet — create one with /policy add.')
        .build(),
      { ephemeral: true },
    );
  },
};
