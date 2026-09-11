/**
 * Shared native LLM default IDs.
 * Kept free of provider class imports so catalog + providers can share them safely.
 */

/** Groq free/dev default after llama-3.3-70b-versatile shutdown (2026-08-16). */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
export const GROQ_FALLBACK_MODELS = ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'] as const;

/** NVIDIA NIM default after llama-3.3-70b-instruct EOL (2026-08-26). */
export const NIM_DEFAULT_MODEL = 'meta/llama-3.2-11b-vision-instruct';
export const NIM_FALLBACK_MODELS = [
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.1-70b-instruct',
] as const;

export function groqModelCandidates(preferred?: string): string[] {
  const primary = (preferred && preferred.trim()) || GROQ_DEFAULT_MODEL;
  const rest = [GROQ_DEFAULT_MODEL, ...GROQ_FALLBACK_MODELS].filter((m) => m !== primary);
  return [primary, ...rest];
}

export function nimModelCandidates(preferred?: string): string[] {
  const primary = (preferred && preferred.trim()) || NIM_DEFAULT_MODEL;
  const rest = [NIM_DEFAULT_MODEL, ...NIM_FALLBACK_MODELS].filter((m) => m !== primary);
  return [primary, ...rest];
}

export function isMissingModelStatus(status: number, body: string): boolean {
  if (status !== 404 && status !== 400) return false;
  return /does not exist|not found|decommission|deprecated|no longer|unknown model|model_not_found/i.test(body);
}
