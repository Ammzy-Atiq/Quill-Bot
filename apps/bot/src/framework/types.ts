import type { GuildConfig } from '@quill/shared';
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  ClientEvents,
  Guild,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { App } from '../app.js';

/**
 * Who may run something, lowest → highest.
 * - everyone
 * - moderator:   ModerateMembers/Kick/Ban/ManageMessages permission or a configured mod role
 * - manager:     Manage Server / Administrator or a configured manager role
 * - extra_owner: the server owner or an extra owner (anti-nuke, whitelist, backups, emergency)
 * - owner:       the server owner only
 */
export const PERMISSION_LEVELS = ['everyone', 'moderator', 'manager', 'extra_owner', 'owner'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  everyone: 'Everyone',
  moderator: 'Moderator',
  manager: 'Manage Server',
  extra_owner: 'Server owner or extra owner',
  owner: 'Server owner',
};

export type ModuleKey =
  | 'general'
  | 'automod'
  | 'risk'
  | 'antinuke'
  | 'antiraid'
  | 'verification'
  | 'backup'
  | 'moderation'
  | 'logging';

export interface CommandContext {
  app: App;
  interaction: ChatInputCommandInteraction<'cached'>;
  guild: Guild;
  config: GuildConfig;
}

export interface AutocompleteContext {
  app: App;
  interaction: AutocompleteInteraction<'cached'>;
  guild: Guild;
}

export interface SlashCommand {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  module: ModuleKey;
  /** Required level for the whole command. */
  permission: PermissionLevel;
  /** Overrides per subcommand: key `sub` or `group sub`. */
  subcommandPermissions?: Record<string, PermissionLevel>;
  execute(ctx: CommandContext): Promise<unknown>;
  autocomplete?(ctx: AutocompleteContext): Promise<unknown>;
}

export type ComponentInteraction = MessageComponentInteraction<'cached'> | ModalSubmitInteraction<'cached'>;

export interface ComponentContext<I extends ComponentInteraction = ComponentInteraction> {
  app: App;
  interaction: I;
  guild: Guild;
  config: GuildConfig;
  /** custom_id arguments after `qg:<module>:<action>` (the lock user id removed when `locked`). */
  args: string[];
}

export interface ComponentHandler {
  /** `<module>:<action>` — matches custom ids `qg:<module>:<action>[:args]`. */
  id: string;
  permission: PermissionLevel;
  /** First custom_id argument is a user id; only that user may use the component. */
  locked?: boolean;
  execute(ctx: ComponentContext): Promise<unknown>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  event: K;
  once?: boolean;
  execute(app: App, ...args: ClientEvents[K]): unknown;
}

export function defineEvent<K extends keyof ClientEvents>(handler: EventHandler<K>): EventHandler {
  return handler as unknown as EventHandler;
}

export interface BotModule {
  name: ModuleKey;
  commands?: SlashCommand[];
  components?: ComponentHandler[];
  events?: EventHandler[];
  /** Called once per shard after services exist and before login. */
  init?(app: App): Promise<void>;
}

/** Throw inside handlers to show a friendly error card (not logged as an error). */
export class UserError extends Error {
  constructor(
    message: string,
    readonly title = 'Something is not right',
  ) {
    super(message);
  }
}
