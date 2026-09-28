import { type BotModule, defineEvent } from '../../framework/types.js';
import { quickActionComponents } from '../moderation/quick-actions.js';
import { aiCommand, aiComponents } from './ai-command.js';
import { automodCommand } from './command.js';
import { automodPanelComponents } from './panel.js';
import { policyCommand } from './policy-command.js';
import { riskCommand } from './risk-command.js';

export const automodModule: BotModule = {
  name: 'automod',
  commands: [automodCommand, policyCommand, aiCommand, riskCommand],
  components: [...automodPanelComponents, ...aiComponents, ...quickActionComponents],
  events: [
    defineEvent({
      event: 'messageCreate',
      async execute(app, message) {
        await app.automod.handle(message);
      },
    }),
    defineEvent({
      event: 'messageUpdate',
      async execute(app, before, after) {
        if (after.partial) {
          const fetched = await after.fetch().catch(() => null);
          if (!fetched) return;
          after = fetched;
        }
        // Only re-check real content edits (not embed unfurls / pins).
        if (before.content === after.content) return;
        await app.automod.handle(after, true);
      },
    }),
  ],
};
