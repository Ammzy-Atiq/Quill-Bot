import { type BotModule, defineEvent } from '../../framework/types.js';
import { antiraidCommand, antiraidComponents } from './command.js';

export const antiraidModule: BotModule = {
  name: 'antiraid',
  commands: [antiraidCommand],
  components: antiraidComponents,
  events: [
    defineEvent({
      event: 'guildMemberAdd',
      async execute(app, member) {
        await app.antiraid.onJoin(member);
      },
    }),
  ],
};
