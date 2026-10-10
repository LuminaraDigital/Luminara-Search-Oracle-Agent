/**
 * Deterministic Wake Gate for Luminara Dreaming.
 * Evaluates pending events, signal weight, staleness, and conflicts
 * before allowing any expensive LLM consolidation.
 */
import type {
  BusinessMemoryItem,
  DreamEvent,
  DreamTriggerReason,
  DreamWakeGateResult,
} from './dreamingTypes';

export interface WakeGateEvaluationInput {
  pendingEvents: DreamEvent[];
  activeMemories: BusinessMemoryItem[];
  triggerReason: DreamTriggerReason;
  threshold?: number;
}

export interface DetailedWakeGateResult extends DreamWakeGateResult {
  expiredMemoryIds: string[];
  detectedConflictSummary?: string;
}

const DEFAULT_WAKE_THRESHOLD = 3.0;

export function evaluateWakeGate(input: WakeGateEvaluationInput): DetailedWakeGateResult {
  const { pendingEvents, activeMemories, triggerReason } = input;
  const threshold = input.threshold ?? DEFAULT_WAKE_THRESHOLD;
  const now = Date.now();

  // 1. Calculate accumulated signal score
  const signalScore = pendingEvents.reduce((acc, evt) => acc + (evt.signalWeight || 1.0), 0);

  // 2. Detect high-signal events (profile changes, verified action outcomes)
  const highSignalEvents = pendingEvents.filter(
    (e) =>
      e.eventType === 'client_profile_changed' ||
      (e.eventType === 'recommendation_updated' &&
        (e.payload?.status === 'completed' || e.payload?.status === 'dismissed')),
  );
  const highSignalDetected = highSignalEvents.length > 0;

  // 3. Scan for stale / expired memories
  const expiredMemoryIds = activeMemories
    .filter((m) => m.expiresAt != null && m.expiresAt < now)
    .map((m) => m.id);

  // 4. Pre-check for syntactic/key conflicts
  let detectedConflictSummary: string | undefined;
  const profileChangedEvt = pendingEvents.find((e) => e.eventType === 'client_profile_changed');
  if (profileChangedEvt && profileChangedEvt.payload) {
    const payloadDna = profileChangedEvt.payload as { name?: string; competitors?: string[] };
    const existingDna = activeMemories.find((m) => m.memoryType === 'business_dna');
    if (existingDna && payloadDna.name && !existingDna.title.includes(payloadDna.name)) {
      detectedConflictSummary = `Brand name shift: from "${existingDna.title}" to "${payloadDna.name}".`;
    }
  }

  // 5. Wake Gate Decisions
  if (pendingEvents.length === 0 && expiredMemoryIds.length === 0) {
    return {
      shouldWake: false,
      reason: 'No pending events or expired memories to consolidate.',
      signalScore: 0,
      threshold,
      pendingEventsCount: 0,
      highSignalDetected: false,
      expiredMemoryIds: [],
    };
  }

  // Manual or MCP triggers wake if there is any pending signal or expired memory
  if (triggerReason === 'manual_user' || triggerReason === 'mcp_trigger') {
    return {
      shouldWake: true,
      reason: `Direct trigger (${triggerReason}) with ${pendingEvents.length} event(s).`,
      signalScore,
      threshold,
      pendingEventsCount: pendingEvents.length,
      highSignalDetected,
      expiredMemoryIds,
      detectedConflictSummary,
    };
  }

  // Scheduled nightly job sweeps if there is at least 1 pending event or expired memory
  if (triggerReason === 'scheduled_nightly') {
    return {
      shouldWake: true,
      reason: `Scheduled nightly consolidation with ${pendingEvents.length} pending event(s).`,
      signalScore,
      threshold,
      pendingEventsCount: pendingEvents.length,
      highSignalDetected,
      expiredMemoryIds,
      detectedConflictSummary,
    };
  }

  // High-signal events wake immediately
  if (highSignalDetected) {
    return {
      shouldWake: true,
      reason: `High-signal event detected (${highSignalEvents.map((e) => e.eventType).join(', ')}).`,
      signalScore,
      threshold,
      pendingEventsCount: pendingEvents.length,
      highSignalDetected: true,
      expiredMemoryIds,
      detectedConflictSummary,
    };
  }

  // Stale memories require pruning sweep
  if (expiredMemoryIds.length > 0) {
    return {
      shouldWake: true,
      reason: `${expiredMemoryIds.length} expired memory record(s) flagged for pruning.`,
      signalScore,
      threshold,
      pendingEventsCount: pendingEvents.length,
      highSignalDetected,
      expiredMemoryIds,
      detectedConflictSummary,
    };
  }

  // Threshold evaluation
  if (signalScore >= threshold) {
    return {
      shouldWake: true,
      reason: `Accumulated signal score (${signalScore.toFixed(1)}) exceeded threshold (${threshold.toFixed(1)}).`,
      signalScore,
      threshold,
      pendingEventsCount: pendingEvents.length,
      highSignalDetected: false,
      expiredMemoryIds,
      detectedConflictSummary,
    };
  }

  // Default: Sleep and continue accumulating
  return {
    shouldWake: false,
    reason: `Signal score (${signalScore.toFixed(1)}) below threshold (${threshold.toFixed(1)}). Event queue accumulating.`,
    signalScore,
    threshold,
    pendingEventsCount: pendingEvents.length,
    highSignalDetected: false,
    expiredMemoryIds,
  };
}
