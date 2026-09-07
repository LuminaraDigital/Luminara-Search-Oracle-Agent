import { describe, expect, it } from 'vitest';
import { buildChatMessages, toChatHistory, MAX_HISTORY_TURNS } from '../services/chat/messages';

describe('buildChatMessages', () => {
  it('orders system, history, then the new prompt', () => {
    const msgs = buildChatMessages('next', {
      systemPrompt: 'sys',
      history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
    });
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[3].content).toBe('next');
  });

  it('drops empty turns and trims to the last MAX_HISTORY_TURNS', () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 5 }, (_, i) => ({ role: 'user' as const, content: `m${i}` }));
    history.push({ role: 'user', content: '   ' });
    const msgs = buildChatMessages('p', { history });
    expect(msgs).toHaveLength(MAX_HISTORY_TURNS + 1);
    expect(msgs[0].content).toBe('m5');
  });
});

describe('toChatHistory', () => {
  it('maps model to assistant and skips errors and empties', () => {
    const turns = toChatHistory([
      { role: 'user', content: 'q' },
      { role: 'model', content: 'a' },
      { role: 'model', content: 'failed', isError: true },
      { role: 'model', content: '' },
      { role: 'system', content: 'ignored' },
    ]);
    expect(turns).toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
  });
});
