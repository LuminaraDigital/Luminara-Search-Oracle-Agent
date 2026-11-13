/**
 * Cost-aware empty-response retry controller and consecutive-empty fallback trigger.
 *
 * Adapted from NousResearch/hermes-agent (`agent/empty_response_guard.py`)
 * at commit ca2269588fd028adb41f3cc45875b04f3c0b88b4. Copyright (c) 2025 Nous Research (MIT).
 */

export const DEFAULT_EMPTY_MAX_RETRIES = 3;
export const EXPENSIVE_ATTEMPT_THRESHOLD_USD = 0.25;
export const EXPENSIVE_EMPTY_MAX_RETRIES = 1;
export const CONSECUTIVE_EMPTY_FALLBACK_THRESHOLD = 2;

export interface ModelAttemptObservation {
  model: string;
  provider: string;
  finishReason?: string | null;
  content?: string | null;
  toolCallsCount?: number;
  reasoningTokens?: number | null;
  estimatedCostUsd?: number | null;
}

export interface EmptyRetryDecision {
  isZeroOutputEmpty: boolean;
  shouldRetry: boolean;
  shouldFallbackImmediately: boolean;
  costCapped: boolean;
  effectiveMaxRetries: number;
  consecutiveEmptyCount: number;
  reason:
    | 'has_output'
    | 'has_reasoning_tokens'
    | 'content_filtered'
    | 'retry_allowed'
    | 'consecutive_tuple_fallback'
    | 'retry_budget_exhausted';
}

export class EmptyResponseGuard {
  private readonly defaultMaxRetries: number;
  private readonly expensiveThresholdUsd: number;
  private retriesUsed = 0;
  private effectiveMaxRetries: number;
  private costCapped = false;
  private lastEmptyTuple: string | null = null;
  private consecutiveEmptyOnTuple = 0;

  constructor(opts?: { maxRetries?: number; expensiveThresholdUsd?: number }) {
    this.defaultMaxRetries = opts?.maxRetries ?? DEFAULT_EMPTY_MAX_RETRIES;
    this.expensiveThresholdUsd = opts?.expensiveThresholdUsd ?? EXPENSIVE_ATTEMPT_THRESHOLD_USD;
    this.effectiveMaxRetries = this.defaultMaxRetries;
  }

  evaluate(obs: ModelAttemptObservation): EmptyRetryDecision {
    const hasContent = Boolean(obs.content && obs.content.trim().length > 0);
    const hasTools = (obs.toolCallsCount ?? 0) > 0;
    if (hasContent || hasTools) {
      this.consecutiveEmptyOnTuple = 0;
      this.lastEmptyTuple = null;
      return {
        isZeroOutputEmpty: false,
        shouldRetry: false,
        shouldFallbackImmediately: false,
        costCapped: this.costCapped,
        effectiveMaxRetries: this.effectiveMaxRetries,
        consecutiveEmptyCount: 0,
        reason: 'has_output',
      };
    }

    // Moderation/content-filter blocks should never burn retry quota on the same prompt.
    if (String(obs.finishReason || '').trim().toLowerCase() === 'content_filter') {
      this.consecutiveEmptyOnTuple = 0;
      this.lastEmptyTuple = null;
      return {
        isZeroOutputEmpty: true,
        shouldRetry: false,
        shouldFallbackImmediately: false,
        costCapped: this.costCapped,
        effectiveMaxRetries: this.effectiveMaxRetries,
        consecutiveEmptyCount: 0,
        reason: 'content_filtered',
      };
    }

    // Reasoning-only responses (e.g. token cap reached mid-thought) are not dead upstream empties: fail open.
    if ((obs.reasoningTokens ?? 0) > 0) {
      this.consecutiveEmptyOnTuple = 0;
      this.lastEmptyTuple = null;
      return {
        isZeroOutputEmpty: false,
        shouldRetry: false,
        shouldFallbackImmediately: false,
        costCapped: this.costCapped,
        effectiveMaxRetries: this.effectiveMaxRetries,
        consecutiveEmptyCount: 0,
        reason: 'has_reasoning_tokens',
      };
    }

    // Missing usage metadata fails open on cost calculation (cost treated as 0).
    const costUsd =
      typeof obs.estimatedCostUsd === 'number' && Number.isFinite(obs.estimatedCostUsd) && obs.estimatedCostUsd > 0
        ? obs.estimatedCostUsd
        : 0;

    if (costUsd >= this.expensiveThresholdUsd) {
      this.costCapped = true;
      this.effectiveMaxRetries = Math.min(this.effectiveMaxRetries, EXPENSIVE_EMPTY_MAX_RETRIES);
    }

    const tupleKey = `${obs.provider.trim().toLowerCase()}|${obs.model.trim().toLowerCase()}|${String(
      obs.finishReason ?? 'none',
    )
      .trim()
      .toLowerCase()}`;

    if (this.lastEmptyTuple === tupleKey) {
      this.consecutiveEmptyOnTuple += 1;
    } else {
      this.lastEmptyTuple = tupleKey;
      this.consecutiveEmptyOnTuple = 1;
    }

    if (this.consecutiveEmptyOnTuple >= CONSECUTIVE_EMPTY_FALLBACK_THRESHOLD) {
      return {
        isZeroOutputEmpty: true,
        shouldRetry: false,
        shouldFallbackImmediately: true,
        costCapped: this.costCapped,
        effectiveMaxRetries: this.effectiveMaxRetries,
        consecutiveEmptyCount: this.consecutiveEmptyOnTuple,
        reason: 'consecutive_tuple_fallback',
      };
    }

    if (this.retriesUsed < this.effectiveMaxRetries) {
      this.retriesUsed += 1;
      return {
        isZeroOutputEmpty: true,
        shouldRetry: true,
        shouldFallbackImmediately: false,
        costCapped: this.costCapped,
        effectiveMaxRetries: this.effectiveMaxRetries,
        consecutiveEmptyCount: this.consecutiveEmptyOnTuple,
        reason: 'retry_allowed',
      };
    }

    return {
      isZeroOutputEmpty: true,
      shouldRetry: false,
      shouldFallbackImmediately: true,
      costCapped: this.costCapped,
      effectiveMaxRetries: this.effectiveMaxRetries,
      consecutiveEmptyCount: this.consecutiveEmptyOnTuple,
      reason: 'retry_budget_exhausted',
    };
  }
}
