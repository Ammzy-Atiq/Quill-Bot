import { SYSTEM_PROMPT, userPrompt } from './prompt.js';
import { type Classifier, parseVerdict } from './types.js';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/** Google Gemini (generateContent with a JSON response). The server chooses the model. */
export const classifyWithGemini: Classifier = async (creds, input, signal) => {
  const base = creds.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  const res = await fetch(
    `${base.replace(/\/$/, '')}/models/${encodeURIComponent(creds.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': creds.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt(input) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 300 },
      }),
      signal,
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return text ? parseVerdict(text) : null;
};
