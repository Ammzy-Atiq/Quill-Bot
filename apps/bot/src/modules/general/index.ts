import type { BotModule } from '../../framework/types.js';
import { aboutCommand, pingCommand } from './about.js';
import { helpCommand, helpComponents } from './help.js';
import { setupCommand, setupComponents } from './setup.js';

export const generalModule: BotModule = {
  name: 'general',
  commands: [helpCommand, aboutCommand, pingCommand, setupCommand],
  components: [...helpComponents, ...setupComponents],
};
