import { z } from 'zod';
import { ModActionSchema } from '../actions.js';

/**
 * Custom server policy ("rule") stored in `custom_policies.definition`.
 * Evaluated by @quill/core `evaluatePolicies` after the built-in detectors.
 */
export const PolicyTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('keywords'),
    keywords: z.array(z.string().min(1).max(100)).min(1).max(100),
    match: z.enum(['exact', 'boundary', 'substring']).default('boundary'),
  }),
  z.object({
    type: z.literal('regex'),
    pattern: z.string().min(1).max(200),
  }),
  z.object({
    type: z.literal('domains'),
    domains: z.array(z.string().min(3).max(253)).min(1).max(100),
  }),
  z.object({
    type: z.literal('attachments'),
    /** File extensions without the dot, e.g. `exe`, `scr`. */
    extensions: z.array(z.string().min(1).max(10)).min(1).max(50),
  }),
  z.object({
    type: z.literal('mentions'),
    max: z.number().int().min(1).max(100),
  }),
  z.object({
    type: z.literal('length'),
    max: z.number().int().min(1).max(4000),
  }),
]);
export type PolicyTrigger = z.infer<typeof PolicyTriggerSchema>;

export const CustomPolicyDefinitionSchema = z.object({
  trigger: PolicyTriggerSchema,
  severity: z.number().int().min(1).max(5).default(3),
  /** Shown to the member and in logs. */
  reason: z.string().min(1).max(200),
  deleteMessage: z.boolean().default(true),
  /** Executed immediately (in addition to risk points). */
  action: ModActionSchema.nullable().default(null),
  /** Only apply in these channels (empty = everywhere). */
  channelIds: z.array(z.string()).max(50).default([]),
  exemptRoleIds: z.array(z.string()).max(50).default([]),
});
export type CustomPolicyDefinition = z.infer<typeof CustomPolicyDefinitionSchema>;

/** Rejects patterns likely to cause catastrophic backtracking. */
export function isSafeRegex(pattern: string): boolean {
  if (pattern.length > 200) return false;
  // nested quantifiers like (a+)+, (.*)*, (\w+)*
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern, 'iu');
    return true;
  } catch {
    return false;
  }
}
