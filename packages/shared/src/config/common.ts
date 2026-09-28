import { z } from 'zod';
import { type ModAction, ModActionSchema } from '../actions.js';
import { SNOWFLAKE_REGEX } from '../constants.js';

export const Snowflake = z.string().regex(SNOWFLAKE_REGEX, 'Invalid Discord ID');
export const SnowflakeList = z.array(Snowflake).max(100).default([]);
export const NullableSnowflake = Snowflake.nullable().default(null);

/** A count within a rolling time window. */
export const RateSchema = (count: number, windowSeconds: number) =>
  z
    .object({
      count: z.number().int().min(1).max(1000).default(count),
      windowSeconds: z.number().int().min(1).max(86_400).default(windowSeconds),
    })
    .prefault({});

export interface DetectorResponseDefaults {
  deleteMessage?: boolean;
  pointsMultiplier?: number;
  immediate?: ModAction | null;
  notifyUser?: boolean;
}

/** How a detector responds when it fires. */
export const detectorResponse = (defaults: DetectorResponseDefaults = {}) =>
  z
    .object({
      /** Delete the offending message. */
      deleteMessage: z.boolean().default(defaults.deleteMessage ?? true),
      /** Multiplier for the risk points the violation adds. 0 = no risk points. */
      pointsMultiplier: z
        .number()
        .min(0)
        .max(10)
        .default(defaults.pointsMultiplier ?? 1),
      /** Action executed immediately, independent of the risk ladder. */
      immediate: ModActionSchema.nullable().default(defaults.immediate ?? null),
      /** Send the member the (customisable) notice. */
      notifyUser: z.boolean().default(defaults.notifyUser ?? true),
    })
    .prefault({});
export type DetectorResponse = z.infer<ReturnType<typeof detectorResponse>>;

/** Fields every AutoMod detector shares. */
export const detectorBase = (enabled: boolean, response: DetectorResponseDefaults = {}) => ({
  enabled: z.boolean().default(enabled),
  /** Shadow mode: detect + log only, never act. Great for tuning. */
  shadow: z.boolean().default(false),
  exemptRoleIds: SnowflakeList,
  exemptChannelIds: SnowflakeList,
  response: detectorResponse(response),
});
