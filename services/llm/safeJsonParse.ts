/**
 * Defensive JSON parser for open-weight models (NVIDIA NIM, Groq, Ollama).
 * Strips reasoning tokens (<think>...</think>), markdown code fences (```json ... ```),
 * removes extraneous commentary, and safely extracts structured JSON payloads.
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  if (!text || typeof text !== 'string') return fallback;
  // Strip reasoning model thought blocks (<think>...</think>) from DeepSeek-R1 / QwQ
  let trimmed = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (trimmed.includes('<think>')) {
    trimmed = trimmed.replace(/<think>[\s\S]*$/gi, '').trim();
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim()) as T;
      } catch {}
    }

    // 2. Extract substring between first '{' and last '}'
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
      } catch {}
    }

    // 3. Extract substring between first '[' and last ']'
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as T;
      } catch {}
    }

    return fallback;
  }
}
