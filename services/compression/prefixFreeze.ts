/**
 * Prefix Freeze & Prompt Cache Preservation
 * Adapted from OmniRoute (open-sse/services/compression/prefixFreeze.ts, MIT License).
 *
 * Ensures that static system instructions, SEO/AEO playbooks, and Business DNA
 * maintain bitwise identical prefix structures across consecutive conversation turns,
 * maximizing KV cache hits for Gemini Context Caching and Claude Prompt Caching.
 */

export interface CachedPrefixEnvelope {
  frozenPrefix: string;
  dynamicSuffix: string;
  cacheAnchorKey: string;
}

/**
 * Normalizes system playbooks and instructions into a canonical, cache-friendly prefix.
 * Strips non-deterministic timestamps and ensures consistent line endings.
 */
export function canonicalizeSystemPrefix(systemPrompt: string): string {
  if (!systemPrompt) return '';
  return systemPrompt
    .replace(/\r\n/g, '\n')
    // Remove transient runtime timestamps if any (e.g. "Current time: ...") from the frozen block
    .replace(/Current time:\s*[^\n]+/gi, '')
    // Collapse excess whitespace while maintaining markdown layout
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits prompt content into a static cacheable prefix and a dynamic query suffix.
 */
export function partitionPromptForCaching(
  systemPlaybook: string,
  dynamicContext: string,
  userQuery: string
): CachedPrefixEnvelope {
  const frozenPrefix = canonicalizeSystemPrefix(systemPlaybook);
  const dynamicSuffix = `${dynamicContext.trim()}\n\nUser Query:\n${userQuery.trim()}`.trim();
  
  // Simple fast hash for cache anchor tracking
  let hash = 0;
  for (let i = 0; i < frozenPrefix.length; i++) {
    hash = (hash << 5) - hash + frozenPrefix.charCodeAt(i);
    hash |= 0;
  }
  const cacheAnchorKey = `anchor_${Math.abs(hash).toString(16)}`;

  return {
    frozenPrefix,
    dynamicSuffix,
    cacheAnchorKey,
  };
}
