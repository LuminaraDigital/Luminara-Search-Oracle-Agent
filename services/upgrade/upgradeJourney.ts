/**
 * Upgrade copy and progress from the plans and the findings board.
 * Prices are the published AUD card prices. No tax is added. A missing measurement stays "Not measured".
 */
import type { BoardFinding } from '../audit/findingBoardService';
import { isDowngradedFinding } from '../audit/reportBlocks';
import { PAID_PLAN_PRICES, type PaidPlanId } from '../../components/paywall/planPrices';
import { entitlementsFor, PLAN_ENTITLEMENTS } from '../plans/planEntitlements';
import { formatAuDay } from '../../utils/formatAuDate';
import { noteWorkspaceDirty } from '../sync/workspaceSyncService';
import type { RecheckId } from './recheckReading';

export const UPGRADE_DISMISS_KEY = 'luminara_upgrade_dismissed_v1';

export type UpgradePromptKind = 'quota' | 'competitor' | 'white_label' | 'tracking';

export type LockedFeature = 'competitor' | 'suburb' | 'tracking' | 'seats' | 'white_label';

const SEVERITY_EASE = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export function audPrice(id: PaidPlanId): string {
  return PAID_PLAN_PRICES[id].audLabel;
}

export function upgradePrompt(kind: UpgradePromptKind): { title: string; body: string } {
  const starter = audPrice('starter');
  const growth = audPrice('growth');
  const agency = audPrice('agency');
  switch (kind) {
    case 'quota':
      return {
        title: 'Daily checks used',
        body: `You have used today's free checks. Starter is ${starter} for 30 days and includes a monthly re-audit reminder. It does not renew.`,
      };
    case 'competitor':
      return {
        title: 'Competitor comparison',
        body: `Starter watches 10 competitors for ${starter} for 30 days. Growth watches 25 for ${growth}. The sample below is not your market.`,
      };
    case 'white_label':
      return {
        title: 'White-label PDF',
        body: `${PLAN_ENTITLEMENTS.agency.title} includes a white-label PDF and 10 seats for ${agency} for 30 days. Starter includes a white-label PDF for ${starter}. It does not renew.`,
      };
    case 'tracking':
      return {
        title: 'Same site again',
        body: `This is another audit of this site. Starter includes a monthly re-audit reminder for ${starter} for 30 days. It does not renew.`,
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function lockedSample(feature: LockedFeature): { title: string; rows: string[] } {
  const label = 'SAMPLE. This is not your data.';
  switch (feature) {
    case 'competitor':
      return { title: 'Competitor comparison', rows: [label, 'Sample agency A', 'Sample agency B', 'Rank: Not measured'] };
    case 'suburb':
      return { title: 'Suburb report', rows: [label, 'Example suburb page', 'Not measured', 'Not included on these plans yet. Email info@luminara.digital to join the waitlist.'] };
    case 'tracking':
      return { title: 'Monthly tracking', rows: [label, 'Last month: Not measured', 'This month: Not measured'] };
    case 'seats':
      return { title: 'Team seats', rows: [label, 'Sample seat', 'Not a member of your account'] };
    case 'white_label':
      return { title: 'White-label PDF', rows: [label, 'Sample agency name on a cover', 'Not your export'] };
    default: {
      const _exhaustive: never = feature;
      return _exhaustive;
    }
  }
}

export function lockedFeatures(planId: string | null | undefined): LockedFeature[] {
  const plan = entitlementsFor(planId);
  const out: LockedFeature[] = [];
  if (plan.competitorWatchLimit <= PLAN_ENTITLEMENTS.free.competitorWatchLimit) out.push('competitor');
  out.push('suburb');
  if (plan.scheduledReaudit === 'none') out.push('tracking');
  if (plan.teamSeats <= 1) out.push('seats');
  if (!plan.whiteLabelPdf) out.push('white_label');
  return out;
}

export function competitorRankLine(): string {
  return 'Competitor rank: Not measured.';
}

export function easyFix(findings: readonly BoardFinding[]): BoardFinding | null {
  const open = findings.filter((finding) =>
    (finding.status === 'open' || finding.status === 'in_progress') && !isDowngradedFinding(finding),
  );
  if (!open.length) return null;
  return [...open].sort((a, b) => (SEVERITY_EASE[a.severity] ?? 9) - (SEVERITY_EASE[b.severity] ?? 9))[0];
}

export function recheckTarget(
  finding: Pick<BoardFinding, 'title' | 'description' | 'category'>,
  brand: string | null,
): { checkId: RecheckId; expect?: string; targetUrl?: string } | null {
  const raw = `${finding.title} ${finding.description}`;
  const blob = raw.toLowerCase();
  if (/suburb|area page/.test(blob)) return { checkId: 'area_pages' };
  if (/agent profile|team page/.test(blob)) return { checkId: 'agent_pages' };
  if (/google business|\bgbp\b/.test(blob)) return { checkId: 'gbp' };
  if (/brand mention|third-party mention|roundup|digital pr/.test(blob)) {
    const expect = brand?.trim();
    if (!expect) return null;
    const urlMatch = raw.match(/https?:\/\/[^\s)>\]"',]+/i);
    return { checkId: 'brand_mention', expect, ...(urlMatch ? { targetUrl: urlMatch[0] } : {}) };
  }
  if (/review/.test(blob)) return { checkId: 'reviews' };
  if (/\bnap\b|phone|address/.test(blob)) return { checkId: 'nap' };
  if (/schema|json-ld|jsonld/.test(blob) || finding.category === 'schema') return { checkId: 'schema' };
  if (/title|agency name|homepage/.test(blob)) {
    const expect = brand?.trim();
    return expect ? { checkId: 'title', expect } : null;
  }
  return null;
}

export function recheckCelebration(input: { measured: boolean; passed: boolean | null }): string {
  if (!input.measured || input.passed == null) return 'Not measured. This check was not rechecked.';
  if (input.passed) return 'This check passed on the page we just fetched.';
  return 'This check still fails on the page we just fetched.';
}

function shiftDay(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function fixProgress(
  findings: readonly (Pick<BoardFinding, 'status' | 'doneOn'> & { id?: string; description?: string })[],
  today = formatAuDay(new Date()),
): { done: number; total: number; streak: number; label: string } {
  const fixes = findings.filter((finding) => !isDowngradedFinding(finding));
  const done = fixes.filter((finding) => finding.status === 'done').length;
  const total = fixes.length;
  const days = new Set(fixes.map((finding) => finding.doneOn).filter((day): day is string => Boolean(day)));
  let streak = 0;
  if (today && (days.has(today) || days.has(shiftDay(today, -1)))) {
    let cursor = days.has(today) ? today : shiftDay(today, -1);
    while (days.has(cursor)) {
      streak += 1;
      cursor = shiftDay(cursor, -1);
    }
  }
  const head = total === 0 ? 'No fixes on this audit' : `${done} of ${total} fixes done`;
  const label = streak > 0 ? `${head}. ${streak} day streak.` : head;
  return { done, total, streak, label };
}

type DismissStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function storeOf(store?: DismissStore): DismissStore | null {
  if (store) return store;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function isPromptDismissed(kind: UpgradePromptKind, raw: string | null, today = formatAuDay(new Date())): boolean {
  if (!raw) return false;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    const value = map[kind];
    if (!value) return false;
    if (kind === 'quota') return value === today;
    return true;
  } catch {
    return false;
  }
}

export function dismissPrompt(kind: UpgradePromptKind, store?: DismissStore, today = formatAuDay(new Date())): void {
  const bag = storeOf(store);
  if (!bag) return;
  let map: Record<string, string> = {};
  try {
    const raw = bag.getItem(UPGRADE_DISMISS_KEY);
    if (raw) map = JSON.parse(raw) as Record<string, string>;
  } catch {
    map = {};
  }
  map[kind] = kind === 'quota' ? today : 'keep';
  try {
    bag.setItem(UPGRADE_DISMISS_KEY, JSON.stringify(map));
    noteWorkspaceDirty();
  } catch {
    /* the local bag already holds the dismiss when the workspace note fails */
  }
}

const shownPrompts = new Set<string>();

/** True the first time this prompt is shown in the page. */
export function markPromptShown(kind: UpgradePromptKind): boolean {
  if (shownPrompts.has(kind)) return false;
  shownPrompts.add(kind);
  return true;
}
