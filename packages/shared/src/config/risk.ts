import { z } from 'zod';
import { ModActionSchema } from '../actions.js';

export const RiskLadderStepSchema = z.object({
  /** Risk score at which this step fires (crossing upward). */
  threshold: z.number().min(1).max(10_000),
  action: ModActionSchema,
});
export type RiskLadderStep = z.infer<typeof RiskLadderStepSchema>;

export const DEFAULT_RISK_LADDER: RiskLadderStep[] = [
  { threshold: 10, action: { type: 'warn' } },
  { threshold: 25, action: { type: 'timeout', durationSeconds: 10 * 60 } },
  { threshold: 45, action: { type: 'timeout', durationSeconds: 60 * 60 } },
  { threshold: 70, action: { type: 'kick' } },
  { threshold: 100, action: { type: 'ban', deleteMessageSeconds: 24 * 60 * 60 } },
];

export const RiskConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Risk decays exponentially; after this many hours a score is halved. */
    halfLifeHours: z
      .number()
      .min(1)
      .max(24 * 90)
      .default(24),
    ladder: z
      .array(RiskLadderStepSchema)
      .max(15)
      .default(DEFAULT_RISK_LADDER)
      .transform((steps) => [...steps].sort((a, b) => a.threshold - b.threshold)),
    /** Warnings stop counting after this many days. */
    warnExpiryDays: z.number().int().min(1).max(365).default(30),
    /** Base points per violation severity (index 0 = severity 1). */
    severityPoints: z.array(z.number().min(0).max(1000)).length(5).default([3, 6, 12, 25, 50]),
    /** Repeat offences within this window multiply points. */
    repeatWindowMinutes: z.number().int().min(1).max(1440).default(10),
    repeatMultiplier: z.number().min(1).max(5).default(1.5),
    trust: z
      .object({
        /** Accounts younger than this are "new". */
        newAccountDays: z.number().int().min(0).max(365).default(7),
        newAccountMultiplier: z.number().min(0.1).max(5).default(1.5),
        /** Members who passed QUILL verification. */
        verifiedMultiplier: z.number().min(0.1).max(5).default(0.8),
        /** Members flagged as a likely alt account at verification. */
        altSuspectMultiplier: z.number().min(0.1).max(5).default(2),
      })
      .prefault({}),
  })
  .prefault({});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;
