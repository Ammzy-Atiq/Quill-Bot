import type { BotModule } from '../framework/types.js';
import { automodModule } from './automod/index.js';
import { casesModule } from './cases/index.js';
import { coreModule } from './core/index.js';
import { generalModule } from './general/index.js';
import { loggingModule } from './logging/index.js';
import { banMirrorEvents } from './moderation/quick-actions.js';

/**
 * Every bot module. Add new modules here — the registry wires their commands,
 * component handlers and events automatically (static imports keep bundling simple).
 */
export const MODULES: BotModule[] = [
  coreModule,
  generalModule,
  loggingModule,
  { ...casesModule, events: [...(casesModule.events ?? []), ...banMirrorEvents] },
  automodModule,
];
