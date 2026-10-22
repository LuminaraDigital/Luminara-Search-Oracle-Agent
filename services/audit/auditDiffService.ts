/**
 * "What changed since last month?" diffs over audit memory + visibility history.
 */

import { listAudits, type AuditHistoryEntry } from './auditHistoryService';

export interface MetricDelta {
  key: string;
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

export interface CompetitorCitationDelta {
  name: string;
  beforeMentioned: boolean;
  afterMentioned: boolean;
  change: 'gained' | 'lost' | 'stable' | 'new';
}

export interface AuditPeriodDiff {
  domain: string;
  sinceMs: number;
  before: AuditHistoryEntry | null;
  after: AuditHistoryEntry | null;
  metrics: MetricDelta[];
  competitors: CompetitorCitationDelta[];
  schemaGapDelta: number | null;
  /** Milliseconds between the two audits of this domain. Null when there is no earlier audit. */
  gapMs: number | null;
  narrative: string;
}

function directionOf(delta: number | null): MetricDelta['direction'] {
  if (delta == null) return 'unknown';
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function metric(
  key: string,
  label: string,
  before: number | null | undefined,
  after: number | null | undefined
): MetricDelta {
  const b = typeof before === 'number' ? before : null;
  const a = typeof after === 'number' ? after : null;
  const delta = b != null && a != null ? a - b : null;
  return { key, label, before: b, after: a, delta, direction: directionOf(delta) };
}

function competitorDeltas(
  before: AuditHistoryEntry | null,
  after: AuditHistoryEntry | null
): CompetitorCitationDelta[] {
  const bSet = new Set((before?.competitorsMentioned || []).map((c) => c.toLowerCase()));
  const aSet = new Set((after?.competitorsMentioned || []).map((c) => c.toLowerCase()));
  const names = new Map<string, string>();
  for (const c of before?.competitorsMentioned || []) names.set(c.toLowerCase(), c);
  for (const c of after?.competitorsMentioned || []) names.set(c.toLowerCase(), c);

  const out: CompetitorCitationDelta[] = [];
  for (const [key, name] of names) {
    const beforeMentioned = bSet.has(key);
    const afterMentioned = aSet.has(key);
    let change: CompetitorCitationDelta['change'] = 'stable';
    if (!beforeMentioned && afterMentioned) change = before ? 'gained' : 'new';
    else if (beforeMentioned && !afterMentioned) change = 'lost';
    out.push({ name, beforeMentioned, afterMentioned, change });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function gapLabel(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} earlier`;
  const days = Math.max(1, Math.round(ms / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'} earlier`;
}

/**
 * Compare the latest audit of this domain with the previous audit of the same domain.
 * `sinceMs` is ignored: the narrative uses the real gap between those two audits.
 */
export function diffSince(
  domain: string,
  _sinceMs: number = 30 * 24 * 3600 * 1000
): AuditPeriodDiff {
  const label = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  const audits = listAudits({ domain: label })
    .filter((entry) => entry.domain === label)
    .sort((a, b) => a.measuredAt - b.measuredAt);
  const after = audits.length ? audits[audits.length - 1] : null;
  const before = audits.length >= 2 ? audits[audits.length - 2] : null;
  const gapMs = before && after ? Math.max(0, after.measuredAt - before.measuredAt) : null;

  const metrics: MetricDelta[] = [
    metric('healthScore', 'Health Score', before?.healthScore, after?.healthScore),
    metric('citationRate', 'Citation rate %', before?.citationRatePercent, after?.citationRatePercent),
    metric('schemaGaps', 'Schema gaps', before?.schemaGapCount, after?.schemaGapCount),
    // Share of voice is two counts from one audit's search sample. Two audits sample
    // different queries, so no change between them is worked out or shown.
  ];

  const competitors = competitorDeltas(before, after);
  const schemaGapDelta =
    before?.schemaGapCount != null && after?.schemaGapCount != null
      ? after.schemaGapCount - before.schemaGapCount
      : null;

  const parts: string[] = [];
  if (!after) {
    parts.push(`No audits saved yet for ${label}. Run an audit to start the memory timeline.`);
  } else if (!before || gapMs == null) {
    parts.push(`One audit is saved for ${label}. A later audit of the same domain will show what changed.`);
  } else {
    parts.push(`Compared ${label} with the audit ${gapLabel(gapMs)} on this domain.`);
    const hs = metrics.find((m) => m.key === 'healthScore');
    if (hs?.delta != null) {
      parts.push(
        `Health Score ${hs.delta >= 0 ? 'rose' : 'fell'} by ${Math.abs(hs.delta)} points (${hs.before} → ${hs.after}).`
      );
    }
    const cit = metrics.find((m) => m.key === 'citationRate');
    if (cit?.delta != null) {
      parts.push(`Citation rate changed ${cit.delta >= 0 ? '+' : ''}${cit.delta} pts.`);
    }
    const gained = competitors.filter((c) => c.change === 'gained' || c.change === 'new');
    const lost = competitors.filter((c) => c.change === 'lost');
    if (gained.length) parts.push(`New competitor mentions: ${gained.map((c) => c.name).join(', ')}.`);
    if (lost.length) parts.push(`Lost competitor mentions: ${lost.map((c) => c.name).join(', ')}.`);
    if (!parts.length) parts.push('No material metric movement between the compared audits.');
  }

  return {
    domain: label,
    sinceMs: gapMs ?? 0,
    before,
    after,
    metrics,
    competitors,
    schemaGapDelta,
    gapMs,
    narrative: parts.join(' '),
  };
}

export const auditDiffService = {
  diffSince,
};
