import { type BotModule, defineEvent } from '../../framework/types.js';
import { verificationCommand, verificationComponents } from './command.js';
import { dataCommand, dataComponents } from './data-command.js';

export const verificationModule: BotModule = {
  name: 'verification',
  commands: [verificationCommand, dataCommand],
  components: [...verificationComponents, ...dataComponents],
  events: [
    defineEvent({
      event: 'guildMemberAdd',
      async execute(app, member) {
        await app.verification.onJoin(member);
      },
    }),
    defineEvent({
      event: 'clientReady',
      once: true,
      execute(app) {
        app.verification.start();
      },
    }),
  ],
};
