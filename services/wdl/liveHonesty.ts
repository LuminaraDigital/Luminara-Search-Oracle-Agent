/**
 * Live visibility honesty helpers (WDL / APS): never treat missing data as scored.
 */
export type MeasurementStatus = 'measured' | 'estimated' | 'not_measured';
export type DataFreshness = 'sample' | 'live' | 'mixed';

export function normalizeMeasurementStatus(raw: unknown): MeasurementStatus {
  if (raw === 'measured' || raw === 'estimated' || raw === 'not_measured') return raw;
  return 'not_measured';
}

export function canPulseAsScored(status: MeasurementStatus): boolean {
  return status === 'measured';
}

export function honestyChipLabel(status: MeasurementStatus): string {
  if (status === 'measured') return 'Live measured';
  if (status === 'estimated') return 'Estimated';
  return 'Not measured';
}

export function freshnessFromCaptures(
  statuses: MeasurementStatus[],
): DataFreshness {
  const hasLive = statuses.some((s) => s === 'measured');
  const hasSample = statuses.some((s) => s !== 'measured');
  if (hasLive && hasSample) return 'mixed';
  if (hasLive) return 'live';
  return 'sample';
}
