/**
 * 30-day research-log reuse gate (APS credit discipline).
 */
import type { ResearchLogEntry } from './types';

export const RESEARCH_LOG_REUSE_MS = 30 * 24 * 60 * 60 * 1000;

/** Summaries that must never block retries as if they were measured. */
export function isNonMeasuredResearchSummary(summary: string): boolean {
  const hay = (summary || '').toLowerCase();
  return (
    hay.includes('not_measured') ||
    hay.includes('verdict: not_measured') ||
    /\b(dfs_error|dfs_task_error|dfs_empty|dfs fail)\b/i.test(hay)
  );
}

/**
 * Infer gate hit measurement status from stored summary text.
 * Never hardcode measured when the log itself says not_measured / error.
 */
export function measurementStatusFromResearchSummary(
  summary: string,
): 'measured' | 'not_measured' {
  return isNonMeasuredResearchSummary(summary) ? 'not_measured' : 'measured';
}

/**
 * Find a recent log entry whose summary contains all needles (case-insensitive).
 * Skips not_measured / error summaries so failed runs cannot poison the 30-day gate.
 */
export function findResearchLogHit(
  entries: ResearchLogEntry[],
  needles: string[],
  nowMs = Date.now(),
): ResearchLogEntry | null {
  const cleaned = needles.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!cleaned.length) return null;
  const cutoff = nowMs - RESEARCH_LOG_REUSE_MS;
  for (const entry of entries) {
    if (entry.created_at < cutoff) continue;
    if (isNonMeasuredResearchSummary(entry.summary || '')) continue;
    const hay = (entry.summary || '').toLowerCase();
    if (cleaned.every((n) => hay.includes(n))) return entry;
  }
  return null;
}

export function researchLogHitResult(entry: ResearchLogEntry, tool: string) {
  const measurementStatus = measurementStatusFromResearchSummary(entry.summary || '');
  return {
    text: `Reused research log (${entry.entry_date}): ${entry.summary}`,
    structuredContent: {
      measurementStatus,
      code: 'RESEARCH_LOG_HIT',
      tool,
      logId: entry.id,
      entryDate: entry.entry_date,
      summary: entry.summary,
    },
  };
}
