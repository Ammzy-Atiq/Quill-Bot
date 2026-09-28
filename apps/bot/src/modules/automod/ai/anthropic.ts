import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, userPrompt } from './prompt.js';
import { AI_VERDICT_JSON_SCHEMA, type Classifier, parseVerdict } from './types.js';

/** Models that accept `output_config.effort` (Haiku 4.5 and older reject it). */
const SUPPORTS_EFFORT = /^claude-(?:opus-(?:5|4-[678])|sonnet-(?:5|4-6)|fable|mythos)/;
/** Models that support server-side refusal fallbacks (`fallbacks: "default"`). */
const SUPPORTS_FALLBACKS = /^claude-(?:opus-5|fable-5-1)/;

/**
 * Claude classifier (bring-your-own-key). Structured output guarantees the JSON shape;
 * low effort keeps high-volume classification fast and cheap. A refused request (rare for
 * moderation) returns no verdict instead of throwing.
 */
export const classifyWithAnthropic: Classifier = async (creds, input, signal) => {
  const client = new Anthropic({
    apiKey: creds.apiKey,
    maxRetries: 1,
    timeout: 20_000,
    ...(creds.baseUrl ? { baseURL: creds.baseUrl } : {}),
  });
  const outputConfig = {
    format: {
      type: 'json_schema' as const,
      schema: AI_VERDICT_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
    ...(SUPPORTS_EFFORT.test(creds.model) ? { effort: 'low' as const } : {}),
  };
  const request = {
    model: creds.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: userPrompt(input) }],
    output_config: outputConfig,
  };

  const response = SUPPORTS_FALLBACKS.test(creds.model)
    ? await client.beta.messages.create(
        { ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        { signal },
      )
    : await client.messages.create(request, { signal });

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  for (const block of response.content) {
    if (block.type === 'text') return parseVerdict(block.text);
  }
  return null;
};
