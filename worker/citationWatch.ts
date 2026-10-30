/**
 * Citation Watch routes and the daily cron tick.
 * Runs are stored in D1. Counts stay null unless the probe measured every prompt.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { classifyCitationWatch } from '../services/citationWatch/classify';
import { cadenceIntervalMs, citationWatchThresholds, watchCadenceAllowed } from '../services/citationWatch/thresholds';
import {
  isCitationWatchEngine,
  isWatchCadence,
  type CitationWatchEngine,
  type ClassifiedWatch,
  type MeasuredPoint,
  type WatchCadence,
  type WatchMeasurement,
} from '../services/citationWatch/types';
import { own } from '../services/own';
import { parsePromptList } from '../services/promptList';
import { sha256HexOf, canonicalJson } from '../services/trust/receiptCrypto';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { getActiveSubscription } from './quotaMiddleware';
import { billingId, json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody, safePublicHostname } from './security';
import { envHasDataForSeo } from '../services/config/runtimeKeys';
import { dataForSeoPost, dfsFirstResult } from './dataForSeoClient';

const PAGE = 25;
/** shortcut: one cron fire stops after this many runs, the next daily fire continues */
const MAX_PER_TICK = 500;
const RUN_HISTORY = 30;

export type CitationProbeResult = WatchMeasurement;

export type CitationProbe = (input: {
  env: Env;
  engine: CitationWatchEngine;
  domain: string;
  prompts: string[];
}) => Promise<CitationProbeResult>;

export type CitationWatchDeps = {
  now?: () => number;
  /** Cron scheduledTime. Claim anchors here so a late start does not skip the next fire. */
  scheduledAt?: number;
  probe?: CitationProbe;
};

type WatchRow = {
  id: string;
  account_id: string;
  client_id: string;
  domain: string;
  engine: string;
  prompts_json: string;
  prompts_sha256: string;
  cadence: string;
  active: number;
  next_run_at: number | null;
  created_at: number;
};

function nowMs(deps: CitationWatchDeps): number {
  return deps.now ? deps.now() : Date.now();
}

function missingTable(err: unknown): boolean {
  return /no such table: citation_watch/i.test(err instanceof Error ? err.message : String(err));
}

export async function defaultCitationProbe(input: {
  env: Env;
  engine: CitationWatchEngine;
  domain: string;
  prompts: string[];
}): Promise<CitationProbeResult> {
  if (String(input.env.CITATION_WATCH_LIVE || '') !== 'true') {
    return { status: 'not_measured', method: 'none', reason: 'Live probes are off. CITATION_WATCH_LIVE is not true.' };
  }
  if (!envHasDataForSeo(input.env)) {
    return {
      status: 'not_measured',
      method: 'none',
      reason: 'No per-prompt product probe is connected for this engine. Citation share was not measured.',
    };
  }
  const target = input.domain.replace(/^www\./i, '').toLowerCase();
  const platform =
    input.engine === 'chatgpt' ? 'chat_gpt' : input.engine === 'google_aio' ? 'google' : 'perplexity';
  const cited: boolean[] = [];
  for (const prompt of input.prompts) {
    const res = await dataForSeoPost(
      input.env,
      '/v3/ai_optimization/llm_mentions/search_mentions/live',
      [
        {
          keywords: [prompt],
          location_code: 2840,
          language_code: 'en',
          platform,
          filters: ['and', [['domain', '=', target]]],
          limit: 5,
        },
      ],
    );
    if (!res.ok) {
      return {
        status: 'not_measured',
        method: 'none',
        reason: res.error || res.code || 'DataForSEO per-prompt probe failed.',
      };
    }
    const first = dfsFirstResult(res.body);
    if (first && typeof first === 'object' && (first as { _dfsTaskError?: boolean })._dfsTaskError) {
      return {
        status: 'not_measured',
        method: 'none',
        reason: 'DataForSEO task error during per-prompt probe.',
      };
    }
    const rows = Array.isArray(first) ? first : [];
    const hit = rows.some((row) => {
      const r = row as Record<string, unknown>;
      const snippet = String(r.answer || r.snippet || r.title || '').toLowerCase();
      return snippet.includes(target) || Boolean(r.mentioned);
    });
    cited.push(hit);
  }
  return {
    status: 'measured',
    method: 'dataforseo_llm_mentions',
    modelId: input.engine,
    cited,
  };
}

