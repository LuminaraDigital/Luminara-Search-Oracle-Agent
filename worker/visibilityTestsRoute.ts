/**
 * Visibility Unit Tests routes. The client sends raw answers it collected; the Worker grades them.
 *   POST /visibility-tests/runs                 save raw, write verdict rows
 *   GET  /visibility-tests/runs?domain=&limit=  run summaries, newest first
 *   GET  /visibility-tests/runs/:id             full verdicts, never raw text
 *   POST /visibility-tests/runs/:id/regrade     re-score the saved raw record with no provider call
 *   GET  /visibility-tests/scorecard?domain=    quality, cost and refusals per model
 */
import type { Env } from './env';
import { getActiveSubscription } from './quotaMiddleware';
import { meterDailyUse } from './securityHardening';
import { MAX_BODY_BYTES, readBody } from './security';
import { billingId, identify, json } from './workerUtils';
import {
  cleanDomain,
  findRun,
  getRunVerdicts,
  listRuns,
  providerScorecard,
  regradeRun,
  sanitizeFacts,
  sanitizeRun,
  saveRun,
} from './visibilityTests';

/** Each run writes to R2 and D1, and new accounts are free, so writes need a daily ceiling as well as a per-minute one. */
const FREE_RUNS_PER_DAY = 30;
const PAID_RUNS_PER_DAY = 300;
const REGRADES_PER_DAY = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const RUN_PATH = /^\/visibility-tests\/runs\/([0-9a-f-]{36})(\/regrade)?$/;

export async function handleVisibilityTestsRoute(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const who = await identify(request, env);
  if (who.error || !who.user) {
    return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
  }
  const accountId = billingId(who.user);
  const url = new URL(request.url);
  const domain = cleanDomain(url.searchParams.get('domain') || '');

  if (path === '/visibility-tests/scorecard' && request.method === 'GET') {
    return json({ ok: true, scorecard: await providerScorecard(env, accountId, domain) });
  }

  if (path === '/visibility-tests/runs') {
    if (request.method === 'GET') {
      const requested = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
      const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), MAX_LIMIT) : DEFAULT_LIMIT;
      const kind = url.searchParams.get('kind') === 'audit' ? 'audit' : undefined;
      return json({ ok: true, runs: await listRuns(env, accountId, domain, limit, kind) });
    }
    if (request.method === 'POST') {
      const read = await readBody(request, MAX_BODY_BYTES);
      if (!read.ok) return json({ ok: false, error: read.error }, read.status);
      const now = Date.now();
      const checked = sanitizeRun(read.value, now);
      if (!checked.ok) return json({ ok: false, error: checked.error, code: 'INVALID_RUN' }, 400);
      const sub = await getActiveSubscription(env, who.user);
      const paid = Boolean(sub?.plan) && sub?.plan !== 'free';
      const meter = await meterDailyUse(env, 'visibility_run', accountId, paid ? PAID_RUNS_PER_DAY : FREE_RUNS_PER_DAY, 'Visibility check');
      if (!meter.ok) return json({ ok: false, error: meter.error, code: 'VISIBILITY_QUOTA' }, 429);
      return json({ ok: true, ...(await saveRun(env, accountId, checked.run, now, sub?.plan)) });
    }
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const match = RUN_PATH.exec(path);
  if (!match) return json({ ok: false, error: 'Not found' }, 404);
  const [, runId, regrade] = match;
  if (!regrade && request.method === 'GET') {
    const found = await getRunVerdicts(env, accountId, runId);
    return found ? json({ ok: true, ...found }) : json({ ok: false, error: 'Run not found' }, 404);
  }
  if (regrade && request.method === 'POST') {
    const row = await findRun(env, accountId, runId);
    if (!row) return json({ ok: false, error: 'Run not found' }, 404);
    const meter = await meterDailyUse(env, 'visibility_regrade', accountId, REGRADES_PER_DAY, 'Visibility recheck');
    if (!meter.ok) return json({ ok: false, error: meter.error, code: 'VISIBILITY_QUOTA' }, 429);
    const read = await readBody(request, MAX_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const sent = (read.value as { facts?: unknown } | null)?.facts;
    const facts = sent === undefined ? null : sanitizeFacts(sent);
    if (sent !== undefined && !facts) return json({ ok: false, error: 'facts.domain required', code: 'INVALID_RUN' }, 400);
    const regraded = await regradeRun(env, row, facts, Date.now());
    if (!regraded) {
      return json({ ok: false, error: 'The saved answers for this run are not available, so it cannot be checked again.', code: 'RAW_NOT_STORED' }, 409);
    }
    return json({ ok: true, ...regraded });
  }
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
