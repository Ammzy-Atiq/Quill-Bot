import { builtinWordlist, type DetectorContext, normalize, runDetectors, slugify } from '@quill/core';
import { automodRepo } from '@quill/db';
import {
  CUSTOM_WORD_MATCH_MODES,
  DETECTOR_KEYS,
  DETECTOR_LABELS,
  type DetectorKey,
  isSafeRegex,
  WORD_CATEGORIES,
  WORD_CATEGORY_LABELS,
  type WordCategory,
} from '@quill/shared';
import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { type CommandContext, type SlashCommand, UserError } from '../../framework/types.js';
import { ACTION_CHOICES, actionFromOptions } from '../../lib/actions.js';
import { code, truncate } from '../../lib/format.js';
import { Card } from '../../ui/card.js';
import { E, status } from '../../ui/emojis.js';
import { successCard } from '../../ui/presets.js';
import { reply } from '../../ui/respond.js';
import { violationLines } from './cards.js';
import { dHashUrl } from './image-hash.js';
import { handleNative } from './native.js';
import { automodPanel } from './panel.js';

const detectorChoices = DETECTOR_KEYS.map((k) => ({ name: DETECTOR_LABELS[k], value: k }));
const categoryChoices = WORD_CATEGORIES.map((c) => ({ name: WORD_CATEGORY_LABELS[c], value: c }));
const NORMALIZER_STAGES = [
  'unicode',
  'invisible',
  'zalgo',
  'confusables',
  'leetspeak',
  'separators',
  'repetition',
] as const;