function storedPrompts(json: string): string[] | null {
  try {
    const parsed = parsePromptList(JSON.parse(json));
    return parsed.ok ? parsed.prompts : null;
  } catch {
    return null;
  }
}

function measurementStatus(measurement: WatchMeasurement): 'measured' | 'not_measured' {
  return measurement.status === 'measured' ? 'measured' : 'not_measured';
}

async function insertRun(
  env: Env,
  watchId: string,
  accountId: string,
  engine: string,
  ranAt: number,
  measurement: WatchMeasurement,
  classified: ClassifiedWatch,
): Promise<string> {
  const id = `cwr_${crypto.randomUUID().replace(/-/g, '')}`;
  const observations = JSON.stringify(
    measurement.status === 'measured'
      ? { method: measurement.method, modelId: measurement.modelId, cited: measurement.cited }
      : { reason: measurement.reason },
  );
  await env.DB!.prepare(
    `INSERT INTO citation_watch_runs
      (id, watch_id, account_id, engine, ran_at, measurement_status, method, model_id, cited_count, prompt_count, share, verdict, compared_to_run_id, delta_share, observations_json, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      watchId,
      accountId,
      engine,
      ranAt,
      measurementStatus(measurement),
      measurement.status === 'measured' ? measurement.method : 'none',
      measurement.status === 'measured' ? measurement.modelId : null,
      classified.citedCount,
      classified.promptCount,
      classified.share,
      classified.verdict,
      classified.comparedToRunId,
      classified.deltaShare,
      observations,
      classified.reason,
    )
    .run();
  return id;
}

async function priorMeasured(env: Env, watchId: string): Promise<MeasuredPoint[]> {
  const { results } = await env.DB!.prepare(
    `SELECT id, cited_count, prompt_count FROM citation_watch_runs
     WHERE watch_id = ? AND measurement_status = 'measured' AND cited_count IS NOT NULL AND prompt_count IS NOT NULL
     ORDER BY ran_at ASC`,
  )
    .bind(watchId)
    .all<{ id: string; cited_count: number; prompt_count: number }>();
  return (results || []).map((row) => ({ runId: row.id, citedCount: row.cited_count, promptCount: row.prompt_count }));
}

async function recordRun(env: Env, row: WatchRow, prompts: string[], deps: CitationWatchDeps): Promise<Record<string, unknown>> {
  const probe = deps.probe || defaultCitationProbe;
  const engine = isCitationWatchEngine(row.engine) ? row.engine : null;
  let measurement: WatchMeasurement;
  if (!engine) {
    measurement = { status: 'not_measured', method: 'none', reason: 'The stored engine is not one this watch can classify.' };
  } else {
    try {
      measurement = await probe({ env, engine, domain: row.domain, prompts });
    } catch (err) {
      console.error('[citation-watch] probe failed', err instanceof Error ? err.name : 'error');
      measurement = { status: 'not_measured', method: 'none', reason: 'The probe failed before a citation was observed.' };
    }
  }
  if (measurement.status === 'measured' && measurement.cited.length !== prompts.length) {
    measurement = { status: 'not_measured', method: 'none', reason: 'The probe did not return one observation per prompt.' };
  }
  const thresholds = citationWatchThresholds(env.CITATION_WATCH_THRESHOLDS);
  const classified = classifyCitationWatch({
    engine: engine || 'chatgpt',
    measurement,
    priorMeasured: await priorMeasured(env, row.id),
    thresholds,
  });
  const ranAt = nowMs(deps);
  const id = await insertRun(env, row.id, row.account_id, row.engine, ranAt, measurement, classified);
  return {
    id,
    verdict: classified.verdict,
    measurementStatus: measurementStatus(measurement),
    citedCount: classified.citedCount,
    promptCount: classified.promptCount,
    share: classified.share,
    deltaShare: classified.deltaShare,
    comparedToRunId: classified.comparedToRunId,
    reason: classified.reason,
    ranAt,
  };
}

function watchJson(row: WatchRow, prompts: boolean): Record<string, unknown> {
  return {
    id: row.id,
    clientId: row.client_id || null,
    domain: row.domain,
    engine: row.engine,
    promptsSha256: row.prompts_sha256,
    ...(prompts ? { prompts: storedPrompts(row.prompts_json) } : {}),
    cadence: row.cadence,
    active: row.active === 1,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  };
}

async function readWatch(env: Env, id: string, accountId: string): Promise<WatchRow | null> {
  return env.DB!.prepare(`SELECT * FROM citation_watches WHERE id = ? AND account_id = ?`)
    .bind(id, accountId)
    .first<WatchRow>();
}

export async function handleCitationWatchRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
  deps: CitationWatchDeps = {},
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Citation Watch needs D1.', code: 'D1_UNAVAILABLE' }, 503);
  const accountId = billingId(user);

  try {
    if (path === '/citation-watches' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT * FROM citation_watches WHERE account_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(accountId)
        .all<WatchRow>();
      return json({ ok: true, watches: (results || []).map((row) => watchJson(row, false)) });
    }

    if (path === '/citation-watches' && request.method === 'POST') {
      const read = await readBody(request, MAX_SMALL_BODY_BYTES);
      if (!read.ok) return json({ ok: false, error: read.error }, read.status);
      const body = read.value;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'JSON object required.' }, 400);
      const domain = safePublicHostname(typeof own(body, 'domain') === 'string' ? String(own(body, 'domain')) : '');
      if (!domain) return json({ ok: false, error: 'domain must be a public hostname such as acme.com.' }, 400);
      const engineRaw = own(body, 'engine');
      if (typeof engineRaw !== 'string' || !isCitationWatchEngine(engineRaw)) {
        return json({ ok: false, error: 'engine must be chatgpt, google_aio, or perplexity.' }, 400);
      }
      const parsedPrompts = parsePromptList(own(body, 'prompts'));
      if (!parsedPrompts.ok) return json({ ok: false, error: parsedPrompts.error }, 400);
      const prompts = parsedPrompts.prompts;
      const clientRaw = own(body, 'clientId');
      const clientId = clientRaw == null || clientRaw === '' ? '' : typeof clientRaw === 'string' ? clientRaw.trim() : null;
      if (clientId === null || clientId.length > 64 || (clientId && !/^[a-zA-Z0-9_-]+$/.test(clientId))) {
        return json({ ok: false, error: 'clientId must be empty or 1 to 64 letters, numbers, "_" or "-".' }, 400);
      }
      const sub = await getActiveSubscription(env, user);
      const plan = entitlementsFor(sub?.plan);
      const planCadence = plan.scheduledReaudit;
      if (planCadence === 'none' || plan.sentinelLimit <= 0) {
        return json({ ok: false, error: 'Citation Watch needs a plan with scheduled re-audits.', code: 'PLAN_LIMIT' }, 402);
      }
      const requested = own(body, 'cadence');
      const cadence: WatchCadence = typeof requested === 'string' && isWatchCadence(requested) ? requested : planCadence;
      if (!watchCadenceAllowed(planCadence, cadence)) {
        return json(
          { ok: false, error: `This plan's schedule is ${planCadence}. ${cadence} is faster than the plan allows.`, code: 'PLAN_LIMIT' },
          402,
        );
      }
      const owned = await env.DB.prepare(`SELECT COUNT(*) AS n FROM citation_watches WHERE account_id = ? AND active = 1`)
        .bind(accountId)
        .first<{ n: number }>();
      if (Number(owned?.n ?? 0) >= plan.sentinelLimit) {
        return json({ ok: false, error: `This plan allows ${plan.sentinelLimit} citation watches.`, code: 'PLAN_LIMIT', limit: plan.sentinelLimit }, 402);
      }
      const id = `cw_${crypto.randomUUID().replace(/-/g, '')}`;
      const createdAt = nowMs(deps);
      const promptsJson = JSON.stringify(prompts);
      const promptsSha = await sha256HexOf(canonicalJson(prompts));
      try {
        await env.DB.prepare(
          `INSERT INTO citation_watches
            (id, account_id, client_id, domain, engine, prompts_json, prompts_sha256, cadence, active, next_run_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
          .bind(id, accountId, clientId, domain, engineRaw, promptsJson, promptsSha, cadence, createdAt, createdAt)
          .run();
      } catch (err) {
        if (/unique/i.test(err instanceof Error ? err.message : String(err))) {
          return json({ ok: false, error: 'A watch already exists for this client, domain, engine, and prompt set.', code: 'WATCH_EXISTS' }, 409);
        }
        throw err;
      }
      const row = await readWatch(env, id, accountId);
      const minPrompts = citationWatchThresholds(env.CITATION_WATCH_THRESHOLDS)[engineRaw].minPrompts;
      const warning = prompts.length < minPrompts
        ? `This set has ${prompts.length} prompts. Consistent and drift need ${minPrompts} measured prompts.`
        : undefined;
      return json({ ok: true, watch: row ? watchJson(row, true) : { id }, ...(warning ? { warning } : {}) }, 201);
    }

    const match = path.match(/^\/citation-watches\/(cw_[a-f0-9]{32})(\/run)?$/);
    if (!match) return json({ ok: false, error: 'Not found.' }, 404);
    const id = match[1];
    const row = await readWatch(env, id, accountId);
    if (!row) return json({ ok: false, error: 'Watch not found.' }, 404);

    if (match[2] === '/run') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (row.active !== 1) return json({ ok: false, error: 'This watch is inactive.', code: 'WATCH_INACTIVE' }, 409);
      if (String(env.CITATION_WATCH_LIVE || '') !== 'true') {
        return json({ ok: false, error: 'Citation Watch live runs are off.', code: 'CITATION_WATCH_OFF' }, 403);
      }
      const sub = await getActiveSubscription(env, user);
      const plan = entitlementsFor(sub?.plan);
      if (plan.scheduledReaudit === 'none' || plan.sentinelLimit <= 0 || !isWatchCadence(row.cadence) || !watchCadenceAllowed(plan.scheduledReaudit, row.cadence)) {
        return json({ ok: false, error: 'This plan cannot run this watch.', code: 'PLAN_LIMIT' }, 402);
      }
      const now = nowMs(deps);
      if (row.next_run_at != null && row.next_run_at > now) {
        return json({ ok: false, error: 'This watch is not due yet.', code: 'WATCH_NOT_DUE', nextRunAt: row.next_run_at }, 429);
      }
      const claimed = await env.DB.prepare(
        `UPDATE citation_watches SET next_run_at = ? WHERE id = ? AND account_id = ? AND active = 1 AND (next_run_at IS NULL OR next_run_at <= ?)`,
      )
        .bind(now + cadenceIntervalMs(row.cadence), id, accountId, now)
        .run();
      if (Number(claimed.meta?.changes ?? 0) !== 1) {
        return json({ ok: false, error: 'This watch is not due yet.', code: 'WATCH_NOT_DUE' }, 429);
      }
      const prompts = storedPrompts(row.prompts_json);
      if (!prompts) return json({ ok: false, error: 'The stored prompt set could not be read.', code: 'PROMPT_SET_UNREADABLE' }, 500);
      const run = await recordRun(env, row, prompts, deps);
      return json({ ok: true, run });
    }

    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT id, ran_at, measurement_status, cited_count, prompt_count, share, verdict, compared_to_run_id, delta_share, reason, method, model_id
         FROM citation_watch_runs WHERE watch_id = ? AND account_id = ? ORDER BY ran_at DESC LIMIT ?`,
      )
        .bind(id, accountId, RUN_HISTORY)
        .all<{
          id: string;
          ran_at: number;
          measurement_status: string;
          cited_count: number | null;
          prompt_count: number | null;
          share: number | null;
          verdict: string;
          compared_to_run_id: string | null;
          delta_share: number | null;
          reason: string;
          method: string;
          model_id: string | null;
        }>();
      return json({
        ok: true,
        watch: watchJson(row, true),
        thresholds: citationWatchThresholds(env.CITATION_WATCH_THRESHOLDS)[isCitationWatchEngine(row.engine) ? row.engine : 'chatgpt'],
        runs: (results || []).map((run) => ({
          id: run.id,
          ranAt: run.ran_at,
          measurementStatus: run.measurement_status,
          citedCount: run.cited_count,
          promptCount: run.prompt_count,
          share: run.share,
          verdict: run.verdict,
          comparedToRunId: run.compared_to_run_id,
          deltaShare: run.delta_share,
          reason: run.reason,
          method: run.method,
          modelId: run.model_id,
        })),
      });
    }

    if (request.method === 'DELETE') {
      await env.DB.prepare(`UPDATE citation_watches SET active = 0 WHERE id = ? AND account_id = ?`).bind(id, accountId).run();
      return json({ ok: true, id, active: false });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    if (missingTable(err)) return json({ ok: false, error: 'Citation Watch tables are not migrated (0034).', code: 'CITATION_WATCH_TABLE_MISSING' }, 503);
    throw err;
  }
}

