import type { ReportFocus } from '../../types';

/** Probe / landing handoff into Instant Audit (Sample until a live run). */
export type AuditHandoff = {
  url: string;
  focus?: ReportFocus;
  /** True when the visitor came from labeled Sample scout UI. */
  sampleSource?: boolean;
};

export function normalizeHandoffUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^https?:\/\//i, '').split('/')[0] || trimmed;
}
