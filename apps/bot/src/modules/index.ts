import type { BotModule } from '../framework/types.js';
import { antinukeModule } from './antinuke/index.js';
import { antiraidModule } from './antiraid/index.js';
import { automodModule } from './automod/index.js';
import { casesModule } from './cases/index.js';
import { coreModule } from './core/index.js';
import { generalModule } from './general/index.js';
import { loggingModule } from './logging/index.js';
import { moderationModule } from './moderation/index.js';
import { banMirrorEvents } from './moderation/quick-actions.js';
import { verificationModule } from './verification/index.js';

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
  antinukeModule,
  antiraidModule,
  verificationModule,
  moderationModule,
];
