import { SYSTEM_PROMPT, userPrompt } from './prompt.js';
import { type AiCategory, type AiVerdict, type Classifier, parseVerdict } from './types.js';

const MODERATION_MAP: Array<[prefix: string, category: AiCategory]> = [
  ['sexual/minors', 'sexual_minors'],
  ['self-harm', 'self_harm'],
  ['harassment', 'harassment'],
  ['hate', 'hate'],
  ['violence', 'violence'],
  ['sexual', 'sexual'],
];

interface ModerationResponse {
  results: Array<{ flagged: boolean; category_scores: Record<string, number> }>;
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/**
 * OpenAI key → the dedicated Moderation endpoint (purpose-built and inexpensive).
 * Model defaults to `omni-moderation-latest`.
 */
export const classifyWithOpenAiModeration: Classifier = async (creds, input, signal) => {
  const base = creds.baseUrl ?? 'https://api.openai.com/v1';
  const data = await postJson<ModerationResponse>(
    `${base.replace(/\/$/, '')}/moderations`,
    { model: creds.model, input: input.text.slice(0, 4000) },
    { authorization: `Bearer ${creds.apiKey}` },
    signal,
  );
  const result = data.results[0];
  if (!result) return null;
  let best: { category: AiCategory; score: number } = { category: 'none', score: 0 };
  for (const [key, score] of Object.entries(result.category_scores)) {
    const mapped = MODERATION_MAP.find(([prefix]) => key.startsWith(prefix))?.[1];
    if (mapped && score > best.score) best = { category: mapped, score };
  }
  const verdict: AiVerdict = {
    flagged: result.flagged,
    category: result.flagged ? best.category : 'none',
    confidence: best.score,
    reason: result.flagged ? `Flagged by OpenAI moderation (${best.category})` : 'Not flagged',
  };
  return verdict;
};

interface ChatResponse {
  choices: Array<{ message: { content: string | null } }>;
}

/** Any OpenAI-compatible chat API (OpenRouter, Groq, Together, local servers…). */
export const classifyWithOpenAiCompatible: Classifier = async (creds, input, signal) => {
  if (!creds.baseUrl) throw new Error('A base URL is required for OpenAI-compatible providers');
  const data = await postJson<ChatResponse>(
    `${creds.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      model: creds.model,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(input) },
      ],
    },
    { authorization: `Bearer ${creds.apiKey}` },
    signal,
  );
  const content = data.choices[0]?.message.content;
  return content ? parseVerdict(content) : null;
};
