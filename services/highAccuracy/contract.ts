/**
 * Shared high-accuracy schema contract. The Worker and the report screen both
 * read the estimate label from here so the toggle and the receipt cannot drift.
 */

export const SCHEMA_HA_ESTIMATE_LABEL = '~1-3x tokens';

export interface HaUsage {
  calls: number;
  failed: number;
  usageMissing: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface HaAttempt {
  index: number;
  ok: boolean;
  reasons: string[];
}

export interface HaAccuracy {
  mode: 'best_of_n';
  winnerIndex: number | null;
  attempts: HaAttempt[];
  estimate: string;
  usage: HaUsage;
  keySource: 'byok';
}