const data = new SlashCommandBuilder()
  .setName('automod')
  .setDescription('Configure QUILL AutoMod.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('panel').setDescription('Open the AutoMod dashboard.'))
  .addSubcommand((s) =>
    s
      .setName('test')
      .setDescription('Dry-run a message through AutoMod and see what it detects.')
      .addStringOption((o) =>
        o.setName('text').setDescription('Text to test').setRequired(true).setMaxLength(2000),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('toggle')
      .setDescription('Turn a detector on or off.')
      .addStringOption((o) =>
        o
          .setName('detector')
          .setDescription('Detector')
          .setRequired(true)
          .addChoices(...detectorChoices),
      )
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('shadow')
      .setDescription('Shadow mode: detect and log, but never act (great for tuning).')
      .addStringOption((o) =>
        o
          .setName('detector')
          .setDescription('Detector')
          .setRequired(true)
          .addChoices(...detectorChoices),
      )
      .addBooleanOption((o) =>
        o.setName('enabled').setDescription('Shadow mode on or off').setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('response')
      .setDescription('Choose what a detector does when it fires.')
      .addStringOption((o) =>
        o
          .setName('detector')
          .setDescription('Detector')
          .setRequired(true)
          .addChoices(...detectorChoices),
      )
      .addBooleanOption((o) => o.setName('delete').setDescription('Delete the message'))
      .addNumberOption((o) =>
        o
          .setName('points')
          .setDescription('Risk points multiplier (0 = none, 1 = normal)')
          .setMinValue(0)
          .setMaxValue(10),
      )
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Immediate action (on top of the risk ladder)')
          .addChoices(...ACTION_CHOICES),
      )
      .addStringOption((o) => o.setName('duration').setDescription('Timeout length, e.g. 10m, 1h, 1d'))
      .addBooleanOption((o) => o.setName('notify').setDescription('DM the member')),
  )
  .addSubcommand((s) =>
    s
      .setName('normalizer')
      .setDescription('Turn a normalizer stage on or off.')
      .addStringOption((o) =>
        o
          .setName('stage')
          .setDescription('Stage')
          .setRequired(true)
          .addChoices(...NORMALIZER_STAGES.map((s) => ({ name: s, value: s }))),
      )
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('spam')
      .setDescription('Tune spam limits.')
      .addIntegerOption((o) =>
        o.setName('messages').setDescription('Max messages per window').setMinValue(2).setMaxValue(100),
      )
      .addIntegerOption((o) =>
        o.setName('window').setDescription('Window in seconds').setMinValue(2).setMaxValue(120),
      )
      .addIntegerOption((o) =>
        o.setName('duplicates').setDescription('Same message N times').setMinValue(2).setMaxValue(20),
      )
      .addIntegerOption((o) =>
        o.setName('mentions').setDescription('Max mentions per message').setMinValue(1).setMaxValue(50),
      )
      .addIntegerOption((o) =>
        o.setName('emojis').setDescription('Max emojis per message').setMinValue(3).setMaxValue(200),
      )
      .addBooleanOption((o) => o.setName('caps').setDescription('Flag excessive caps')),
  )
  .addSubcommand((s) =>
    s
      .setName('native')
      .setDescription("Mirror the worst terms into Discord's AutoMod (blocks before posting).")
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('What to do')
          .setRequired(true)
          .addChoices(
            { name: 'Sync now', value: 'sync' },
            { name: 'Status', value: 'status' },
            { name: 'Remove', value: 'remove' },
          ),
      )
      .addIntegerOption((o) =>
        o
          .setName('min_severity')
          .setDescription('Mirror terms at or above (default 4)')
          .setMinValue(1)
          .setMaxValue(5),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('words')
      .setDescription('Word filter settings.')
      .addSubcommand((s) =>
        s
          .setName('category')
          .setDescription('Turn a built-in category on/off or override its severity.')
          .addStringOption((o) =>
            o
              .setName('category')
              .setDescription('Category')
              .setRequired(true)
              .addChoices(...categoryChoices),
          )
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
          .addIntegerOption((o) =>
            o.setName('severity').setDescription('Severity override (1–5)').setMinValue(1).setMaxValue(5),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a custom word or phrase.')
          .addStringOption((o) =>
            o.setName('term').setDescription('Word, phrase or regex').setRequired(true).setMaxLength(200),
          )
          .addStringOption((o) =>
            o
              .setName('match')
              .setDescription('How to match (default: whole word)')
              .addChoices(...CUSTOM_WORD_MATCH_MODES.map((m) => ({ name: m, value: m }))),
          )
          .addIntegerOption((o) =>
            o.setName('severity').setDescription('Severity 1–5 (default 3)').setMinValue(1).setMaxValue(5),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a custom word.')
          .addStringOption((o) =>
            o.setName('term').setDescription('Word').setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((s) => s.setName('list').setDescription('Show categories and custom words.'))
      .addSubcommand((s) =>
        s
          .setName('allow')
          .setDescription('Never flag a word (fixes false positives).')
          .addStringOption((o) =>
            o.setName('word').setDescription('Word').setRequired(true).setMaxLength(64),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('unallow')
          .setDescription('Remove a word from the allowlist.')
          .addStringOption((o) =>
            o.setName('word').setDescription('Word').setRequired(true).setMaxLength(64),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('disable')
          .setDescription('Switch off one built-in term.')
          .addStringOption((o) =>
            o.setName('term').setDescription('Built-in term').setRequired(true).setMaxLength(100),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('enable')
          .setDescription('Switch a disabled built-in term back on.')
          .addStringOption((o) =>
            o.setName('term').setDescription('Built-in term').setRequired(true).setMaxLength(100),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('min-severity')
          .setDescription('Ignore built-in hits below this severity (default 2).')
          .addIntegerOption((o) =>
            o.setName('level').setDescription('1–5').setRequired(true).setMinValue(1).setMaxValue(5),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('exempt')
      .setDescription('Exempt roles, channels or members from AutoMod.')
      .addSubcommand((s) =>
        s
          .setName('role')
          .setDescription('Exempt a role.')
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
          .addBooleanOption((o) =>
            o.setName('exempt').setDescription('true = exempt, false = remove').setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('Exempt a channel or category.')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel')
              .setRequired(true)
              .addChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildCategory,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildForum,
              ),
          )
          .addBooleanOption((o) =>
            o.setName('exempt').setDescription('true = exempt, false = remove').setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('user')
          .setDescription('Exempt a member.')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addBooleanOption((o) =>
            o.setName('exempt').setDescription('true = exempt, false = remove').setRequired(true),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('links')
      .setDescription('Links & advertising.')
      .addSubcommand((s) =>
        s
          .setName('mode')
          .setDescription('Which links are allowed.')
          .addStringOption((o) =>
            o
              .setName('mode')
              .setDescription('off = all links allowed')
              .setRequired(true)
              .addChoices(
                { name: 'Off (allow all links)', value: 'off' },
                { name: 'Allowlist (only listed domains)', value: 'allowlist' },
                { name: 'Blocklist (all except listed domains)', value: 'blocklist' },
              ),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('domain')
          .setDescription('Add or remove a domain from the list.')
          .addStringOption((o) =>
            o.setName('domain').setDescription('e.g. youtube.com').setRequired(true).setMaxLength(253),
          )
          .addBooleanOption((o) =>
            o.setName('add').setDescription('true = add, false = remove').setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('invites')
          .setDescription('Discord invite filter.')
          .addBooleanOption((o) =>
            o.setName('block').setDescription('Block invites to other servers').setRequired(true),
          )
          .addBooleanOption((o) => o.setName('allow_own').setDescription('Allow invites to this server')),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('scam')
      .setDescription('Scam intelligence.')
      .addSubcommand((s) =>
        s
          .setName('add-domain')
          .setDescription('Report a scam domain (shared with every QUILL server).')
          .addStringOption((o) =>
            o.setName('domain').setDescription('Domain').setRequired(true).setMaxLength(253),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('add-image')
          .setDescription('Block an image (e.g. a fake giveaway screenshot) by its perceptual hash.')
          .addAttachmentOption((o) => o.setName('image').setDescription('The scam image').setRequired(true))
          .addStringOption((o) => o.setName('label').setDescription('Label').setMaxLength(100)),
      ),
  );

async function updateList(
  ctx: CommandContext,
  path: string[],
  value: string,
  add: boolean,
  current: string[],
) {
  const next = add ? [...new Set([...current, value])] : current.filter((v) => v !== value);
  await ctx.app.configs.set(ctx.guild.id, ctx.interaction.user.id, path, next);
}

function findBuiltin(term: string) {
  const slug = slugify(term);
  return builtinWordlist().filter((e) => slugify(e.term) === slug);
}

async function testCommand({ app, interaction, guild, config }: CommandContext) {
  const text = interaction.options.getString('text', true);
  const normalized = normalize(text, config.automod.normalizer);
  const data = await app.automodData.guild(guild.id);
  const ctx: DetectorContext = {
    config: config.automod,
    normalized,
    builtin: app.automodData.builtin(),
    custom: data.custom,
    history: [],
    now: Date.now(),
    scam: await app.automodData.scam(guild.id),
    policies: data.policies,
    memberRoleIds: [],
  };
  const result = runDetectors(
    {
      guildId: guild.id,
      channelId: interaction.channelId,
      authorId: interaction.user.id,
      content: text,
      extraText: [],
      createdAt: Date.now(),
      mentions: { users: 0, roles: 0, everyone: /@(?:everyone|here)\b/.test(text) },
      targetUserIds: [],
      attachments: [],
      accountCreatedAt: interaction.user.createdTimestamp,
      canMentionEveryone: false,
      inviteGuilds: {},
    },
    ctx,
  );
  const stats = normalized.stats;
  const tricks = [
    stats.confusables && `${stats.confusables} look-alike characters`,
    stats.leet && `${stats.leet} leetspeak characters`,
    stats.invisibleChars && `${stats.invisibleChars} invisible characters`,
    stats.combiningMarks && `${stats.combiningMarks} combining marks`,
    stats.mergedRuns && `${stats.mergedRuns} spaced-out words`,
  ].filter(Boolean);
  const card = Card.create()
    .header({ title: 'AutoMod test', emoji: E.target, level: 3 })
    .text(`**Normalized:** ${code(truncate(normalized.display || '∅', 900))}`)
    .text(tricks.length > 0 ? `**Evasion seen through:** ${tricks.join(', ')}` : null)
    .text(
      result.violations.length > 0
        ? `**Would trigger:**\n${violationLines(result.violations)}`
        : `${E.check} Nothing would be flagged with the current settings.`,
    )
    .footer(`Toxicity ${Math.round(result.toxicity * 100)}% · dry run, nothing was stored`)
    .build();
  await reply(interaction, card, { ephemeral: true });
}

export const automodCommand: SlashCommand = {
  module: 'automod',
  permission: 'manager',
  data,
  async autocomplete({ app, interaction, guild }) {
    const focused = interaction.options.getFocused().toLowerCase();
    const words = await automodRepo.listCustomWords(app.db, guild.id);
    await interaction.respond(
      words
        .filter((w) => w.term.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((w) => ({ name: truncate(w.term, 100), value: w.term })),
    );
  },
  async execute(ctx) {
    const { app, interaction, guild, config } = ctx;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const am = config.automod;
    const done = (title: string, body?: string) =>
      reply(interaction, successCard(title, body), { ephemeral: true });

    if (!group && sub === 'native') {
      await handleNative(ctx);
      return;
    }
    if (!group) {
      switch (sub) {
        case 'panel':
          await reply(interaction, automodPanel(app, guild, userId, config), { ephemeral: true });
          return;
        case 'test':
          await testCommand(ctx);
          return;
        case 'toggle': {
          const detector = interaction.options.getString('detector', true) as DetectorKey;
          const enabled = interaction.options.getBoolean('enabled', true);
          await app.configs.set(guild.id, userId, ['automod', detector, 'enabled'], enabled);
          await done(`${DETECTOR_LABELS[detector]}: ${status(enabled)}`);
          return;
        }
        case 'shadow': {
          const detector = interaction.options.getString('detector', true) as DetectorKey;
          const enabled = interaction.options.getBoolean('enabled', true);
          await app.configs.set(guild.id, userId, ['automod', detector, 'shadow'], enabled);
          await done(
            `${DETECTOR_LABELS[detector]} shadow mode: ${status(enabled)}`,
            enabled ? 'Detections are logged but no action is taken.' : undefined,
          );
          return;
        }
        case 'response': {
          const detector = interaction.options.getString('detector', true) as DetectorKey;
          const changes: Array<{ path: string[]; value: unknown }> = [];
          const del = interaction.options.getBoolean('delete');
          const points = interaction.options.getNumber('points');
          const action = interaction.options.getString('action');
          const notify = interaction.options.getBoolean('notify');
          if (del !== null)
            changes.push({ path: ['automod', detector, 'response', 'deleteMessage'], value: del });
          if (points !== null)
            changes.push({ path: ['automod', detector, 'response', 'pointsMultiplier'], value: points });
          if (notify !== null)
            changes.push({ path: ['automod', detector, 'response', 'notifyUser'], value: notify });
          if (action !== null) {
            const parsed = actionFromOptions(action, interaction.options.getString('duration'));
            changes.push({
              path: ['automod', detector, 'response', 'immediate'],
              value: parsed.type === 'none' ? null : parsed,
            });
          }
          if (changes.length === 0) throw new UserError('Choose at least one option to change.');
          const updated = await app.configs.update(guild.id, userId, changes);
          const r = updated.automod[detector].response;
          await done(
            `${DETECTOR_LABELS[detector]} response saved`,
            [
              `Delete message: ${status(r.deleteMessage)}`,
              `Risk points: ×${r.pointsMultiplier}`,
              `Immediate action: ${r.immediate ? app.moderation.describe(r.immediate) : 'none'}`,
              `DM member: ${status(r.notifyUser)}`,
            ].join('\n'),
          );
          return;
        }
        case 'normalizer': {
          const stage = interaction.options.getString('stage', true);
          const enabled = interaction.options.getBoolean('enabled', true);
          await app.configs.set(guild.id, userId, ['automod', 'normalizer', stage], enabled);
          await done(`Normalizer stage \`${stage}\`: ${status(enabled)}`);
          return;
        }
        case 'spam': {
          const changes: Array<{ path: string[]; value: unknown }> = [];
          const map: Array<[string, string[], 'int' | 'bool']> = [
            ['messages', ['automod', 'spam', 'messageRate', 'count'], 'int'],
            ['window', ['automod', 'spam', 'messageRate', 'windowSeconds'], 'int'],
            ['duplicates', ['automod', 'spam', 'duplicates', 'count'], 'int'],
            ['mentions', ['automod', 'spam', 'maxMentions'], 'int'],
            ['emojis', ['automod', 'spam', 'maxEmojis'], 'int'],
            ['caps', ['automod', 'spam', 'caps', 'enabled'], 'bool'],
          ];
          for (const [option, path, kind] of map) {
            const value =
              kind === 'int'
                ? interaction.options.getInteger(option)
                : interaction.options.getBoolean(option);
            if (value !== null) changes.push({ path, value });
          }
          if (changes.length === 0) throw new UserError('Choose at least one option to change.');
          const s = (await app.configs.update(guild.id, userId, changes)).automod.spam;
          await done(
            'Spam limits saved',
            `${s.messageRate.count} messages / ${s.messageRate.windowSeconds}s · ${s.duplicates.count} duplicates · ${s.maxMentions} mentions · ${s.maxEmojis} emojis · caps ${status(s.caps.enabled)}`,
          );
          return;
        }
      }
    }

    if (group === 'words') {
      switch (sub) {
        case 'category': {
          const category = interaction.options.getString('category', true) as WordCategory;
          const enabled = interaction.options.getBoolean('enabled', true);
          const severity = interaction.options.getInteger('severity');
          const changes: Array<{ path: string[]; value: unknown }> = [
            { path: ['automod', 'words', 'categories', category, 'enabled'], value: enabled },
          ];
          if (severity !== null)
            changes.push({ path: ['automod', 'words', 'categories', category, 'severity'], value: severity });
          await app.configs.update(guild.id, userId, changes);
          await done(
            `${WORD_CATEGORY_LABELS[category]}: ${status(enabled)}`,
            severity ? `Severity override: ${severity}` : undefined,
          );
          return;
        }
        case 'add': {
          const term = interaction.options.getString('term', true).trim();
          const match = (interaction.options.getString('match') ??
            'boundary') as (typeof CUSTOM_WORD_MATCH_MODES)[number];
          const severity = interaction.options.getInteger('severity') ?? 3;
          if (match === 'regex' && !isSafeRegex(term)) {
            throw new UserError('That regular expression is invalid or could be too slow.', 'Invalid regex');
          }
          const existing = await automodRepo.listCustomWords(app.db, guild.id);
          if (existing.length >= 1000) throw new UserError('This server already has 1000 custom words.');
          await automodRepo.addCustomWord(app.db, {
            guildId: guild.id,
            term,
            match,
            severity,
            createdBy: userId,
          });
          await app.automodData.invalidate(guild.id);
          await done('Custom word added', `${code(term)} · ${match} · severity ${severity}`);
          return;
        }
        case 'remove': {
          const term = interaction.options.getString('term', true);
          const removed = await automodRepo.removeCustomWord(app.db, guild.id, term);
          if (!removed) throw new UserError(`${code(term)} is not a custom word here.`);
          await app.automodData.invalidate(guild.id);
          await done('Custom word removed', code(term));
          return;
        }
        case 'list': {
          const words = await automodRepo.listCustomWords(app.db, guild.id);
          const cats = WORD_CATEGORIES.map((c) => {
            const cat = am.words.categories[c];
            return `${cat.enabled ? E.on : E.off} ${WORD_CATEGORY_LABELS[c]}${cat.severity ? ` (severity ${cat.severity})` : ''}`;
          });
          const card = Card.create()
            .header({
              title: 'Word filter',
              emoji: E.automod,
              level: 3,
              subtitle: `Minimum severity: **${am.words.minSeverity}**`,
            })
            .text(cats.join('\n'))
            .divider()
            .text(
              `**Custom words (${words.length})**\n${
                words.length > 0
                  ? truncate(words.map((w) => `||${w.term}|| · ${w.match} · ${w.severity}`).join('\n'), 1500)
                  : 'None yet — add one with /automod words add.'
              }`,
            )
            .text(
              am.words.allowlist.length > 0
                ? `**Allowlist:** ${truncate(am.words.allowlist.map(code).join(' '), 500)}`
                : null,
            )
            .text(
              am.words.disabledTermIds.length > 0
                ? `**Disabled built-in terms:** ${am.words.disabledTermIds.length}`
                : null,
            )
            .build();
          await reply(interaction, card, { ephemeral: true });
          return;
        }
        case 'allow':
        case 'unallow': {
          const word = interaction.options.getString('word', true).trim().toLowerCase();
          await updateList(ctx, ['automod', 'words', 'allowlist'], word, sub === 'allow', am.words.allowlist);
          await done(sub === 'allow' ? 'Word allowlisted' : 'Word removed from allowlist', code(word));
          return;
        }
        case 'disable':
        case 'enable': {
          const term = interaction.options.getString('term', true);
          const matches = findBuiltin(term);
          if (matches.length === 0) throw new UserError(`${code(term)} is not a built-in term.`, 'Not found');
          const ids = matches.map((m) => m.id);
          const next =
            sub === 'disable'
              ? [...new Set([...am.words.disabledTermIds, ...ids])]
              : am.words.disabledTermIds.filter((id) => !ids.includes(id));
          await app.configs.set(guild.id, userId, ['automod', 'words', 'disabledTermIds'], next);
          await done(
            sub === 'disable' ? 'Built-in term disabled' : 'Built-in term enabled',
            ids.map(code).join(' '),
          );
          return;
        }
        case 'min-severity': {
          const level = interaction.options.getInteger('level', true);
          await app.configs.set(guild.id, userId, ['automod', 'words', 'minSeverity'], level);
          await done('Minimum severity saved', `Built-in hits below severity ${level} are ignored.`);
          return;
        }
      }
    }

    if (group === 'exempt') {
      const exempt = interaction.options.getBoolean('exempt', true);
      if (sub === 'role') {
        const role = interaction.options.getRole('role', true);
        await updateList(ctx, ['automod', 'exempt', 'roleIds'], role.id, exempt, am.exempt.roleIds);
        await done(exempt ? 'Role exempted' : 'Role exemption removed', `<@&${role.id}>`);
      } else if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel', true);
        await updateList(ctx, ['automod', 'exempt', 'channelIds'], channel.id, exempt, am.exempt.channelIds);
        await done(exempt ? 'Channel exempted' : 'Channel exemption removed', `<#${channel.id}>`);
      } else {
        const user = interaction.options.getUser('user', true);
        await updateList(ctx, ['automod', 'exempt', 'userIds'], user.id, exempt, am.exempt.userIds);
        await done(exempt ? 'Member exempted' : 'Member exemption removed', `<@${user.id}>`);
      }
      return;
    }

    if (group === 'links') {
      if (sub === 'mode') {
        const mode = interaction.options.getString('mode', true);
        await app.configs.update(guild.id, userId, [
          { path: ['automod', 'links', 'mode'], value: mode },
          { path: ['automod', 'links', 'enabled'], value: true },
        ]);
        await done('Link mode saved', `Mode: **${mode}** · the links detector is on.`);
      } else if (sub === 'domain') {
        const domain = interaction.options
          .getString('domain', true)
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .split('/')[0]!;
        if (!/^[\p{L}\p{N}.-]+\.[\p{L}]{2,}$/u.test(domain))
          throw new UserError('That does not look like a domain.');
        await updateList(
          ctx,
          ['automod', 'links', 'domains'],
          domain,
          interaction.options.getBoolean('add', true),
          am.links.domains,
        );
        await done('Domain list updated', code(domain));
      } else {
        const block = interaction.options.getBoolean('block', true);
        const allowOwn = interaction.options.getBoolean('allow_own');
        const changes: Array<{ path: string[]; value: unknown }> = [
          { path: ['automod', 'links', 'invites', 'block'], value: block },
          { path: ['automod', 'links', 'enabled'], value: true },
        ];
        if (allowOwn !== null)
          changes.push({ path: ['automod', 'links', 'invites', 'allowOwnServer'], value: allowOwn });
        await app.configs.update(guild.id, userId, changes);
        await done('Invite filter saved', `Block invites: ${status(block)}`);
      }
      return;
    }

    if (group === 'scam') {
      if (sub === 'add-domain') {
        const domain = interaction.options
          .getString('domain', true)
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .split('/')[0]!;
        if (!domain.includes('.')) throw new UserError('That does not look like a domain.');
        await automodRepo.addScamDomain(app.db, domain, userId);
        await app.automodData.invalidate(guild.id);
        await done(
          'Scam domain reported',
          `${code(domain)} is now blocked in every QUILL server with scam protection.`,
        );
      } else {
        const image = interaction.options.getAttachment('image', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const hash = await dHashUrl(image.url, image.contentType, image.size);
        if (!hash) throw new UserError('Could not read that image (PNG, JPEG, WebP or GIF up to 8 MB).');
        await automodRepo.addScamImageHash(app.db, {
          hash,
          label: interaction.options.getString('label') ?? 'scam image',
          guildId: guild.id,
          addedBy: userId,
        });
        await app.automodData.invalidate(guild.id);
        await done(
          'Scam image blocked',
          `Perceptual hash ${code(hash)} — re-uploads, crops and recompressions are caught too.`,
        );
      }
      return;
    }
  },
};
