/**
 * Unified AuditMetrics specification.
 * Shared source of truth across Instant Audit reports, Brand Memory Vault,
 * Audit History timeline, and public share links.
 *
 * Invariant (AGENTS.md:44): Never invent SEO metrics; use not_measured when data is missing.
 */

export interface AuditChecksSummary {
  passed: number;
  total: number;
  summary: string; // e.g. "8 of 11 checks passed"
  items?: Array<{
    id: string;
    label: string;
    passed: boolean;
    reason: string;
  }>;
}

export interface AuditCitationSummary {
  ratePercent: number | null; // e.g. 67, null if not measured
  sampleCount: number;        // n = N
  citedCount: number;         // X
  label: string;              // "cited in X of N AI answers (n=N)" or "Not measured"
  measurementStatus: 'measured' | 'not_measured';
}

export interface AuditMetrics {
  domain: string;
  checks: AuditChecksSummary | null;
  citation: AuditCitationSummary | null;
  /** Legacy estimated score. Kept solely for backwards compatibility with old records; marked estimated. */
  healthScore?: number | null;
  topCompetitor?: string | null;
  measuredAt: number;
}

export function formatChecksSummary(passed: number, total: number): string {
  return `${passed} of ${total} checks passed`;
}

export function formatCitationLabel(citedCount: number, sampleCount: number): string {
  if (sampleCount <= 0) return 'Not measured';
  return `cited in ${citedCount} of ${sampleCount} AI answers (n=${sampleCount})`;
}
