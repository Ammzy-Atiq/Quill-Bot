import { z } from 'zod';

export const AI_CATEGORIES = [
  'none',
  'harassment',
  'hate',
  'sexual',
  'sexual_minors',
  'self_harm',
  'violence',
  'scam',
  'spam',
  'extremism',
] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

export const AiVerdictSchema = z.object({
  flagged: z.boolean(),
  category: z.enum(AI_CATEGORIES),
  confidence: z.number().transform((n) => Math.min(1, Math.max(0, n))),
  reason: z.string().transform((s) => s.slice(0, 300)),
});
export type AiVerdict = z.infer<typeof AiVerdictSchema>;

/** JSON schema for providers with structured outputs (mirrors AiVerdictSchema). */
export const AI_VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    flagged: { type: 'boolean' },
    category: { type: 'string', enum: [...AI_CATEGORIES] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['flagged', 'category', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

export interface AiCredentials {
  provider: 'anthropic' | 'openai' | 'openai_compatible' | 'gemini';
  model: string;
  baseUrl: string | null;
  apiKey: string;
}

export interface ClassifyInput {
  text: string;
  /** Server-specific rules to consider (custom policies / description). */
  rules?: string[];
  /** What the cheap detectors already noticed (helps the model focus). */
  hints?: string[];
}

export type Classifier = (
  creds: AiCredentials,
  input: ClassifyInput,
  signal: AbortSignal,
) => Promise<AiVerdict | null>;

/** Default model per provider when the server does not choose one. */
export const DEFAULT_MODELS: Record<AiCredentials['provider'], string | null> = {
  anthropic: 'claude-opus-5',
  openai: 'omni-moderation-latest',
  openai_compatible: null,
  gemini: null,
};

export function parseVerdict(raw: string): AiVerdict | null {
  try {
    const json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const parsed = AiVerdictSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
