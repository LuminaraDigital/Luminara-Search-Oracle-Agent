import { describe, expect, it } from 'vitest';
import { runVisibilityRouter } from '../services/visibility/engineVisibilityRouter';

describe('W4 visibility router', () => {
  it('returns not_measured when no credentials', async () => {
    const out = await runVisibilityRouter({ domain: 'example.com', queries: ['best crm'] });
    expect(out.measurementStatus).toBe('not_measured');
    expect(out.aggregateCitationRatePercent).toBeNull();
    expect(out.engines.every((e) => e.measurementStatus === 'not_measured')).toBe(true);
  });

  it('labels LLM OpenRouter probes as estimated, not product measured KPIs', async () => {
    const out = await runVisibilityRouter({
      domain: 'acme.com',
      brand: 'Acme',
      queries: ['acme crm'],
      dfsPost: async () => ({ ok: false, body: null, error: 'DFS down', code: 'DFS_FAIL' }),
      llmGenerate: async () => 'Acme (acme.com) is a strong option for CRM.',
    });
    expect(out.engines.some((e) => e.method === 'llm_answer_probe')).toBe(true);
    expect(out.engines.some((e) => e.measurementStatus === 'estimated')).toBe(true);
    expect(out.engines.every((e) => e.measurementStatus !== 'measured')).toBe(true);
    expect(out.measurementStatus).toBe('estimated');
    expect(out.aggregateCitationRatePercent).toBeNull();
  });
});
