/**
 * Heuristic token estimation utilities for context-window budgeting.
 * Provides fast approximation for open-weight & proprietary LLMs.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const charBased = Math.ceil(text.length / 3.8);
  const wordBased = Math.ceil(words.length * 1.3);
  return Math.max(1, Math.round((charBased + wordBased) / 2));
}

/**
 * Fast character-based fallback estimation (1 token ≈ 4 characters).
 */
export function estimateTokensFast(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
