import { describe, expect, it } from 'vitest';
import { budgetContext, estimateTokens, PROVIDER_BUDGETS } from '../services/llm/contextBudget';

describe('Context Budget & Trimming (services/llm/contextBudget.ts)', () => {
  it('preserves system prompt and user directive under all circumstances', () => {
    const systemPrompt = 'You are Luminara Oracle. Always cite verified evidence.';
    const userPrompt = 'What is the speed of light?';

    const result = budgetContext(
      {
        systemPrompt,
        userPrompt,
        history: [{ role: 'user', content: 'Old question 1' }, { role: 'assistant', content: 'Old answer 1' }],
        vfsContext: 'Large VFS context '.repeat(500),
      },
      { maxPromptTokens: 100 }, // Extremely tight budget
    );

    expect(result.systemPrompt).toBe(systemPrompt);
    expect(result.fullPrompt).toContain(`USER DIRECTIVE:\n${userPrompt}`);
    expect(result.trimmedItems).toContain('history');
    expect(result.trimmedItems).toContain('vfsContext');
  });

  it('trims in strict priority order: history -> vfsContext -> chatPlaybooks -> groundedSnippets -> dnaContext', () => {
    const systemPrompt = 'System';
    const userPrompt = 'Prompt';
    const history = [
      { role: 'user', content: 'H1 '.repeat(200) },
      { role: 'assistant', content: 'H2 '.repeat(200) },
    ];
    const vfsContext = 'VFS '.repeat(300);
    const chatPlaybooks = 'Playbooks '.repeat(300);
    const groundedSnippets = [
      { uri: 'https://ex1.com', title: 'Ex 1', content: 'Content 1 '.repeat(100), score: 0.9 },
      { uri: 'https://ex2.com', title: 'Ex 2', content: 'Content 2 '.repeat(100), score: 0.5 },
    ];
    const dnaContext = 'DNA '.repeat(100);

    // Target a token budget that allows system, user, DNA, and snippets, but forces history and VFS to be dropped
    const result = budgetContext(
      {
        systemPrompt,
        userPrompt,
        history,
        vfsContext,
        chatPlaybooks,
        groundedSnippets,
        dnaContext,
      },
      { maxPromptTokens: 800 },
    );

    // History and VFS should be trimmed before DNA
    expect(result.trimmedItems).toContain('history');
    expect(result.trimmedItems).toContain('vfsContext');
    expect(result.fullPrompt).toContain('USER DIRECTIVE:\nPrompt');
  });

  it('keeps Groq prompt and max_tokens within Groq on-demand TPM limits', () => {
    const result = budgetContext(
      {
        systemPrompt: 'System '.repeat(100),
        userPrompt: 'Tell me about SEO in one sentence',
      },
      { providerId: 'groq' },
    );

    expect(result.maxTokens).toBe(1024);
    expect(result.estimatedPromptTokens + result.maxTokens).toBeLessThan(8000);
  });

  it('uses 2048 maxTokens for deep think mode', () => {
    const result = budgetContext(
      {
        systemPrompt: 'System',
        userPrompt: 'Deep audit reasoning',
      },
      { providerId: 'groq', isDeepThink: true },
    );

    expect(result.maxTokens).toBe(2048);
  });
});
