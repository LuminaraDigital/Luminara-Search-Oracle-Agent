import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessagesTokens,
  needsCompaction,
  pruneMultimodalImages,
  formatCompactSummary,
  synthesizeSummaryFromMessages,
  compactConversation,
} from '../services/oracle/contextCompactorService';
import { Message } from '../types';

describe('ContextCompactorService', () => {
  it('estimates tokens proportionally to character length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);

    const msgs: Message[] = [{ id: '1', role: 'user', content: 'hello world', timestamp: 1 }];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });

  it('detects when compaction is required above threshold', () => {
    const smallMessages: Message[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'world', timestamp: 2 },
    ];
    // <= 4 messages should not compact
    expect(needsCompaction(smallMessages, 1000, 80)).toBe(false);

    // Large history exceeding limit
    const bigMessages: Message[] = [
      { id: '1', role: 'user', content: 'x'.repeat(2000), timestamp: 1 },
      { id: '2', role: 'assistant', content: 'y'.repeat(2000), timestamp: 2 },
      { id: '3', role: 'user', content: 'z'.repeat(2000), timestamp: 3 },
      { id: '4', role: 'assistant', content: 'w'.repeat(2000), timestamp: 4 },
      { id: '5', role: 'user', content: 'q'.repeat(2000), timestamp: 5 },
    ];
    // Total tokens: ~2500 tokens. Context limit: 2000 tokens. Threshold: 80% (1600 tokens).
    expect(needsCompaction(bigMessages, 2000, 80)).toBe(true);
  });

  it('prunes multimodal images uniformly across history', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'step 1',
        timestamp: 1,
        groundingUrls: [
          { uri: 'img1.png', title: 'Image 1' },
          { uri: 'img2.png', title: 'Image 2' },
        ],
      },
      {
        id: '2',
        role: 'assistant',
        content: 'step 2',
        timestamp: 2,
        groundingUrls: [
          { uri: 'img3.png', title: 'Image 3' },
          { uri: 'img4.png', title: 'Image 4' },
          { uri: 'img5.png', title: 'Image 5' },
        ],
      },
    ];

    const pruned = pruneMultimodalImages(messages, 2);
    const totalRemaining = pruned.reduce(
      (sum, m) => sum + (m.groundingUrls?.length || 0),
      0
    );
    expect(totalRemaining).toBeLessThanOrEqual(2);
  });

  it('synthesizes structured summary and formats compact context', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'Audit https://example.com for AEO citations',
        timestamp: 1,
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Analyzing search visibility and schema.',
        timestamp: 2,
        toolExecutions: [
          { tool: 'llm_crawler', output: 'Fetched 200 OK' },
        ],
      },
    ];

    const summary = synthesizeSummaryFromMessages(messages);
    expect(summary.userGoal).toContain('example.com');
    expect(summary.whatWasDone.some(a => a.includes('llm_crawler'))).toBe(true);

    const formatted = formatCompactSummary(summary);
    expect(formatted).toContain('[CONVERSATION COMPACTED CONTEXT]');
    expect(formatted).toContain('### User Goal');
  });

  it('compacts conversation keeping recent turns intact', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Turn 1: ' + 'x'.repeat(1000), timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Turn 2: ' + 'x'.repeat(1000), timestamp: 2 },
      { id: '3', role: 'user', content: 'Turn 3: ' + 'x'.repeat(1000), timestamp: 3 },
      { id: '4', role: 'assistant', content: 'Turn 4: ' + 'x'.repeat(1000), timestamp: 4 },
      { id: '5', role: 'user', content: 'Turn 5: ' + 'x'.repeat(1000), timestamp: 5 },
      { id: '6', role: 'assistant', content: 'Recent response', timestamp: 6 },
    ];

    const result = compactConversation(messages, {
      contextLimitTokens: 1000,
      thresholdPercent: 50,
      recentTurnsToKeep: 2,
    });

    expect(result.compacted).toBe(true);
    expect(result.messages.length).toBe(3); // 1 summary system message + 2 recent turns
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[2].content).toBe('Recent response');
  });
});
