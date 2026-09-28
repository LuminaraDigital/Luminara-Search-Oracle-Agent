/**
 * Referral, mission, and Visibility Level rules.
 * Pure: no D1, no fetch, no invented SEO percentages.
 */

export const REFERRAL_SCOUT_CREDITS = 2;
export const OPERATOR_STREAK_WEEKS = 4;
export const REFERRAL_CLAIM_LIMIT_PER_HOUR = 20;
export const REFERRAL_QUALIFY_LIMIT_PER_HOUR = 20;
export const MINI_APP_URL = 'https://t.me/LuminaraSuiteBot/app';

/** Crockford-like alphabet: 32 symbols, so a random byte maps without bias. */
export const REFERRAL_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const CODE_RE = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{10}$`);

export const HONEST_MEASUREMENT_STATUSES = ['measured', 'not_measured'] as const;
export type HonestMeasurementStatus = (typeof HONEST_MEASUREMENT_STATUSES)[number];

export type VisibilityLevel = 'explorer' | 'scout' | 'builder' | 'operator';

export const WEEKLY_MISSIONS = [
  {
    key: 'rescout',
    title: 'Re-scout a site',
    detail: 'Run Instant Scout again after your first honest result. A second honest run completes this.',
    clientCompletable: false,
  },
  {
    key: 'view_delta',
    title: 'View what changed',
    detail: 'Open Brand Memory and look at what changed since the last scout.',
    clientCompletable: true,
  },
  {
    key: 'checklist_fix',
    title: 'Ship one checklist fix',
    detail: 'Ship one item from the scout checklist (schema, title, or a crawler file), then mark it done. Marking it does not change audit scores.',
    clientCompletable: true,
  },
] as const;

export type MissionKey = (typeof WEEKLY_MISSIONS)[number]['key'];

const SCORE_KEYS = new Set([
  'citationratepercent',
  'healthscore',
  'shareofvoicescore',
  'score',
  'percent',
  'citation',
  'seo',
]);

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  let value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('ref_')) value = value.slice(4);
  if (!CODE_RE.test(value)) return null;
  if (!/[a-z]/.test(value)) return null;
  return value;
}

/** `ref_<code>` only. Other start payloads return null so audit_ and view tokens stay intact. */
export function parseReferralStartParam(raw: string | null | undefined): string | null {
  const trimmed = String(raw || '').trim();
  if (!/^ref_/i.test(trimmed)) return null;
  return normalizeReferralCode(trimmed);
}

export function generateReferralCode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += REFERRAL_CODE_ALPHABET[bytes[i]! % REFERRAL_CODE_ALPHABET.length];
  }
  if (!/[a-z]/.test(out)) out = `a${out.slice(1)}`;
  return out;
}

export function inviteUrlForCode(code: string): string {
  return `${MINI_APP_URL}?startapp=${encodeURIComponent(`ref_${code}`)}`;
}

export type AttributionDecision =
  | { ok: true; status: 'attribute' | 'already' }
  | { ok: false; status: 'self' | 'already_other' | 'missing' };

export function attributionDecision(input: {
  referrerAccountId: string;
  referredAccountId: string;
  existingReferrerAccountId?: string | null;
}): AttributionDecision {
  const referrer = input.referrerAccountId.trim();
  const referred = input.referredAccountId.trim();
  if (!referrer || !referred) return { ok: false, status: 'missing' };
  if (referrer === referred) return { ok: false, status: 'self' };
  const existing = input.existingReferrerAccountId?.trim() || '';
  if (existing) {
    if (existing === referrer) return { ok: true, status: 'already' };
    return { ok: false, status: 'already_other' };
  }
  return { ok: true, status: 'attribute' };
}

export type ScoutQualifyInput = Record<string, unknown>;

export function assessHonestScout(
  body: ScoutQualifyInput,
  hostname: (domain: string) => string | null,
): { ok: true; domain: string; measurementStatus: HonestMeasurementStatus } | { ok: false; error: string; code: string } {
  for (const key of Object.keys(body)) {
    if (SCORE_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ''))) {
      return {
        ok: false,
        error: 'Scout qualification does not accept score percentages. Send measurement status only.',
        code: 'SCORE_NOT_ACCEPTED',
      };
    }
  }
  if (body.completed !== true) {
    return { ok: false, error: 'Credits wait for a completed Instant Scout.', code: 'NOT_COMPLETED' };
  }
  if (body.evidencePresent !== true) {
    return {
      ok: false,
      error: 'An empty scout is not measured and does not grant invite credits.',
      code: 'NO_EVIDENCE',
    };
  }
  const status = body.measurementStatus;
  if (status !== 'measured' && status !== 'not_measured') {
    return {
      ok: false,
      error: 'measurementStatus must be measured or not_measured. Missing data is not a score.',
      code: 'STATUS_NOT_HONEST',
    };
  }
  const domain = hostname(String(body.domain || ''));
  if (!domain) {
    return { ok: false, error: 'Use a public site hostname. Local and private hosts are rejected.', code: 'BAD_DOMAIN' };
  }
  return { ok: true, domain, measurementStatus: status };
}

export function visibilityLevel(input: {
  honestScoutCount: number;
  missionsCompleted: number;
  streakWeeks: number;
}): VisibilityLevel {
  const scouts = Math.max(0, input.honestScoutCount);
  const missions = Math.max(0, input.missionsCompleted);
  const streak = Math.max(0, input.streakWeeks);
  if (streak >= OPERATOR_STREAK_WEEKS && missions >= 1 && scouts >= 1) return 'operator';
  if (missions >= 1 && scouts >= 1) return 'builder';
  if (scouts >= 1) return 'scout';
  return 'explorer';
}

export function visibilityLevelLabel(level: VisibilityLevel): string {
  if (level === 'explorer') return 'Explorer';
  if (level === 'scout') return 'Scout';
  if (level === 'builder') return 'Builder';
  return 'Operator';
}

/** ISO week key in UTC, `YYYY-Www`. */
export function isoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isAdjacentIsoWeek(prev: string, next: string): boolean {
  const parse = (value: string) => {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) return null;
    return { year: Number(match[1]), week: Number(match[2]) };
  };
  const earlier = parse(prev);
  const later = parse(next);
  if (!earlier || !later) return false;
  if (earlier.year === later.year && later.week === earlier.week + 1) return true;
  if (later.year === earlier.year + 1 && later.week === 1 && (earlier.week === 52 || earlier.week === 53)) return true;
  return false;
}

export function nextStreakWeeks(prevWeeks: number, lastWeek: string | null, thisWeek: string): number {
  const current = Math.max(0, prevWeeks);
  if (lastWeek === thisWeek) return current;
  if (lastWeek && isAdjacentIsoWeek(lastWeek, thisWeek)) return current + 1;
  return 1;
}

export function formatWeeklyMissionNudge(input?: { level?: VisibilityLevel; streakWeeks?: number }): string {
  const lines = [
    '*Weekly missions*',
    'These are real audit tasks. There is no coin balance.',
    '',
    '1. Re-scout a site after your first honest result.',
    '2. Open Brand Memory and view what changed.',
    '3. Ship one checklist fix (schema, title, or a crawler file).',
    '',
    'Visibility Level moves from Explorer to Scout, Builder, then Operator after a four-week streak.',
  ];
  if (input?.level) {
    lines.push('', `Your level: *${visibilityLevelLabel(input.level)}*. Streak: ${input.streakWeeks ?? 0} week(s).`);
  }
  lines.push('', 'Open the app when you want to work. This bot does not send a weekly blast.');
  return lines.join('\n');
}

export function clientMissionKey(raw: unknown): MissionKey | null {
  const key = String(raw || '').trim();
  const found = WEEKLY_MISSIONS.find((mission) => mission.key === key && mission.clientCompletable);
  return found ? found.key : null;
}
