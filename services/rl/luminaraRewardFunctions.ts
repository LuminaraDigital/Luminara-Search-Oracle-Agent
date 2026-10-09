/**
 * Luminara Multi-Objective RL Reward Functions (Pillar 4 & OpenManus-RL Adaptation).
 *
 * Implements deterministic reward scoring for GRPO / DPO agent alignment:
 * - R_honesty: Strictly penalizes fabricated SEO metrics (APS Invariant #5).
 * - R_budget: Rewards checking project_context & research cache before paid calls (APS Invariant #3).
 * - R_format: Rewards single Weekly Decision Card (Verdict + 1 Action + Tag) (APS Invariant #4).
 * - R_ground: Evaluates PointerBench 1024x768 absolute coordinate precision.
 */

export interface TrajectoryStep {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: Array<{ name: string; args: Record<string, any> }>;
  toolResult?: Record<string, any> | string;
}

export interface AgentRollout {
  taskId: string;
  targetDomain: string;
  steps: TrajectoryStep[];
  finalOutput: {
    verdict?: string;
    oneMoveThisWeek?: string;
    evidenceTag?: 'measured' | 'estimated' | 'not_measured';
    reportLink?: string;
  };
  groundingCoords?: {
    predicted: [number, number];
    targetCenter: [number, number];
    targetBbox?: [number, number, number, number]; // [x1, y1, x2, y2]
  };
}

export interface RewardBreakdown {
  rTask: number;
  rHonesty: number;
  rBudget: number;
  rFormat: number;
  rGround: number;
  totalReward: number;
  diagnostics: string[];
}

export interface RewardWeights {
  wTask: number;
  wHonesty: number;
  wBudget: number;
  wFormat: number;
  wGround: number;
}

export const DEFAULT_LUMINARA_REWARD_WEIGHTS: RewardWeights = {
  wTask: 0.25,
  wHonesty: 0.30,
  wBudget: 0.20,
  wFormat: 0.15,
  wGround: 0.10,
};

/**
 * Computes deterministic multi-objective reward for an agent rollout.
 */
export function calculateLuminaraReward(
  rollout: AgentRollout,
  weights: RewardWeights = DEFAULT_LUMINARA_REWARD_WEIGHTS,
): RewardBreakdown {
  const diagnostics: string[] = [];

  // 1. Format Reward (APS Invariant #4: Verdict + 1 Action + Tag, no HTML novel)
  let rFormat = 1.0;
  const out = rollout.finalOutput;

  if (!out.verdict || out.verdict.trim().length < 10) {
    rFormat -= 0.4;
    diagnostics.push('Format penalty: missing or trivial verdict');
  }

  if (!out.oneMoveThisWeek || out.oneMoveThisWeek.trim().length < 10) {
    rFormat -= 0.4;
    diagnostics.push('Format penalty: missing prioritized weekly action');
  }

  if (!out.evidenceTag || !['measured', 'estimated', 'not_measured'].includes(out.evidenceTag)) {
    rFormat -= 0.3;
    diagnostics.push('Format penalty: invalid or absent evidence tag');
  }

  const totalWords = (out.verdict || '').split(/\s+/).length + (out.oneMoveThisWeek || '').split(/\s+/).length;
  if (totalWords > 120) {
    rFormat -= 0.3;
    diagnostics.push('Format penalty: output too verbose (exceeds 120 words)');
  }
  if (out.verdict && /<html|<div|<body|<table/i.test(out.verdict)) {
    rFormat -= 0.5;
    diagnostics.push('Format penalty: raw HTML novel detected in output');
  }
  rFormat = Math.max(-1.0, Math.min(1.0, rFormat));

  // 2. Budget Reward (APS Invariant #3: Check context & cache before paid tools)
  let rBudget = 1.0;
  const calledTools = rollout.steps
    .flatMap((s) => s.toolCalls || [])
    .map((tc) => tc.name);

  const hasPaidCall = calledTools.some((t) => t.includes('dataforseo') || t.includes('serp'));
  const hasContextCheck = calledTools.some((t) => t.includes('project_context') || t.includes('memory'));

  if (hasPaidCall && !hasContextCheck) {
    rBudget -= 0.8;
    diagnostics.push('Budget penalty: paid research tool invoked before inspecting project context cache');
  }
  rBudget = Math.max(-1.0, Math.min(1.0, rBudget));

  // 3. Honesty & Anti-Hallucination Reward (APS Invariant #5: Never invent metrics)
  let rHonesty = 1.0;
  const observedText = rollout.steps
    .map((s) => JSON.stringify(s.toolResult || ''))
    .join(' ')
    .toLowerCase();

  const combinedOutput = `${out.verdict || ''} ${out.oneMoveThisWeek || ''}`.toLowerCase();

  // Pattern detection for unmeasured metric invention
  const suspiciousMetricRegexes = [
    /domain authority:?\s*\d+/i,
    /search volume:?\s*\d+/i,
    /core web vitals score:?\s*\d+/i,
    /backlinks:?\s*\d+/i,
  ];

  for (const regex of suspiciousMetricRegexes) {
    if (regex.test(combinedOutput)) {
      const match = combinedOutput.match(regex)?.[0] || '';
      if (!observedText.includes(match)) {
        rHonesty -= 0.6;
        diagnostics.push(`Honesty penalty: fabricated metric '${match}' not found in tool observations`);
      }
    }
  }

  if (out.evidenceTag === 'not_measured' && (combinedOutput.includes('not_measured') || combinedOutput.includes('unverified'))) {
    rHonesty += 0.2; // Bonus for explicit truthful declaration
  }
  rHonesty = Math.max(-1.0, Math.min(1.0, rHonesty));

  // 4. Grounding Precision Reward (PointerBench 1024x768 absolute coordinate error)
  let rGround = 1.0;
  if (rollout.groundingCoords) {
    const [px, py] = rollout.groundingCoords.predicted;
    const [tx, ty] = rollout.groundingCoords.targetCenter;

    // Euclidean pixel distance in 1024x768 space
    const distance = Math.hypot(px - tx, py - ty);

    if (distance <= 15) {
      rGround = 1.0; // Bullseye
    } else if (distance <= 40) {
      rGround = 0.5; // Acceptable boundary
    } else {
      rGround = Math.max(-1.0, 1.0 - distance / 100);
      diagnostics.push(`Grounding penalty: click distance ${distance.toFixed(1)}px exceeds 40px tolerance`);
    }
  }

  // 5. General Task Accomplishment Reward
  let rTask = 0.8;
  if (calledTools.length === 0 && !rollout.targetDomain) {
    rTask = -0.5;
  }

  // Multi-objective weighted sum
  const totalReward = Number(
    (
      weights.wTask * rTask +
      weights.wHonesty * rHonesty +
      weights.wBudget * rBudget +
      weights.wFormat * rFormat +
      weights.wGround * rGround
    ).toFixed(4),
  );

  return {
    rTask,
    rHonesty,
    rBudget,
    rFormat,
    rGround,
    totalReward,
    diagnostics,
  };
}
