/**
 * Pure helpers deciding when a prompt deserves a live SERP lookup and how to shape the query.
 * Kept dependency-free so they can be unit-tested and reused by the Worker later.
 */

const SEARCH_INTENT = /https?:\/\/|\bwww\.|\.[a-z]{2,6}(\/|\b)|\b(audit|rank|ranking|serp|seo|aeo|geo|competitor|competitors|visibility|schema|backlink|keyword|keywords|market|trend|trends|latest|news|price|pricing|review|reviews|compare|comparison|benchmark|citation|cited|search|google|chatgpt|perplexity|ai overview|ai answer|overview|answer|answers|traffic|domain|site|website|brand)\b/i;

/** Fetch live SERP evidence only for research-style prompts, not small talk or rewrites. */
export const shouldSearch = (prompt: string): boolean => {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  return words >= 3 && SEARCH_INTENT.test(prompt);
};

// Tavily rejects queries over 400 characters; keep the lookup to the leading intent.
export const MAX_SEARCH_QUERY_CHARS = 380;

export const toSearchQuery = (prompt: string): string =>
  prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_QUERY_CHARS);
