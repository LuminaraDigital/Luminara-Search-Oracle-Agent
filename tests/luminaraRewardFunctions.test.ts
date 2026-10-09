import { describe, expect, it } from 'vitest';
import {
  calculateLuminaraReward,
  type AgentRollout,
} from '../services/rl/luminaraRewardFunctions';

describe('Luminara Multi-Objective RL Reward Functions (Pillar 4)', () => {
  it('awards high composite reward for compliant, honest, and budget-conscious rollouts', () => {
    const compliantRollout: AgentRollout = {
      taskId: 'tsk_001',
      targetDomain: 'luminarasuite.com',
      steps: [
        {
          role: 'assistant',
          toolCalls: [{ name: 'get_project_context', args: { domain: 'luminarasuite.com' } }],
        },
        {
          role: 'tool',
          toolResult: { cached: true, targetKeywords: ['AI visibility audit'] },
        },
        {
          role: 'assistant',
          toolCalls: [{ name: 'probe_crawl', args: { domain: 'luminarasuite.com' } }],
        },
        {
          role: 'tool',
          toolResult: { httpStatus: 200, sha256: 'a'.repeat(64), hasLlmTxt: true },
        },
      ],
      finalOutput: {
        verdict: 'luminarasuite.com has verified crawler access and valid llms.txt declarations.',
        oneMoveThisWeek: 'Add structured Organization sameAs links to maximize entity graph resolution.',
        evidenceTag: 'measured',
      },
      groundingCoords: {
        predicted: [500, 300],
        targetCenter: [502, 301], // 2.2px distance
      },
    };

    const reward = calculateLuminaraReward(compliantRollout);

    expect(reward.totalReward).toBeGreaterThanOrEqual(0.8);
    expect(reward.rFormat).toBe(1.0);
    expect(reward.rBudget).toBe(1.0);
    expect(reward.rHonesty).toBe(1.0);
    expect(reward.rGround).toBe(1.0);
    expect(reward.diagnostics.length).toBe(0);
  });

  it('penalizes hallucinated metrics (APS Invariant #5)', () => {
    const hallucinatingRollout: AgentRollout = {
      taskId: 'tsk_002',
      targetDomain: 'fakemetrics.com',
      steps: [
        {
          role: 'assistant',
          toolCalls: [{ name: 'probe_crawl', args: { domain: 'fakemetrics.com' } }],
        },
        {
          role: 'tool',
          toolResult: { status: 'crawl_completed', htmlSize: 1200 },
        },
      ],
      finalOutput: {
        verdict: 'Domain Authority: 85 and Search Volume: 50000 achieved.',
        oneMoveThisWeek: 'Maintain backlink velocity.',
        evidenceTag: 'estimated',
      },
    };

    const reward = calculateLuminaraReward(hallucinatingRollout);

    expect(reward.rHonesty).toBeLessThan(0.5);
    expect(reward.diagnostics.some((d) => d.includes('fabricated metric'))).toBe(true);
  });

  it('penalizes paid research tool invocation without prior context check (APS Invariant #3)', () => {
    const wastefulRollout: AgentRollout = {
      taskId: 'tsk_003',
      targetDomain: 'expensive.com',
      steps: [
        {
          role: 'assistant',
          toolCalls: [{ name: 'dataforseo_serp', args: { keyword: 'expensive seo' } }],
        },
        {
          role: 'tool',
          toolResult: { items: [] },
        },
      ],
      finalOutput: {
        verdict: 'Keywords analyzed.',
        oneMoveThisWeek: 'Improve ranking.',
        evidenceTag: 'estimated',
      },
    };

    const reward = calculateLuminaraReward(wastefulRollout);

    expect(reward.rBudget).toBeLessThanOrEqual(0.2);
    expect(reward.diagnostics.some((d) => d.includes('paid research tool invoked'))).toBe(true);
  });

  it('penalizes verbose HTML novel output (APS Invariant #4)', () => {
    const verboseRollout: AgentRollout = {
      taskId: 'tsk_004',
      targetDomain: 'novel.com',
      steps: [],
      finalOutput: {
        verdict: '<div><table><tr><td>Long HTML dump with excessive unnecessary tokens</td></tr></table></div>',
        oneMoveThisWeek: 'Read the table.',
        evidenceTag: 'estimated',
      },
    };

    const reward = calculateLuminaraReward(verboseRollout);

    expect(reward.rFormat).toBeLessThanOrEqual(0.5);
    expect(reward.diagnostics.some((d) => d.includes('raw HTML novel'))).toBe(true);
  });

  it('evaluates PointerBench GUI grounding distance in 1024x768 space', () => {
    const offTargetRollout: AgentRollout = {
      taskId: 'tsk_005',
      targetDomain: 'ui.com',
      steps: [],
      finalOutput: {
        verdict: 'Element located.',
        oneMoveThisWeek: 'Click button.',
        evidenceTag: 'measured',
      },
      groundingCoords: {
        predicted: [100, 100],
        targetCenter: [300, 300], // ~282px distance
      },
    };

    const reward = calculateLuminaraReward(offTargetRollout);

    expect(reward.rGround).toBeLessThan(0);
    expect(reward.diagnostics.some((d) => d.includes('click distance'))).toBe(true);
  });
});
