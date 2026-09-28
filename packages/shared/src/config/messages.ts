import { z } from 'zod';

/**
 * Server-customisable messages. Rendered by the bot into a Components V2 container
 * (title → heading, body → text display, optional thumbnail/image, footer → small text).
 * No colour field on purpose: QUILL containers never have an accent colour / side bar.
 */
export const MessageTemplateSchema = z.object({
  title: z.string().max(200).default(''),
  body: z.string().min(1).max(2000),
  footer: z.string().max(200).default(''),
  showThumbnail: z.boolean().default(true),
  imageUrl: z
    .url({ protocol: /^https$/ })
    .nullable()
    .default(null),
});
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

export const TEMPLATE_KEYS = [
  'automod_dm',
  'automod_channel',
  'risk_action_dm',
  'verification_panel',
  'verification_success',
  'verification_flagged',
  'verification_blocked',
  'emergency_notice',
  'raid_notice',
  'moderation_dm',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Human names for the template editor (bot `/messages` and the website dashboard). */
export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  automod_dm: 'AutoMod — DM to the member',
  automod_channel: 'AutoMod — notice in the channel',
  risk_action_dm: 'Risk Engine — DM on escalation',
  verification_panel: 'Verification — panel',
  verification_success: 'Verification — success',
  verification_flagged: 'Verification — under review',
  verification_blocked: 'Verification — denied',
  emergency_notice: 'Emergency mode notice',
  raid_notice: 'Raid mode notice',
  moderation_dm: 'Moderation — DM to the member',
};

/** Variables available in every template: {user} {user.name} {user.id} {server} {server.id}. */
export const TEMPLATE_VARIABLES: Record<TemplateKey, string[]> = {
  automod_dm: ['reason', 'detector', 'action', 'case', 'channel'],
  automod_channel: ['reason', 'detector'],
  risk_action_dm: ['action', 'reason', 'score', 'case'],
  verification_panel: [],
  verification_success: [],
  verification_flagged: ['reason'],
  verification_blocked: ['reason'],
  emergency_notice: ['reason'],
  raid_notice: ['duration'],
  moderation_dm: ['action', 'reason', 'moderator'],
};

export const DEFAULT_TEMPLATES: Record<TemplateKey, MessageTemplate> = {
  automod_dm: {
    title: 'Message removed in {server}',
    body: 'Your message in {channel} was removed by **QUILL GUARD**.\n**Reason:** {reason}\n**Action:** {action}',
    footer: 'Case #{case} · Contact the server staff if you believe this was a mistake.',
    showThumbnail: true,
    imageUrl: null,
  },
  automod_channel: {
    title: '',
    body: '{user}, your message was removed — **{reason}**.',
    footer: '',
    showThumbnail: false,
    imageUrl: null,
  },
  risk_action_dm: {
    title: 'Moderation action in {server}',
    body: 'You received **{action}** because your risk score reached **{score}**.\n**Latest reason:** {reason}',
    footer: 'Case #{case}',
    showThumbnail: true,
    imageUrl: null,
  },
  verification_panel: {
    title: 'Verify to enter {server}',
    body: 'This server is protected by **QUILL GUARD**. Press **Verify** below to get access.\nVerification takes a few seconds and protects the community from raids, alts and ban evasion.',
    footer: 'By verifying you agree to the QUILL GUARD privacy policy.',
    showThumbnail: true,
    imageUrl: null,
  },
  verification_success: {
    title: 'You are verified',
    body: 'Welcome to **{server}**, {user}! You now have full access.',
    footer: '',
    showThumbnail: true,
    imageUrl: null,
  },
  verification_flagged: {
    title: 'Verification under review',
    body: 'Your verification in **{server}** needs a quick manual review by the staff team. You will be notified once it is complete.',
    footer: '',
    showThumbnail: true,
    imageUrl: null,
  },
  verification_blocked: {
    title: 'Verification denied',
    body: 'Your verification in **{server}** was denied.\n**Reason:** {reason}',
    footer: '',
    showThumbnail: true,
    imageUrl: null,
  },
  emergency_notice: {
    title: 'Emergency mode active',
    body: '**{server}** is temporarily locked down while staff investigate a security incident.\n**Reason:** {reason}',
    footer: 'Protected by QUILL GUARD',
    showThumbnail: true,
    imageUrl: null,
  },
  raid_notice: {
    title: 'Raid protection active',
    body: 'A raid was detected. New joins are restricted for **{duration}**.',
    footer: 'Protected by QUILL GUARD',
    showThumbnail: true,
    imageUrl: null,
  },
  moderation_dm: {
    title: 'Moderation action in {server}',
    body: 'You received **{action}** from the staff of **{server}**.\n**Reason:** {reason}',
    footer: 'Contact the server staff if you believe this was a mistake.',
    showThumbnail: true,
    imageUrl: null,
  },
};

export const MessagesConfigSchema = z
  .object({
    templates: z.partialRecord(z.enum(TEMPLATE_KEYS), MessageTemplateSchema).default({}),
  })
  .prefault({});
export type MessagesConfig = z.infer<typeof MessagesConfigSchema>;
