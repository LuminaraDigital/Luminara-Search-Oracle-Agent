import { configService } from '../configService';
import { GroqProvider } from '../llm/providers/GroqProvider';
import type { FallbackAnswerInfo } from '../../types';

export const AUDIT_WRITE_UNAVAILABLE =
  "The AI write-up couldn't be generated this time. Your measured results above are still accurate. Try again.";

/**
 * Instant Audit asks hosted Groq only. The worker then tries the other Groq key,
 * NVIDIA's text model, and Workers AI. The client must not walk onto the vision NIM.
 */
export async function writeHostedAuditReport(
  prompt: string,
  systemPrompt: string,
): Promise<{ text: string; answeredBy?: string; answeredByProvider?: FallbackAnswerInfo['provider'] }> {
  if (!configService.getByokKey('luminara_groq_key') && !configService.getGroqKey()) {
    throw new Error(AUDIT_WRITE_UNAVAILABLE);
  }
  try {
    const result = await new GroqProvider().generateText(prompt, {
      systemPrompt,
      temperature: 0.3,
      maxTokens: 4000,
      allowFallback: true,
    });
    const text = result.text.trim();
    if (!text) throw new Error(AUDIT_WRITE_UNAVAILABLE);
    return {
      text,
      ...(result.fallback?.model ? { answeredBy: result.fallback.model } : {}),
      ...(result.fallback?.provider ? { answeredByProvider: result.fallback.provider } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.message === AUDIT_WRITE_UNAVAILABLE) throw error;
    throw new Error(AUDIT_WRITE_UNAVAILABLE);
  }
}
