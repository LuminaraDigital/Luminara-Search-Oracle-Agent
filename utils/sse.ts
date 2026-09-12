/**
 * Server-Sent Events (SSE) stream parsing utilities for OpenAI-compatible LLM streaming endpoints.
 */

export interface SseChunk {
  text?: string;
  raw?: any;
}

/**
 * Parses raw SSE response into string event payloads (lines following 'data: ').
 * Terminates automatically when '[DONE]' sentinel is encountered.
 */
export async function* parseSseDataLines(response: Response): AsyncIterable<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') return;
        yield dataStr;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses an OpenAI-compatible SSE text stream (Groq, NVIDIA NIM, FreeLLM, OpenRouter, Ollama).
 * Yields extracted delta content tokens.
 */
export async function* parseOpenAiSseStream(response: Response): AsyncIterable<SseChunk> {
  for await (const dataStr of parseSseDataLines(response)) {
    try {
      const parsed = JSON.parse(dataStr);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        yield { text: delta, raw: parsed };
      }
    } catch {
      // Ignore parse errors on partial stream chunks
    }
  }
}
