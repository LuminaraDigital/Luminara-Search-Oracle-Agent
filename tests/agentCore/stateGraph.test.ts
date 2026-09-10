import { describe, it, expect } from 'vitest';
import { StateGraph, END_NODE } from '../../services/agentCore/stateGraph';
import { AgentActivityEvent } from '../../services/agentCore/types';

describe('StateGraph (LangGraph-inspired Edge State Machine)', () => {
  it('should execute a linear pipeline across nodes', async () => {
    interface TestContext {
      count: number;
      log: string[];
    }

    const graph = new StateGraph<TestContext>({ maxIterations: 10 });

    graph.addNode('step1', 'Step 1', async (ctx) => {
      return { count: ctx.count + 1, log: [...ctx.log, 'step1'] };
    });

    graph.addNode('step2', 'Step 2', async (ctx) => {
      return { count: ctx.count * 2, log: [...ctx.log, 'step2'] };
    });

    graph.setEntryPoint('step1');
    graph.addEdge('step1', 'step2');
    graph.addEdge('step2', END_NODE);

    const { finalContext, checkpoints } = await graph.run({ count: 5, log: [] });

    expect(finalContext.count).toBe(12); // (5 + 1) * 2 = 12
    expect(finalContext.log).toEqual(['step1', 'step2']);
    expect(checkpoints.length).toBe(3); // step1, step2, END
  });

  it('should handle dynamic conditional edges (critic loop)', async () => {
    interface TestContext {
      score: number;
      loopCount: number;
    }

    const graph = new StateGraph<TestContext>({ maxIterations: 5 });

    graph.addNode('auditor', 'Auditor', async (ctx) => {
      return { score: ctx.score + 10, loopCount: ctx.loopCount + 1 };
    });

    graph.addNode('critic', 'Critic', async (ctx) => {
      return {};
    });

    graph.setEntryPoint('auditor');
    graph.addEdge('auditor', 'critic');
    graph.addConditionalEdge('critic', (ctx) => {
      if (ctx.score < 30) {
        return 'auditor'; // loop back
      }
      return END_NODE;
    });

    const { finalContext } = await graph.run({ score: 0, loopCount: 0 });

    expect(finalContext.score).toBe(30);
    expect(finalContext.loopCount).toBe(3);
  });

  it('should emit real-time activity events to observers', async () => {
    const graph = new StateGraph<{ done: boolean }>();
    const emitted: AgentActivityEvent[] = [];

    graph.addNode('worker', 'Worker', async (_ctx, emit) => {
      emit({
        id: 'ev-1',
        timestamp: Date.now(),
        agentRole: 'scout',
        agentName: 'Scout Agent',
        phase: 'crawling',
        message: 'Crawling target domain…',
        status: 'running',
      });
      return { done: true };
    });

    graph.setEntryPoint('worker');
    graph.addEdge('worker', END_NODE);

    await graph.run({ done: false }, (ev) => emitted.push(ev));

    expect(emitted.length).toBe(1);
    expect(emitted[0].message).toBe('Crawling target domain…');
  });
});
