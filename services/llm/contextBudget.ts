/**
 * Context Budgeting and Trimming for LLM Providers
 * Enforces strict token ceilings to avoid TPM / 413 "Request too large" limits (e.g. Groq 8000 TPM limit).
 */

export interface ContextComponents {
  systemPrompt: string;
  userPrompt: string;
  history?: Array<{ role: string; content: string }>;
  vfsContext?: string;
  chatPlaybooks?: string;
  groundedSnippets?: Array<{ uri: string; title: string; content?: string; score?: number }>;
  dnaContext?: string;
}

export interface BudgetedContext {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  fullPrompt: string;
  estimatedPromptTokens: number;
  maxTokens: number;
  trimmedItems: string[];
}

export interface ProviderBudgetConfig {
  maxPromptTokens: number;
  defaultMaxTokens: number;
  deepThinkMaxTokens: number;
}

export const PROVIDER_BUDGETS: Record<string, ProviderBudgetConfig> = {
  groq: {
    maxPromptTokens: 5200, // 8000 TPM limit minus 1024-2048 max_tokens buffer
    defaultMaxTokens: 1024,
    deepThinkMaxTokens: 2048,
  },
  nim: {
    maxPromptTokens: 6000,
    defaultMaxTokens: 1024,
    deepThinkMaxTokens: 2048,
  },
  ollama: {
    maxPromptTokens: 4096,
    defaultMaxTokens: 1024,
    deepThinkMaxTokens: 2048,
  },
  default: {
    maxPromptTokens: 5000,
    defaultMaxTokens: 1024,
    deepThinkMaxTokens: 2048,
  },
};

/** Approximate token estimation: ~4 chars per token */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Budget and trim context components to guarantee they stay within provider limits.
 *
 * Trimming Priority Order (least essential cut first):
 * 1. history (oldest turns dropped first)
 * 2. vfsContext (dropped or trimmed)
 * 3. chatPlaybooks (dropped or trimmed)
 * 4. groundedSnippets (tail snippets dropped, keeping top-k)
 * 5. dnaContext summary (condensed/truncated if still over)
 *
 * SYSTEM INSTRUCTIONS AND USER DIRECTIVE ARE NEVER CUT.
 */
export function budgetContext(
  components: ContextComponents,
  opts?: {
    providerId?: string;
    isDeepThink?: boolean;
    maxPromptTokens?: number;
    maxTokens?: number;
  },
): BudgetedContext {
  const providerKey = opts?.providerId?.toLowerCase() || 'default';
  const cfg = PROVIDER_BUDGETS[providerKey] || PROVIDER_BUDGETS.default;

  const maxTokens = opts?.maxTokens ?? (opts?.isDeepThink ? cfg.deepThinkMaxTokens : cfg.defaultMaxTokens);
  const targetPromptTokens = opts?.maxPromptTokens ?? cfg.maxPromptTokens;

  const systemPrompt = components.systemPrompt || '';
  const userPrompt = components.userPrompt || '';
  const trimmedItems: string[] = [];

  // Essential baseline: system instructions + user directive (never cut)
  const baseTokens = estimateTokens(systemPrompt) + estimateTokens(userPrompt);

  let remainingTokens = Math.max(0, targetPromptTokens - baseTokens);

  // 1. History
  let history = components.history ? [...components.history] : [];
  // 2. VFS context
  let vfsContext = components.vfsContext || '';
  // 3. Chat playbooks
  let chatPlaybooks = components.chatPlaybooks || '';
  // 4. Grounded snippets
  let snippets = components.groundedSnippets ? [...components.groundedSnippets] : [];
  // Sort snippets by score if available (descending)
  snippets.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // 5. DNA context
  let dnaContext = components.dnaContext || '';

  const calcCurrentTokens = (): number => {
    let t = baseTokens;
    for (const h of history) t += estimateTokens(h.content);
    if (vfsContext) t += estimateTokens(vfsContext);
    if (chatPlaybooks) t += estimateTokens(chatPlaybooks);
    for (const s of snippets) t += estimateTokens(`${s.title}\n${s.uri}\n${s.content || ''}`);
    if (dnaContext) t += estimateTokens(dnaContext);
    return t;
  };

  // Trimming loop: drop in strict priority order if over budget
  // Priority 1: Drop oldest history turns first
  while (calcCurrentTokens() > targetPromptTokens && history.length > 0) {
    history.shift();
    if (!trimmedItems.includes('history')) trimmedItems.push('history');
  }

  // Priority 2: Drop VFS context
  if (calcCurrentTokens() > targetPromptTokens && vfsContext) {
    vfsContext = '';
    trimmedItems.push('vfsContext');
  }

  // Priority 3: Drop Chat Playbooks
  if (calcCurrentTokens() > targetPromptTokens && chatPlaybooks) {
    chatPlaybooks = '';
    trimmedItems.push('chatPlaybooks');
  }

  // Priority 4: Drop lowest-ranked grounded snippets
  while (calcCurrentTokens() > targetPromptTokens && snippets.length > 0) {
    snippets.pop();
    if (!trimmedItems.includes('groundedSnippets')) trimmedItems.push('groundedSnippets');
  }

  // Priority 5: Trim DNA context if still over budget
  if (calcCurrentTokens() > targetPromptTokens && dnaContext) {
    const currentWithoutDna = calcCurrentTokens() - estimateTokens(dnaContext);
    const availableForDna = Math.max(0, targetPromptTokens - currentWithoutDna);
    if (availableForDna < 50) {
      dnaContext = '';
      trimmedItems.push('dnaContext');
    } else {
      const maxChars = availableForDna * 4;
      if (dnaContext.length > maxChars) {
        dnaContext = dnaContext.slice(0, maxChars) + '...';
        trimmedItems.push('dnaContext_truncated');
      }
    }
  }

  // Assemble grounded search string
  let groundedText = '';
  if (snippets.length > 0) {
    groundedText = snippets
      .map(s => `[${s.title}] (${s.uri})\n${s.content || ''}`)
      .join('\n\n');
  }

  // Assemble fullPrompt
  const parts: string[] = [];
  if (dnaContext) parts.push(dnaContext);
  if (chatPlaybooks) parts.push(chatPlaybooks);
  if (vfsContext) parts.push(vfsContext);
  if (groundedText) parts.push(groundedText);
  parts.push(`USER DIRECTIVE:\n${userPrompt}`);
  const fullPrompt = parts.join('\n\n');

  // Assemble messages array for chat completion format
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  for (const h of history) {
    messages.push(h);
  }
  messages.push({ role: 'user', content: fullPrompt });

  const estimatedPromptTokens = estimateTokens(systemPrompt) + estimateTokens(fullPrompt);

  return {
    systemPrompt,
    messages,
    fullPrompt,
    estimatedPromptTokens,
    maxTokens,
    trimmedItems,
  };
}
