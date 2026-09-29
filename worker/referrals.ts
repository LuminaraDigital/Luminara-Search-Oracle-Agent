/**
 * Invite codes, attribution, two-sided hosted scout credits, weekly missions.
 * Rewards require a Telegram or Firebase identity (identify). No SEO percentages are stored.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, identify, json, sha256Hex } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody, safePublicHostname } from './security';
import {
  REFERRAL_CLAIM_LIMIT_PER_HOUR,
  REFERRAL_QUALIFY_LIMIT_PER_HOUR,
  REFERRAL_SCOUT_CREDITS,
  WEEKLY_MISSIONS,
  assessHonestScout,
  attributionDecision,
  clientMissionKey,
  formatWeeklyMissionNudge,
  generateReferralCode,
  inviteUrlForCode,
  isoWeekKey,
  nextStreakWeeks,
  normalizeReferralCode,
  visibilityLevel,
  visibilityLevelLabel,
  type MissionKey,
  type VisibilityLevel,
} from '../services/referrals/rules';

type ProgRow = {
  streak_weeks: number;
  last_mission_week: string | null;
  last_mission_at: number | null;
  visibility_level: string;
  honest_scout_count: number;
  last_honest_scout_day: string | null;
  week_scout_key: string | null;
  week_scout_count: number;
  updated_at: number;
};

const SCOUT_RECEIPT_TTL_MS = 45 * 60 * 1000;

function randomId(prefix: string): string {
  const buf = new Uint8Array(9);
  crypto.getRandomValues(buf);
  return `${prefix}_${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function hourBucket(now = Date.now()): number {
  return Math.floor(now / 3_600_000);
}

async function allowRate(env: Env, key: string, limit: number): Promise<boolean> {
  if (!env.LUMINARA_KV) return true;
  const used = Number((await env.LUMINARA_KV.get(key)) || 0);
  if (used >= limit) return false;
  await env.LUMINARA_KV.put(key, String(used + 1), { expirationTtl: 2 * 3600 });
  return true;
}

export async function referralBonusRemaining(env: Env, accountId: string): Promise<number> {
  if (!env.DB || !accountId) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(remaining), 0) AS total
       FROM referral_rewards
       WHERE account_id = ? AND kind = 'hosted_scout_credit' AND remaining > 0`,
    )
      .bind(accountId)
      .first<{ total: number }>();
    return Math.max(0, Number(row?.total || 0));
  } catch {
    return 0;
  }
}

/**
 * One credit, oldest grant first.
 * Read the row, then decrement only if remaining is still that value.
 * A second isolate that read the same value gets changes=0 and retries, so one unit is not spent twice.
 */
