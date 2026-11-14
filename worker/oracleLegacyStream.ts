/**
 * Oracle chat's original model call, used when the tool loop is off (worker/oracleChat.ts).
 */
import { GROQ_DEFAULT_MODEL } from '../services/llm/nativeModelDefaults';
import type { ChatMessage } from './oracleAgent/modelCall';

/**
 * Today's model call: one streaming Groq request; tokens go out as they arrive. Returns the full
 * text, or null when the call failed (the error and done frames are already written).
 */
export async function streamLegacyAnswer(
  groqKey: string,
  messages: ChatMessage[],
  write: (event: string, data: unknown) => Promise<void>,
): Promise<string | null> {
  const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_DEFAULT_MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 2048,
      stream: true,
    }),
  });

  if (!llmRes.ok || !llmRes.body) {
    const errText = await llmRes.text();
    await write('error', { error: `LLM error ${llmRes.status}`, detail: errText.slice(0, 200) });
    await write('done', { ok: false });
    return null;
  }

  const reader = llmRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          await write('token', { text: delta });
        }
      } catch {
        // ignore
      }
    }
  }
  return fullText;
}
