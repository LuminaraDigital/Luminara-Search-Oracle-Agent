/** What ties one audit's findings to its report, and what is needed to compare it with a later audit. */
export interface AuditRunMeta {
  runId: string | null;
  model: string | null;
  provider: string | null;
  /** Which citation sample ran. Rates from different methods are not comparable. */
  method: 'crew_search_rows' | 'live_probe' | null;
  queries: string[];
}

export function newAuditRunId(): string {
  return `run_${crypto.randomUUID()}`;
}
