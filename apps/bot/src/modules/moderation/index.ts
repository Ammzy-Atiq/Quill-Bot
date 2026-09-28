import type { BotModule } from '../../framework/types.js';
import { moderationCommands } from './commands.js';

/** Manual moderation commands (quick-action buttons and the ban mirror live in quick-actions.ts). */
export const moderationModule: BotModule = {
  name: 'moderation',
  commands: moderationCommands,
};
