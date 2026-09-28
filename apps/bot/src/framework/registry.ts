import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { BotModule, ComponentHandler, EventHandler, SlashCommand } from './types.js';

/** Collects every command, component handler and event from the bot modules. */
export class Registry {
  readonly commands = new Map<string, SlashCommand>();
  readonly components = new Map<string, ComponentHandler>();
  readonly events: EventHandler[] = [];
  readonly modules: BotModule[] = [];

  constructor(modules: BotModule[]) {
    for (const module of modules) this.add(module);
  }

  private add(module: BotModule): void {
    this.modules.push(module);
    for (const command of module.commands ?? []) {
      if (this.commands.has(command.data.name)) throw new Error(`Duplicate command /${command.data.name}`);
      this.commands.set(command.data.name, command);
    }
    for (const handler of module.components ?? []) {
      if (this.components.has(handler.id)) throw new Error(`Duplicate component handler ${handler.id}`);
      this.components.set(handler.id, handler);
    }
    this.events.push(...(module.events ?? []));
  }

  commandJson(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return [...this.commands.values()].map((c) => c.data.toJSON());
  }
}
