/**
 * Offline measurement harness: naive full-tree loop stub vs indexed DOM action loop.
 * No live browser. Counts CDP/protocol-equivalent units for a fixed fixture goal.
 *
 * Run: npx vitest run tests/browserActionMeasure.test.ts
 */
import { describe, expect, it } from 'vitest';
import {
  BrowserActionLoop,
  buildActionSpace,
  verifyDone,
  type ObservePayload,
  type ObservedAction,
} from '../services/browserAction';

/** Simulated CDP units: naive walks the whole tree; indexed uses one evaluate + input. */
const NAIVE_TREE_NODES = 80;
const NAIVE_CDP_PER_NODE = 2; // attrs + box model
const NAIVE_SCREENSHOT_CDP = 8;
const NAIVE_ACT_CDP = 4;
const INDEXED_OBSERVE_CDP = 3; // single in-page evaluate snapshot
const INDEXED_ACT_CDP = 4; // hit-test resolve + input
const INDEXED_REOBSERVE_CDP = 3;

const FIXTURE_ACTIONS: ObservedAction[] = [
  { id: 'e1', kind: 'fill', label: 'Query', role: 'textbox', value: '', node: 'n_q' },
  {
    id: 'e2',
    kind: 'select',
    label: 'Tier → Agency',
    role: 'option',
    value: 'agency',
    current_value: 'growth',
    node: 'n_tier',
  },
  { id: 'e3', kind: 'click', label: 'Go', role: 'button', node: 'n_go' },
  { id: 'e4', kind: 'click', label: 'What is indexed browse?', role: 'button', node: 'n_faq' },
  { id: 'wait', kind: 'wait', label: 'Wait', node: 'wait' },
];

function page(text: string, fingerprint: string, actions = FIXTURE_ACTIONS): ObservePayload {
  return {
    url: 'https://fixture.example/browse',
    title: 'Luminara Browse Fixture',
    text,
    actions,
    fingerprint,
  };
}

/**
 * Naive baseline: every step re-walks a large a11y/DOM tree + screenshot + act.
 * Mirrors the cost shape Jev reduced (many CDP calls per step), not a live CDP trace.
 */
function runNaiveFullTreeLoop(goalSteps: string[]): {
  protocolCalls: number;
  wallMs: number;
  finalText: string;
} {
  const t0 = performance.now();
  let protocolCalls = 0;
  let text = 'FAQ accordion closed. Tier Growth.';
  for (const step of goalSteps) {
    protocolCalls += NAIVE_TREE_NODES * NAIVE_CDP_PER_NODE;
    protocolCalls += NAIVE_SCREENSHOT_CDP;
    protocolCalls += NAIVE_ACT_CDP;
    void page(text, `naive-${step}`).actions.length;
    if (step === 'fill') text += ' Query=indexed';
    if (step === 'select') text += ' Tier=Agency';
    if (step === 'click-go') text += ' Submitted indexed on agency';
    if (step === 'faq') text += ' Agents observe numbered controls and act by id only.';
  }
  return { protocolCalls, wallMs: performance.now() - t0, finalText: text };
}

/**
 * Indexed path: capped action table via one evaluate; act by id; re-observe after mutation.
 */
async function runIndexedLoop(): Promise<{
  protocolCalls: number;
  wallMs: number;
  verifyOk: boolean;
  status: string;
}> {
  const t0 = performance.now();
  let protocolCalls = 0;
  let text = 'FAQ accordion closed. Tier Growth.';
  let fp = 0;
  let current = page(text, `idx-${fp}`);

  const script: Array<{ choice: string; operation: string; target: string | null }> = [
    { choice: 'e1', operation: 'TYPE_TEXT', target: '1' },
    { choice: 'e2', operation: 'SELECT', target: '2:1' },
    { choice: 'e3', operation: 'CLICK', target: '3' },
    { choice: 'e4', operation: 'CLICK', target: '4' },
    { choice: 'DONE', operation: 'DONE', target: null },
  ];
  let i = 0;

  protocolCalls += INDEXED_OBSERVE_CDP;
  const space = buildActionSpace(current.actions);
  expect(Object.keys(space.targets.CLICK || {}).length).toBeGreaterThan(0);

  const loop = new BrowserActionLoop({
    goal: 'Fill query, select Agency, click Go, expand FAQ',
    initialPage: current,
    maxSteps: 15,
    observe: async () => {
      protocolCalls += INDEXED_OBSERVE_CDP;
      current = page(text, `idx-${++fp}`);
      return current;
    },
    executeAct: async (req) => {
      protocolCalls += INDEXED_ACT_CDP;
      if (req.actionId === 'e1') text += ' Query=indexed';
      if (req.actionId === 'e2') text += ' Tier=Agency';
      if (req.actionId === 'e3') text += ' Submitted indexed on agency';
      if (req.actionId === 'e4') text += ' Agents observe numbered controls and act by id only.';
      current = page(text, `idx-${++fp}`);
      protocolCalls += INDEXED_REOBSERVE_CDP;
      return current;
    },
    chooseFn: async () => {
      const step = script[i++]!;
      return {
        choice: step.choice,
        operation: step.operation,
        target: step.target,
        confidence: 1,
        probabilities: { [step.choice]: 1 },
        operation_probabilities: { [step.operation]: 1 },
      };
    },
    fieldLlm: async () => '{"text":"indexed"}',
  });

  while (loop.state.status !== 'done' && loop.state.status !== 'blocked' && i < script.length) {
    await loop.tick();
  }

  const verify = verifyDone({
    goal: 'Fill query, select Agency, click Go, expand FAQ',
    observe: loop.state.page,
    checks: {
      textIncludes: ['Query=indexed', 'Tier=Agency', 'Submitted indexed', 'numbered controls'],
    },
  });

  return {
    protocolCalls,
    wallMs: performance.now() - t0,
    verifyOk: verify.ok,
    status: loop.state.status,
  };
}

describe('browserAction measurement harness (B5)', () => {
  it('indexed path uses ≥5× fewer protocol units than naive full-tree stub on fixture goal', async () => {
    const goalSteps = ['fill', 'select', 'click-go', 'faq'];
    const naive = runNaiveFullTreeLoop(goalSteps);
    const indexed = await runIndexedLoop();

    expect(indexed.verifyOk).toBe(true);
    expect(indexed.status).toBe('done');
    expect(naive.protocolCalls).toBeGreaterThan(0);
    expect(indexed.protocolCalls).toBeGreaterThan(0);

    const reduction = naive.protocolCalls / indexed.protocolCalls;
    // Gate before any product "10x" copy. Fixture-only; not a hosted SLA.
    expect(reduction).toBeGreaterThanOrEqual(5);

    expect({
      naiveProtocolCalls: naive.protocolCalls,
      indexedProtocolCalls: indexed.protocolCalls,
      reduction: Number(reduction.toFixed(2)),
      verifier: indexed.verifyOk ? 'pass' : 'fail',
    }).toMatchObject({ verifier: 'pass' });
  });
});
