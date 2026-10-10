import { describe, expect, it } from 'vitest';
import {
  buildRouterState,
  enforceRouteGates,
  routeIntentDeterministic,
  routeIntentWithLlm,
  testChoice,
} from '../../services/evidenceBound';

describe('intent router', () => {
  it('routes interactive language to browse_interactive', () => {
    const state = buildRouterState({
      userMessage: 'Expand the FAQ accordion on pricing',
      hasProjectContext: true,
    });
    expect(routeIntentDeterministic(state).intent).toBe('browse_interactive');
  });

  it('blocks paid without context via enforceRouteGates', () => {
    const state = buildRouterState({
      userMessage: 'keywords',
      hasProjectContext: false,
    });
    const raw = routeIntentDeterministic(state);
    const gated = enforceRouteGates(
      { ...raw, intent: 'paid_research', needsProjectContext: false },
      state,
    );
    expect(gated.intent).toBe('clarify');
  });

  it('self-consistency failure on high-stakes downgrades to clarify', () => {
    const state = buildRouterState({
      userMessage: 'click cookie banner',
      hasProjectContext: true,
    });
    const gated = enforceRouteGates(
      {
        intent: 'browse_interactive',
        toolHint: 'browse_goal',
        researchLogFresh: false,
        needsProjectContext: false,
        confidence: 0.9,
        selfConsistent: false,
      },
      state,
    );
    expect(gated.intent).toBe('clarify');
  });

  it('LLM path with agreeing self-consistency keeps paid_research', async () => {
    const state = buildRouterState({
      userMessage: 'research keywords for our domain',
      hasProjectContext: true,
      offeredTools: ['research_keywords'],
    });
    const intentKeys = [
      'scrape_enough',
      'use_research_log',
      'browse_interactive',
      'paid_research',
      'clarify',
    ];
    const llm = async () =>
      JSON.stringify({
        intent: testChoice('paid_research', intentKeys),
        research_log_fresh: { noul: 0.2 },
        needs_project_context: { noul: 0.1 },
        tool_hint: testChoice('research_keywords', ['research_keywords', 'none']),
      });
    const decision = await routeIntentWithLlm({ state, llm, offeredTools: ['research_keywords'] });
    expect(decision.intent).toBe('paid_research');
    expect(decision.selfConsistent).toBe(true);
    expect(decision.toolHint).toBe('research_keywords');
  });
});
