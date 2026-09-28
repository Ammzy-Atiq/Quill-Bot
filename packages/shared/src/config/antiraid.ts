import { z } from 'zod';
import { ModActionSchema } from '../actions.js';
import { RateSchema } from './common.js';

export const AntiRaidConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Joins within the window that start raid mode. */
    joinRate: RateSchema(10, 10),
    /** Accounts younger than this are filtered (0 = off). */
    minAccountAgeDays: z.number().int().min(0).max(365).default(0),
    requireAvatar: z.boolean().default(false),
    /** Detect waves of look-alike usernames (bot farms). */
    similarNames: z.boolean().default(true),
    /** Action for members failing the join filters outside raid mode. */
    filterAction: ModActionSchema.default({ type: 'kick' }),
    raidMode: z
      .object({
        autoEnable: z.boolean().default(true),
        durationMinutes: z.number().int().min(1).max(1440).default(15),
        /** Action for every new join while raid mode is on. */
        joinAction: ModActionSchema.default({ type: 'kick' }),
        pauseInvites: z.boolean().default(false),
        /** Halve anti-nuke limits while raid mode is active. */
        tightenAntiNuke: z.boolean().default(true),
      })
      .prefault({}),
  })
  .prefault({});
export type AntiRaidConfig = z.infer<typeof AntiRaidConfigSchema>;
