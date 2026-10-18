/**
 * Offline replay for audit, probe, and ranking strategies.
 *
 * The idea of scoring a new strategy on outcomes that were already logged,
 * and of refusing a switch that does not beat the strategy already in use,
 * is from Zheng et al., "Dream-RSI: Recursive Self-Improvement through
 * Evolving Worlds", arXiv:2609.14858 (https://arxiv.org/abs/2609.14858).
 * Dream-RSI publishes no licence we can reuse. This file copies none of
 * its text, math, or code. The nodes here are Luminara audit, probe, and
 * ranking logs, not that paper's discovery trees.
 */

export type ReplayKind = 'audit' | 'probe' | 'ranking';

export interface ReplayNode {
  id: string;
  domain: string;
  kind: ReplayKind;
  strategyId: string;
  outcomeScore: number | null;
  cost: number;
  createdAt: number;
}

export interface StrategyScore {
  strategyId: string;
  covered: number;
  notMeasured: number;
  mean: number | null;
  totalCost: number;
}

export const RSI_REPLAY_MIN_COVERED = 3;

export function scoreStrategyOnHistory(strategyId: string, nodes: readonly ReplayNode[]): StrategyScore {
  const mine = nodes.filter((node) => node.strategyId === strategyId);
  const measured = mine.filter((node) => node.outcomeScore != null && Number.isFinite(node.outcomeScore));
  const mean = measured.length === 0 ? null : measured.reduce((sum, node) => sum + (node.outcomeScore as number), 0) / measured.length;
  return {
    strategyId,
    covered: measured.length,
    notMeasured: mine.length - measured.length,
    mean,
    totalCost: mine.reduce((sum, node) => sum + (Number.isFinite(node.cost) ? node.cost : 0), 0),
  };
}

export function selectReplayStrategy(input: {
  currentId: string;
  candidateIds: readonly string[];
  nodes: readonly ReplayNode[];
  pinned: boolean;
  promotionsThisWeek: number;
  minCovered?: number;
}): { chosen: string; changed: boolean; reason: string; scores: StrategyScore[] } {
  const ids = [...new Set([input.currentId, ...input.candidateIds.map((id) => id.trim()).filter(Boolean)])];
  const scores = ids.map((id) => scoreStrategyOnHistory(id, input.nodes));
  const current = scores.find((score) => score.strategyId === input.currentId)!;
  if (input.pinned) {
    return { chosen: input.currentId, changed: false, reason: 'Pinned strategies stay fixed until a person unpins them.', scores };
  }
  if (input.promotionsThisWeek >= 1) {
    return { chosen: input.currentId, changed: false, reason: 'Change cap reached (1 strategy enable per week).', scores };
  }
  const minCovered = input.minCovered ?? RSI_REPLAY_MIN_COVERED;
  if (current.mean == null || current.covered < minCovered) {
    return {
      chosen: input.currentId,
      changed: false,
      reason: 'Current strategy does not have enough measured history to compare. Evidence: not_measured.',
      scores,
    };
  }
  const challengers = scores
    .filter((score) => score.strategyId !== input.currentId)
    .filter((score) => score.mean != null && score.covered >= minCovered && (score.mean as number) > (current.mean as number));
  challengers.sort((a, b) => (b.mean as number) - (a.mean as number) || a.totalCost - b.totalCost);
  const winner = challengers[0];
  if (!winner) {
    return { chosen: input.currentId, changed: false, reason: 'No candidate beat the current strategy on measured history.', scores };
  }
  return {
    chosen: winner.strategyId,
    changed: true,
    reason: `Enabled ${winner.strategyId} because its replay mean beat ${input.currentId} on ${winner.covered} measured runs.`,
    scores,
  };
}
