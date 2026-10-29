/**
 * The fix the report calls "Your next fix", and which findings the evidence check downgraded.
 * Pure, so the Worker's weekly digest ranks the Fix Board by the same rule as the report.
 */

const UNSUPPORTED_FINDING = 'Not measured. The evidence check did not support this finding.';

export function isDowngradedFinding(finding: { id?: string; description?: string }): boolean {
  if (typeof finding.id === 'string' && finding.id.endsWith('-unmeasured')) return true;
  return finding.description?.trim() === UNSUPPORTED_FINDING;
}

export type RankedFinding = {
  id?: string;
  description?: string;
  severity?: string;
  status?: string;
};

/** The open fix the report calls "Your next fix". Critical before high, then medium, then low. */
export function pickPrimaryFinding<T extends RankedFinding>(findings: readonly T[]): T | null {
  const eligible = findings.filter((finding) => !isDowngradedFinding(finding));
  if (!eligible.length) return null;
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const open = eligible.filter((finding) => finding.status === 'open' || finding.status === 'in_progress');
  const pool = open.length ? open : eligible;
  return [...pool].sort(
    (a, b) => (rank[a.severity || ''] ?? 9) - (rank[b.severity || ''] ?? 9),
  )[0] ?? null;
}