export async function tryConsumeReferralCredit(env: Env, accountId: string): Promise<{ ok: boolean; remaining: number }> {
  if (!env.DB || !accountId) return { ok: false, remaining: 0 };
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await env.DB.prepare(
        `SELECT id, remaining FROM referral_rewards
         WHERE account_id = ? AND kind = 'hosted_scout_credit' AND remaining > 0
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      )
        .bind(accountId)
        .first<{ id: string; remaining: number }>();
      if (!row?.id) {
        return { ok: false, remaining: await referralBonusRemaining(env, accountId) };
      }
      const expected = Number(row.remaining);
      const updated = await env.DB.prepare(
        `UPDATE referral_rewards
         SET remaining = remaining - 1
         WHERE id = ? AND remaining = ?`,
      )
        .bind(row.id, expected)
        .run();
      if (Number(updated.meta?.changes || 0) > 0) {
        return { ok: true, remaining: await referralBonusRemaining(env, accountId) };
      }
    }
    return { ok: false, remaining: await referralBonusRemaining(env, accountId) };
  } catch {
    return { ok: false, remaining: 0 };
  }
}

/** Mint a one-time receipt after the Worker sees a signed-in scout evidence call. Returns the raw token once. */
export async function mintScoutReceipt(env: Env, accountId: string, domain: string): Promise<string | null> {
  const host = safePublicHostname(domain);
  if (!env.DB || !accountId || !host) return null;
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const token = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  const tokenHash = await sha256Hex(`luminara-scout-receipt:${token}`);
  await env.DB.prepare(
    `INSERT INTO scout_receipts (token_hash, account_id, domain, minted_at, consumed_at)
     VALUES (?, ?, ?, ?, NULL)`,
  )
    .bind(tokenHash, accountId, host, Date.now())
    .run();
  return token;
}

/** Atomically consume a receipt for this account and public host. A second caller loses. */
async function consumeScoutReceipt(
  env: Env,
  accountId: string,
  token: string,
  domain: string,
): Promise<boolean> {
  const normalized = token.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  const tokenHash = await sha256Hex(`luminara-scout-receipt:${normalized}`);
  const now = Date.now();
  const updated = await env.DB!.prepare(
    `UPDATE scout_receipts
     SET consumed_at = ?
     WHERE token_hash = ?
       AND account_id = ?
       AND domain = ?
       AND consumed_at IS NULL
       AND minted_at >= ?`,
  )
    .bind(now, tokenHash, accountId, domain, now - SCOUT_RECEIPT_TTL_MS)
    .run();
  return Number(updated.meta?.changes || 0) > 0;
}

async function codeHash(code: string): Promise<string> {
  return sha256Hex(`luminara-ref:${code}`);
}

export async function ensureReferralCode(env: Env, accountId: string): Promise<string> {
  if (!env.DB) throw new Error('Referral store is not configured.');
  const existing = await env.DB.prepare(`SELECT code FROM referral_codes WHERE account_id = ?`)
    .bind(accountId)
    .first<{ code: string }>();
  if (existing?.code) return existing.code;

  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    const code = generateReferralCode(bytes);
    try {
      await env.DB.prepare(
        `INSERT INTO referral_codes (account_id, code, code_hash, created_at) VALUES (?, ?, ?, ?)`,
      )
        .bind(accountId, code, await codeHash(code), Date.now())
        .run();
      return code;
    } catch {
      const again = await env.DB.prepare(`SELECT code FROM referral_codes WHERE account_id = ?`)
        .bind(accountId)
        .first<{ code: string }>();
      if (again?.code) return again.code;
    }
  }
  throw new Error('Could not create an invite code. Try again.');
}

async function loadProgression(env: Env, accountId: string): Promise<ProgRow> {
  const row = await env.DB!.prepare(
    `SELECT streak_weeks, last_mission_week, last_mission_at, visibility_level,
            honest_scout_count, last_honest_scout_day, week_scout_key, week_scout_count, updated_at
     FROM user_progression WHERE account_id = ?`,
  )
    .bind(accountId)
    .first<ProgRow>();
  return (
    row || {
      streak_weeks: 0,
      last_mission_week: null,
      last_mission_at: null,
      visibility_level: 'explorer',
      honest_scout_count: 0,
      last_honest_scout_day: null,
      week_scout_key: null,
      week_scout_count: 0,
      updated_at: 0,
    }
  );
}

async function completedMissionCount(env: Env, accountId: string): Promise<number> {
  const row = await env.DB!.prepare(
    `SELECT COUNT(*) AS n FROM user_missions WHERE account_id = ? AND status = 'completed'`,
  )
    .bind(accountId)
    .first<{ n: number }>();
  return Number(row?.n || 0);
}

async function saveProgression(
  env: Env,
  accountId: string,
  row: ProgRow,
  missionsCompleted: number,
): Promise<VisibilityLevel> {
  const level = visibilityLevel({
    honestScoutCount: row.honest_scout_count,
    missionsCompleted,
    streakWeeks: row.streak_weeks,
  });
  const now = Date.now();
  await env.DB!.prepare(
    `INSERT INTO user_progression (
       account_id, streak_weeks, last_mission_week, last_mission_at, visibility_level,
       honest_scout_count, last_honest_scout_day, week_scout_key, week_scout_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       streak_weeks = excluded.streak_weeks,
       last_mission_week = excluded.last_mission_week,
       last_mission_at = excluded.last_mission_at,
       visibility_level = excluded.visibility_level,
       honest_scout_count = excluded.honest_scout_count,
       last_honest_scout_day = excluded.last_honest_scout_day,
       week_scout_key = excluded.week_scout_key,
       week_scout_count = excluded.week_scout_count,
       updated_at = excluded.updated_at`,
  )
    .bind(
      accountId,
      row.streak_weeks,
      row.last_mission_week,
      row.last_mission_at,
      level,
      row.honest_scout_count,
      row.last_honest_scout_day,
      row.week_scout_key,
      row.week_scout_count,
      now,
    )
    .run();
  return level;
}

export interface RetentionSnapshot {
  code: string | null;
  startParam: string | null;
  inviteUrl: string | null;
  bonusRemaining: number;
  creditsPerSide: number;
  progression: {
    visibilityLevel: VisibilityLevel;
    label: string;
    streakWeeks: number;
    honestScoutCount: number;
  };
  missions: Array<{
    key: string;
    title: string;
    detail: string;
    status: 'open' | 'completed';
    clientCompletable: boolean;
  }>;
  nudge: string;
}

export async function readRetentionSnapshot(env: Env, accountId: string, code?: string | null): Promise<RetentionSnapshot> {
  const week = isoWeekKey(new Date());
  const prog = env.DB ? await loadProgression(env, accountId) : null;
  const missionsCompleted = env.DB ? await completedMissionCount(env, accountId) : 0;
  const level = visibilityLevel({
    honestScoutCount: prog?.honest_scout_count || 0,
    missionsCompleted,
    streakWeeks: prog?.streak_weeks || 0,
  });
  const done = new Set<string>();
  if (env.DB) {
    const rows = await env.DB.prepare(
      `SELECT mission_key, status FROM user_missions WHERE account_id = ? AND week_key = ?`,
    )
      .bind(accountId, week)
      .all<{ mission_key: string; status: string }>();
    for (const row of rows.results || []) {
      if (row.status === 'completed') done.add(row.mission_key);
    }
  }
  const resolvedCode = code ?? null;
  return {
    code: resolvedCode,
    startParam: resolvedCode ? `ref_${resolvedCode}` : null,
    inviteUrl: resolvedCode ? inviteUrlForCode(resolvedCode) : null,
    bonusRemaining: await referralBonusRemaining(env, accountId),
    creditsPerSide: REFERRAL_SCOUT_CREDITS,
    progression: {
      visibilityLevel: level,
      label: visibilityLevelLabel(level),
      streakWeeks: prog?.streak_weeks || 0,
      honestScoutCount: prog?.honest_scout_count || 0,
    },
    missions: WEEKLY_MISSIONS.map((mission) => ({
      key: mission.key,
      title: mission.title,
      detail: mission.detail,
      status: done.has(mission.key) ? 'completed' : 'open',
      clientCompletable: mission.clientCompletable,
    })),
    nudge: formatWeeklyMissionNudge({ level, streakWeeks: prog?.streak_weeks || 0 }),
  };
}

async function markMissionComplete(
  env: Env,
  accountId: string,
  missionKey: MissionKey,
): Promise<{ created: boolean }> {
  const week = isoWeekKey(new Date());
  const now = Date.now();
  const existing = await env.DB!.prepare(
    `SELECT status FROM user_missions WHERE account_id = ? AND mission_key = ? AND week_key = ?`,
  )
    .bind(accountId, missionKey, week)
    .first<{ status: string }>();
  if (existing?.status === 'completed') return { created: false };

  if (existing) {
    await env.DB!.prepare(
      `UPDATE user_missions SET status = 'completed', completed_at = ? WHERE account_id = ? AND mission_key = ? AND week_key = ?`,
    )
      .bind(now, accountId, missionKey, week)
      .run();
  } else {
    await env.DB!.prepare(
      `INSERT INTO user_missions (id, account_id, mission_key, week_key, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
    )
      .bind(randomId('msn'), accountId, missionKey, week, now, now)
      .run();
  }

  const prog = await loadProgression(env, accountId);
  if (prog.last_mission_week !== week) {
    prog.streak_weeks = nextStreakWeeks(prog.streak_weeks, prog.last_mission_week, week);
    prog.last_mission_week = week;
  }
  prog.last_mission_at = now;
  const missionsCompleted = await completedMissionCount(env, accountId);
  await saveProgression(env, accountId, prog, missionsCompleted);
  return { created: true };
}

export async function claimReferral(
  env: Env,
  input: { accountId: string; code: string },
): Promise<{ ok: true; status: 'attributed' | 'already' } | { ok: false; status: string; error: string }> {
  if (!env.DB) return { ok: false, status: 'no_db', error: 'Referral store is not configured.' };
  const code = normalizeReferralCode(input.code);
  if (!code) return { ok: false, status: 'invalid', error: 'That invite code is not valid.' };

  const allowed = await allowRate(env, `refclaim:${input.accountId}:${hourBucket()}`, REFERRAL_CLAIM_LIMIT_PER_HOUR);
  if (!allowed) return { ok: false, status: 'rate_limited', error: 'Too many invite attempts. Try again later.' };

  const hash = await codeHash(code);
  const owner = await env.DB.prepare(`SELECT account_id FROM referral_codes WHERE code_hash = ?`)
    .bind(hash)
    .first<{ account_id: string }>();
  if (!owner?.account_id) return { ok: false, status: 'invalid', error: 'That invite code is not valid.' };

  const existing = await env.DB.prepare(
    `SELECT referrer_account_id FROM referral_attributions WHERE referred_account_id = ?`,
  )
    .bind(input.accountId)
    .first<{ referrer_account_id: string }>();

  const decision = attributionDecision({
    referrerAccountId: owner.account_id,
    referredAccountId: input.accountId,
    existingReferrerAccountId: existing?.referrer_account_id,
  });
  if (!decision.ok && decision.status === 'self') {
    return { ok: false, status: 'self', error: 'You cannot use your own invite.' };
  }
  if (!decision.ok && decision.status === 'already_other') {
    return { ok: false, status: 'already_other', error: 'This account is already linked to an invite.' };
  }
  if (decision.ok && decision.status === 'already') return { ok: true, status: 'already' };

  try {
    await env.DB.prepare(
      `INSERT INTO referral_attributions (referred_account_id, referrer_account_id, code_hash, attributed_at, qualified_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
      .bind(input.accountId, owner.account_id, hash, Date.now())
      .run();
  } catch {
    const raced = await env.DB.prepare(
      `SELECT referrer_account_id FROM referral_attributions WHERE referred_account_id = ?`,
    )
      .bind(input.accountId)
      .first<{ referrer_account_id: string }>();
    if (raced?.referrer_account_id === owner.account_id) return { ok: true, status: 'already' };
    return { ok: false, status: 'already_other', error: 'This account is already linked to an invite.' };
  }
  return { ok: true, status: 'attributed' };
}

/**
 * Both credit rows and qualified_at commit together.
 * A thrown batch rolls back, so qualified_at stays null and a later qualify can pay both sides.
 * INSERT OR IGNORE lets a retry finish a pair if one row already exists.
 * Returns true only when this call set qualified_at.
 */
async function grantQualifiedPair(
  env: Env,
  referredAccountId: string,
  referrerAccountId: string,
  now: number,
): Promise<boolean> {
  const db = env.DB!;
  const referrerReason = `qualified:${referredAccountId}:referrer`;
  const referredReason = `qualified:${referredAccountId}:referred`;
  const credit = (id: string, accountId: string, reason: string) =>
    db.prepare(
      `INSERT OR IGNORE INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at)
       VALUES (?, ?, 'hosted_scout_credit', ?, ?, ?, ?)`,
    ).bind(id, accountId, REFERRAL_SCOUT_CREDITS, REFERRAL_SCOUT_CREDITS, reason, now);

  const results = await db.batch([
    credit(randomId('rwd'), referrerAccountId, referrerReason),
    credit(randomId('rwd'), referredAccountId, referredReason),
    db.prepare(
      `UPDATE referral_attributions
       SET qualified_at = ?
       WHERE referred_account_id = ?
         AND qualified_at IS NULL
         AND EXISTS (SELECT 1 FROM referral_rewards WHERE account_id = ? AND reason = ?)
         AND EXISTS (SELECT 1 FROM referral_rewards WHERE account_id = ? AND reason = ?)`,
    ).bind(now, referredAccountId, referrerAccountId, referrerReason, referredAccountId, referredReason),
  ]);
  return Number(results[2]?.meta?.changes || 0) > 0;
}

export async function qualifyReferral(
  env: Env,
  input: { accountId: string; body: Record<string, unknown> },
): Promise<
  | { ok: true; rewardsGranted: boolean; qualified: boolean; reason: string }
  | { ok: false; error: string; code: string }
> {
  if (!env.DB) return { ok: false, error: 'Referral store is not configured.', code: 'NO_DB' };
  const allowed = await allowRate(env, `refqual:${input.accountId}:${hourBucket()}`, REFERRAL_QUALIFY_LIMIT_PER_HOUR);
  if (!allowed) return { ok: false, error: 'Too many scout credits checks. Try again later.', code: 'RATE_LIMITED' };

  const assessed = assessHonestScout(input.body, safePublicHostname);
  if (!assessed.ok) return assessed;

  const rawReceipt = input.body.receipt;
  if (typeof rawReceipt !== 'string' || !rawReceipt.trim()) {
    return {
      ok: false,
      error: 'Scout credits need a Worker receipt from a signed-in Instant Scout. A raw status post does not qualify.',
      code: 'NO_RECEIPT',
    };
  }
  let receiptOk = false;
  try {
    receiptOk = await consumeScoutReceipt(env, input.accountId, rawReceipt, assessed.domain);
  } catch {
    return {
      ok: false,
      error: 'Scout receipt store is not ready. Apply the referrals migration before qualifying.',
      code: 'NO_DB',
    };
  }
  if (!receiptOk) {
    return {
      ok: false,
      error: 'That scout receipt is missing, expired, already used, or for a different site. Run Instant Scout again.',
      code: 'RECEIPT_REJECTED',
    };
  }

  const now = Date.now();
  const today = utcDay(now);
  const attribution = await env.DB.prepare(
    `SELECT referrer_account_id, qualified_at FROM referral_attributions WHERE referred_account_id = ?`,
  )
    .bind(input.accountId)
    .first<{ referrer_account_id: string; qualified_at: number | null }>();

  let rewardsGranted = false;
  if (attribution && attribution.qualified_at == null) {
    try {
      rewardsGranted = await grantQualifiedPair(env, input.accountId, attribution.referrer_account_id, now);
    } catch {
      rewardsGranted = false;
    }
    if (!rewardsGranted) {
      const after = await env.DB.prepare(
        `SELECT qualified_at FROM referral_attributions WHERE referred_account_id = ?`,
      )
        .bind(input.accountId)
        .first<{ qualified_at: number | null }>();
      if (after?.qualified_at == null) {
        return {
          ok: false,
          error: 'Invite credits could not be saved. Run the scout again to retry. Nothing was marked qualified.',
          code: 'GRANT_FAILED',
        };
      }
    }
  }

  const prog = await loadProgression(env, input.accountId);
  const week = isoWeekKey(new Date(now));
  if (prog.week_scout_key !== week) {
    prog.week_scout_key = week;
    prog.week_scout_count = 0;
  }
  let scoutAdvanced = false;
  if (prog.last_honest_scout_day !== today) {
    prog.honest_scout_count += 1;
    prog.last_honest_scout_day = today;
    prog.week_scout_count += 1;
    scoutAdvanced = true;
  } else if (prog.week_scout_count < 2) {
    // The second honest run of this week can land on the same UTC day. Later runs are once per day.
    prog.week_scout_count += 1;
    if (prog.honest_scout_count < 2) prog.honest_scout_count += 1;
    scoutAdvanced = true;
  }
  const missionsCompleted = await completedMissionCount(env, input.accountId);
  await saveProgression(env, input.accountId, prog, missionsCompleted);
  if (scoutAdvanced && prog.week_scout_count >= 2) {
    await markMissionComplete(env, input.accountId, 'rescout');
  }

  return {
    ok: true,
    rewardsGranted,
    qualified: Boolean(attribution),
    reason: rewardsGranted ? 'granted' : attribution ? 'already_qualified' : 'no_attribution',
  };
}

export async function completeClientMission(
  env: Env,
  input: { accountId: string; missionKey: unknown },
): Promise<{ ok: true; created: boolean } | { ok: false; error: string; code: string }> {
  if (!env.DB) return { ok: false, error: 'Referral store is not configured.', code: 'NO_DB' };
  const key = clientMissionKey(input.missionKey);
  if (!key) {
    return {
      ok: false,
      error: 'That mission cannot be marked from the client. Re-scout finishes when a second honest Instant Scout this week completes.',
      code: 'MISSION_NOT_CLIENT',
    };
  }
  const result = await markMissionComplete(env, input.accountId, key);
  return { ok: true, created: result.created };
}

function requireIdentity(user: HostedIdentity | null, error?: string): Response | null {
  if (error || !user) {
    return json(
      {
        ok: false,
        error: error || 'Sign in with Telegram or your account before using invites or bonus scouts.',
        code: 'AUTH_REQUIRED',
      },
      401,
    );
  }
  return null;
}

export async function handleReferralRoute(request: Request, env: Env, path: string): Promise<Response> {
  const who = await identify(request, env);
  const denied = requireIdentity(who.user, who.error);
  if (denied) return denied;
  const user = who.user!;
  if (!env.DB) return json({ ok: false, error: 'Referral store is not configured.', code: 'NO_DB' }, 503);
  const accountId = billingId(user);

  if (path === '/referrals/me' && request.method === 'GET') {
    try {
      const code = await ensureReferralCode(env, accountId);
      const snapshot = await readRetentionSnapshot(env, accountId, code);
      return json({ ok: true, ...snapshot });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : 'Could not load invites.' }, 503);
    }
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ error: read.error }, read.status);
  const body = (read.value && typeof read.value === 'object' ? read.value : {}) as Record<string, unknown>;

  if (path === '/referrals/claim') {
    const result = await claimReferral(env, { accountId, code: String(body.code || '') });
    if (!result.ok && result.status === 'rate_limited') {
      return json({ ok: false, error: result.error, code: 'RATE_LIMITED' }, 429);
    }
    if (!result.ok && result.status === 'no_db') return json({ ok: false, error: result.error, code: 'NO_DB' }, 503);
    if (!result.ok) return json({ ok: false, error: result.error, status: result.status }, result.status === 'already_other' ? 409 : 400);
    return json({ ok: true, status: result.status });
  }

  if (path === '/referrals/qualify') {
    const result = await qualifyReferral(env, { accountId, body });
    if (!result.ok) {
      const status = result.code === 'RATE_LIMITED' ? 429 : result.code === 'NO_DB' || result.code === 'GRANT_FAILED' ? 503 : 400;
      return json({ ok: false, error: result.error, code: result.code }, status);
    }
    return json(result);
  }

  if (path === '/missions/complete') {
    const result = await completeClientMission(env, { accountId, missionKey: body.missionKey });
    if (!result.ok) return json({ ok: false, error: result.error, code: result.code }, 400);
    return json({ ok: true, created: result.created });
  }

  return json({ error: 'Not found' }, 404);
}
