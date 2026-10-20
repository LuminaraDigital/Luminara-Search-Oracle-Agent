const MAX_PROMPTS = 20;
const MAX_PROMPT_CHARS = 400;

/** Shared prompt-set parser for Citation Watch and Signed Audit Receipts. */
export function parsePromptList(value: unknown): { ok: true; prompts: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROMPTS) {
    return { ok: false, error: `prompts must be 1 to ${MAX_PROMPTS} strings.` };
  }
  const prompts: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, error: 'Each prompt must be a string.' };
    const text = item.trim();
    if (!text || text.length > MAX_PROMPT_CHARS) {
      return { ok: false, error: `Each prompt must be 1 to ${MAX_PROMPT_CHARS} characters.` };
    }
    prompts.push(text);
  }
  return { ok: true, prompts };
}
