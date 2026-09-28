import {
  type AttachmentBuilder,
  type ContainerBuilder,
  type InteractionReplyOptions,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
  MessageFlags,
  type MessageMentionOptions,
  type RepliableInteraction,
  type SendableChannels,
} from 'discord.js';
import { assertV2 } from './limits.js';

export interface V2Options {
  ephemeral?: boolean;
  /** Users/roles allowed to be pinged. Default: nobody. */
  mentions?: { users?: string[]; roles?: string[] };
  files?: AttachmentBuilder[];
}

type Containers = ContainerBuilder | readonly ContainerBuilder[];

const toArray = (c: Containers): ContainerBuilder[] => (Array.isArray(c) ? [...c] : [c as ContainerBuilder]);

function allowedMentions(opts: V2Options): MessageMentionOptions {
  return { parse: [], users: opts.mentions?.users ?? [], roles: opts.mentions?.roles ?? [] };
}

/** Payload for channel.send(): always Components V2, never content/embeds. */
export function v2Message(containers: Containers, opts: V2Options = {}): MessageCreateOptions {
  const components = toArray(containers);
  assertV2(components);
  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: allowedMentions(opts),
    ...(opts.files ? { files: opts.files } : {}),
  };
}

export function v2Edit(containers: Containers, opts: V2Options = {}): MessageEditOptions {
  const components = toArray(containers);
  assertV2(components);
  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: allowedMentions(opts),
    ...(opts.files ? { files: opts.files } : {}),
  };
}

function v2Reply(containers: Containers, opts: V2Options): InteractionReplyOptions {
  const components = toArray(containers);
  assertV2(components);
  const flags = opts.ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;
  return {
    components,
    flags,
    allowedMentions: allowedMentions(opts),
    ...(opts.files ? { files: opts.files } : {}),
  };
}

/**
 * Replies to any interaction with a V2 message, handling the deferred/replied states:
 * - not acknowledged → reply
 * - deferred        → editReply (V2 flag must be set here, deferReply only takes Ephemeral)
 * - already replied → followUp
 */
export async function reply(interaction: RepliableInteraction, containers: Containers, opts: V2Options = {}) {
  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply(v2Edit(containers, opts) as Parameters<typeof interaction.editReply>[0]);
  }
  if (interaction.replied) {
    return interaction.followUp(v2Reply(containers, opts));
  }
  return interaction.reply(v2Reply(containers, opts));
}

/** Always a new follow-up message (e.g. an ephemeral note after `deferUpdate`). */
export async function followUp(
  interaction: RepliableInteraction,
  containers: Containers,
  opts: V2Options = {},
) {
  return interaction.followUp(v2Reply(containers, opts));
}

/** Updates the message a button/select belongs to (the message must already be V2). */
export async function update(
  interaction: RepliableInteraction & { update: (o: MessageEditOptions) => Promise<unknown> },
  containers: Containers,
  opts: V2Options = {},
) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(v2Edit(containers, opts) as Parameters<typeof interaction.editReply>[0]);
  }
  return interaction.update(v2Edit(containers, opts));
}

export async function send(
  channel: SendableChannels,
  containers: Containers,
  opts: V2Options = {},
): Promise<Message> {
  return channel.send(v2Message(containers, opts));
}
