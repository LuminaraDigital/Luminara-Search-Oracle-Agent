/**
 * "What changed since last month?" diffs over audit memory + visibility history.
 */

import { listAudits, type AuditHistoryEntry } from './auditHistoryService';
import { getVisibilityTrend } from '../visibility/visibilityHistoryService';

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

/**
 * Compare latest audit to the closest audit at or before `sinceMs` ago (default 30 days).
 */
export function diffSince(
  domain: string,
  sinceMs: number = 30 * 24 * 3600 * 1000
): AuditPeriodDiff {
  const audits = listAudits({ domain }).sort((a, b) => a.measuredAt - b.measuredAt);
  const after = audits.length ? audits[audits.length - 1] : null;
  const cutoff = (after?.measuredAt ?? Date.now()) - sinceMs;
  let before: AuditHistoryEntry | null = null;
  for (let i = audits.length - 2; i >= 0; i--) {
    if (audits[i].measuredAt <= cutoff) {
      before = audits[i];
      break;
    }
  }
  if (!before && audits.length >= 2) before = audits[0];

  const trend = getVisibilityTrend(domain);
  const metrics: MetricDelta[] = [
    metric('healthScore', 'Health Score', before?.healthScore, after?.healthScore),
    metric(
      'citationRate',
      'Citation rate %',
      before?.citationRatePercent ?? trend.points[0]?.citationRatePercent,
      after?.citationRatePercent ?? trend.points[trend.points.length - 1]?.citationRatePercent
    ),
    metric('schemaGaps', 'Schema gaps', before?.schemaGapCount, after?.schemaGapCount),
    metric(
      'shareOfVoice',
      'Brand citation share %',
      trend.points.length >= 2 ? trend.points[0].brandCitationSharePercent : null,
      trend.points.length >= 1 ? trend.points[trend.points.length - 1].brandCitationSharePercent : null
    ),
  ];

  const competitors = competitorDeltas(before, after);
  const schemaGapDelta =
    before?.schemaGapCount != null && after?.schemaGapCount != null
      ? after.schemaGapCount - before.schemaGapCount
      : null;

  const parts: string[] = [];
  if (!after) {
    parts.push('No audits saved yet for this domain. Run an audit to start the memory timeline.');
  } else if (!before) {
    parts.push(
      `Latest ${after.focus} audit scored ${after.healthScore ?? 'n/a'}/100. Need a prior audit to compute period change.`
    );
  } else {
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
    domain: domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase(),
    sinceMs,
    before,
    after,
    metrics,
    competitors,
    schemaGapDelta,
    narrative: parts.join(' '),
  };
}

export const auditDiffService = {
  diffSince,
};
