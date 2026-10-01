/**
 * North-star activation metric helpers (pure).
 * % of users who finish Instant Audit and then save, share, or mint+use MCP within 24h.
 */

export const NORTH_STAR_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NorthStarEvent = {
  type: string;
  timestamp: number;
  accountId?: string | null;
  sessionId?: string | null;
};

export type NorthStarCohortResult = {
  denominator: number;
  numerator: number;
  rate: number | null;
};

function subjectKey(ev: NorthStarEvent): string | null {
  if (ev.accountId) return `a:${ev.accountId}`;
  if (ev.sessionId) return `s:${ev.sessionId}`;
  return null;
}

const ACTIVATION_TYPES = new Set([
  'strategy_saved',
  'share_link_created',
  'mcp_key_created',
  'mcp_snippet_copied',
  'mcp_first_used',
]);

/** Compute activation rate from a flat event list (D1 export or local buffer). */
export function computeNorthStarRate(events: NorthStarEvent[], now = Date.now()): NorthStarCohortResult {
  const bySubject = new Map<string, NorthStarEvent[]>();
  for (const ev of events) {
    const key = subjectKey(ev);
    if (!key) continue;
    const list = bySubject.get(key) || [];
    list.push(ev);
    bySubject.set(key, list);
  }

  let denominator = 0;
  let numerator = 0;

  for (const list of bySubject.values()) {
    const anchors = list
      .filter((e) => e.type === 'instant_audit_completed')
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!anchors.length) continue;

    const first = anchors[0];
    if (first.timestamp > now) continue;
    denominator += 1;

    const windowEnd = first.timestamp + NORTH_STAR_WINDOW_MS;
    const activated = list.some(
      (e) =>
        ACTIVATION_TYPES.has(e.type) && e.timestamp >= first.timestamp && e.timestamp <= windowEnd,
    );
    if (activated) numerator += 1;
  }

  return {
    denominator,
    numerator,
    rate: denominator === 0 ? null : numerator / denominator,
  };
}