export async function runCitationWatchTick(env: Env, deps: CitationWatchDeps = {}): Promise<{ checked: number; skipped: 'live_off' | 'no_db' | null }> {
  if (String(env.CITATION_WATCH_LIVE || '') !== 'true') return { checked: 0, skipped: 'live_off' };
  if (!env.DB) return { checked: 0, skipped: 'no_db' };
  const now = nowMs(deps);
  const anchor = deps.scheduledAt ?? now;
  let checked = 0;
  while (checked < MAX_PER_TICK) {
    let due: WatchRow[] = [];
    try {
      const selected = await env.DB.prepare(
        `SELECT * FROM citation_watches WHERE active = 1 AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY next_run_at ASC LIMIT ?`,
      )
        .bind(now, PAGE)
        .all<WatchRow>();
      due = selected.results || [];
    } catch (err) {
      if (missingTable(err)) return { checked: 0, skipped: 'no_db' };
      throw err;
    }
    if (due.length === 0) break;
    let claimedAny = false;
    for (const row of due) {
      if (checked >= MAX_PER_TICK) break;
      const cadence = isWatchCadence(row.cadence) ? row.cadence : 'monthly';
      const claimed = await env.DB.prepare(
        `UPDATE citation_watches SET next_run_at = ? WHERE id = ? AND active = 1 AND (next_run_at IS NULL OR next_run_at <= ?)`,
      )
        .bind(anchor + cadenceIntervalMs(cadence), row.id, now)
        .run();
      if (Number(claimed.meta?.changes ?? 0) !== 1) continue;
      claimedAny = true;
      if (!isWatchCadence(row.cadence)) continue;
      try {
        const prompts = storedPrompts(row.prompts_json);
        if (!prompts) {
          const reason = 'The stored prompt set could not be read.';
          const measurement: WatchMeasurement = { status: 'not_measured', method: 'none', reason };
          await insertRun(
            env,
            row.id,
            row.account_id,
            row.engine,
            now,
            measurement,
            classifyCitationWatch({
              engine: isCitationWatchEngine(row.engine) ? row.engine : 'chatgpt',
              measurement,
              priorMeasured: [],
              thresholds: citationWatchThresholds(env.CITATION_WATCH_THRESHOLDS),
            }),
          );
        } else {
          await recordRun(env, row, prompts, deps);
        }
        checked += 1;
      } catch (err) {
        console.error('[citation-watch] run failed', row.id, err instanceof Error ? err.name : 'error');
      }
    }
    if (!claimedAny) break;
  }
  if (checked >= MAX_PER_TICK) console.error('[citation-watch] tick stopped at the per-fire cap');
  return { checked, skipped: null };
}
