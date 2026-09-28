import { DISCORD_LIMITS, type ModAction } from '@quill/shared';
import { UserError } from '../framework/types.js';
import { parseDuration } from './format.js';

export const ACTION_CHOICES = [
  { name: 'None (only delete / add risk)', value: 'none' },
  { name: 'Warn', value: 'warn' },
  { name: 'Timeout', value: 'timeout' },
  { name: 'Quarantine', value: 'quarantine' },
  { name: 'Remove roles', value: 'strip_roles' },
  { name: 'Kick', value: 'kick' },
  { name: 'Softban (kick + delete messages)', value: 'softban' },
  { name: 'Ban', value: 'ban' },
];

/** Builds a ModAction from slash-command options (`duration` like `10m`, `1h`, `7d`). */
export function actionFromOptions(type: string, duration?: string | null): ModAction {
  switch (type) {
    case 'none':
    case 'warn':
    case 'quarantine':
    case 'strip_roles':
    case 'kick':
    case 'softban':
      return { type };
    case 'timeout': {
      const seconds = duration ? parseDuration(duration) : 3600;
      if (!seconds) throw new UserError('Use a duration like `10m`, `2h` or `7d`.', 'Invalid duration');
      return {
        type: 'timeout',
        durationSeconds: Math.min(Math.max(seconds, 5), DISCORD_LIMITS.timeoutMaxSeconds),
      };
    }
    case 'ban': {
      const seconds = duration ? parseDuration(duration) : 0;
      return {
        type: 'ban',
        deleteMessageSeconds: Math.min(seconds ?? 0, DISCORD_LIMITS.banDeleteMessageMaxSeconds),
      };
    }
    default:
      throw new UserError(`Unknown action ${type}`);
  }
}
