import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KVNamespace } from '@cloudflare/workers-types';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import {
  EPISTEMIC_AB_COOKIE,
  EPISTEMIC_AB_HEADER,
  assignEpistemicVariant,
  bucketAccountVariant,
} from '../services/experiments/hermesAbExperiment';
import { EPISTEMIC_STANCE_RULE } from '../services/trust/epistemicStance';
import { VerificationLedger } from '../services/oracle/verificationLedger';
import { finalizeOracleHermesTurn } from '../worker/oracleHermesTurn';
import { handleOracleChatSse } from '../worker/oracleChat';
import { handleCitationWatchRoute, runCitationWatchTick } from '../worker/citationWatch';
import { enqueueDreamEvent } from '../worker/dreamingQueue';
import { executeDreamRun, handleDreamingRoute } from '../worker/dreamingService';

function stripJsoncComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('First-Party Hermes A/B Experiment, Wrangler Defaults & Runbook SQL Readout', () => {
  it('verifies root and production ship OFF while staging enables warn-soak and A/B flags in wrangler.jsonc', () => {
    const wranglerRaw = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8');
    expect(wranglerRaw).not.toContain('\u2014');
    const parsed = JSON.parse(stripJsoncComments(wranglerRaw)) as {
      vars: Record<string, string>;
      env: {
        staging: { vars: Record<string, string> };
        production: { vars: Record<string, string> };
      };
    };

    for (const [label, vars] of [
      ['root', parsed.vars],
      ['production', parsed.env.production.vars],
    ] as const) {
      expect(vars.THREAT_SCAN_MODE, `${label}.THREAT_SCAN_MODE`).toBe('off');
      expect(vars.EPISTEMIC_AB_ENABLED, `${label}.EPISTEMIC_AB_ENABLED`).toBe('false');
      expect(vars.ORACLE_LOOP_GUARDS_ENABLED, `${label}.ORACLE_LOOP_GUARDS_ENABLED`).toBe('false');
      expect(vars.MCP_DECLARED_COSTS_ENABLED, `${label}.MCP_DECLARED_COSTS_ENABLED`).toBe('false');
    }

    expect(parsed.env.staging.vars.THREAT_SCAN_MODE).toBe('warn');
    expect(parsed.env.staging.vars.EPISTEMIC_AB_ENABLED).toBe('true');
    expect(parsed.env.staging.vars.ORACLE_LOOP_GUARDS_ENABLED).toBe('true');
    expect(parsed.env.staging.vars.MCP_DECLARED_COSTS_ENABLED).toBe('true');
  });

  it('enforces kill-switch, QA overrides, crawler exclusion, deterministic account bucketing, and sticky guest cookies', () => {
    // 1. Kill switch off -> always baseline, no exposure tracking, no cookie.
    const off = assignEpistemicVariant({
      env: { EPISTEMIC_AB_ENABLED: 'false' },
      accountId: 'acct_any',
      request: new Request('https://luminarasuite.com/api/oracle/chat?epistemic=treatment'),
    });
    expect(off).toMatchObject({
      enabled: false,
      variant: 'baseline',
      setCookie: null,
      source: 'disabled',
      trackExposure: false,
    });

    const envOn = { EPISTEMIC_AB_ENABLED: 'true' };

    // 2. QA query/header overrides win even on curl User-Agent so QA smoke checks work deterministically.
    const headerOverride = assignEpistemicVariant({
      env: envOn,
      request: new Request('https://luminarasuite.com/api/oracle/chat', {
        headers: {
          'user-agent': 'curl/8.7.1',
          [EPISTEMIC_AB_HEADER]: 'treatment',
        },
      }),
    });
    expect(headerOverride).toMatchObject({
      enabled: true,
      variant: 'treatment',
      source: 'override',
      trackExposure: true,
    });
    expect(headerOverride.setCookie).toContain(`${EPISTEMIC_AB_COOKIE}=treatment`);

    // 3. Crawler UA without override stays on baseline and is excluded from exposure telemetry.
    const bot = assignEpistemicVariant({
      env: envOn,
      accountId: 'acct_crawler',
      request: new Request('https://luminarasuite.com/api/oracle/chat', {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      }),
    });
    expect(bot).toMatchObject({
      enabled: true,
      variant: 'baseline',
      source: 'bot',
      trackExposure: false,
    });

    // 4. Deterministic account bucketing agrees between headless executeDreamRun (no request) and browser HTTP.
    const acctId = 'acct_consistent_42';
    const expectedArm = bucketAccountVariant(acctId);
    const headless = assignEpistemicVariant({ env: envOn, accountId: acctId });
    const browserReq = assignEpistemicVariant({
      env: envOn,
      accountId: acctId,
      request: new Request('https://luminarasuite.com/api/oracle/chat', {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }),
    });
    expect(headless.variant).toBe(expectedArm);
    expect(browserReq.variant).toBe(expectedArm);
    expect(headless.source).toBe('account');

    // 5. Guest browser request rolls 50/50 and sets cookie; subsequent cookie request stays sticky.
    const guestFresh = assignEpistemicVariant({
      env: envOn,
      accountId: 'guest',
      random: () => 0.12,
      request: new Request('https://luminarasuite.com/api/oracle/chat', {
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' },
      }),
    });
    expect(guestFresh.variant).toBe('treatment');
    expect(guestFresh.source).toBe('random');
    expect(guestFresh.setCookie).toContain(`${EPISTEMIC_AB_COOKIE}=treatment`);

    const guestSticky = assignEpistemicVariant({
      env: envOn,
      accountId: 'guest',
      random: () => 0.99,
      request: new Request('https://luminarasuite.com/api/oracle/chat', {
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
          cookie: `${EPISTEMIC_AB_COOKIE}=baseline`,
        },
      }),
    });
    expect(guestSticky.variant).toBe('baseline');
    expect(guestSticky.source).toBe('cookie');
    expect(guestSticky.setCookie).toBeNull();
  });

  it('executes the exact runbook SQL readout query against D1 across Oracle and Dreaming arms', async () => {
    const runbookPath = resolve(process.cwd(), 'docs/runbooks/hermes-patterns-ab-qa.md');
    const runbook = readFileSync(runbookPath, 'utf8');
    expect(runbook).not.toContain('\u2014');

    const sqlMatches = [...runbook.matchAll(/```sql\r?\n([\s\S]*?)```/g)];
    expect(sqlMatches.length).toBeGreaterThanOrEqual(2);
    const abReadoutSql = sqlMatches[0]![1]!.trim();
    const threatAuditSql = sqlMatches[1]![1]!.trim();

    const db = createSqliteD1();
    const env = {
      DB: db,
      GROQ_API_KEY: 'gsk_test_dummy',
      EPISTEMIC_AB_ENABLED: 'true',
    } as unknown as Env;

    // Record 1 baseline Oracle turn + 1 treatment Oracle turn.
    const baselineAssign = assignEpistemicVariant({
      env,
      accountId: 'acct_b',
      override: 'baseline',
    });
    const treatmentAssign = assignEpistemicVariant({
      env,
      accountId: 'acct_t',
      override: 'treatment',
    });

    await finalizeOracleHermesTurn({
      env,
      accountId: 'acct_b',
      sessionId: 'sess_b',
      assignment: baselineAssign,
      fullText: 'Measured visibility is stable.',
      validationOk: true,
      validationSummary: { block: 0, warn: 0, info: 0 },
      verificationLedger: new VerificationLedger(),
    });

    await finalizeOracleHermesTurn({
      env,
      accountId: 'acct_t',
      sessionId: 'sess_t',
      assignment: treatmentAssign,
      fullText: 'Measured visibility is stable.\n\n## Unverified / Working Hypotheses\nNone.',
      validationOk: true,
      validationSummary: { block: 0, warn: 0, info: 0 },
      verificationLedger: new VerificationLedger(),
    });

    // Record 1 baseline Dreaming fallback (malformed JSON) vs 1 treatment Dreaming 1-retry recovery.
    await enqueueDreamEvent(env, {
      accountId: 'acct_b',
      domain: 'baseline.test',
      eventType: 'audit_completed',
      payload: { healthScore: 71 },
    });
    await enqueueDreamEvent(env, {
      accountId: 'acct_t',
      domain: 'treatment.test',
      eventType: 'audit_completed',
      payload: { healthScore: 79 },
    });

    let callIdx = 0;
    const flakyJsonFetcher: typeof fetch = async () => {
      callIdx += 1;
      const content =
        callIdx === 1
          ? 'not valid json on turn 1'
          : JSON.stringify({
              summary: 'Recovered on retry',
              proposals: [],
            });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    callIdx = 0;
    await executeDreamRun(env, 'acct_b', 'baseline.test', 'manual_user', {
      force: true,
      fetcher: flakyJsonFetcher,
      request: new Request('https://luminarasuite.com/api/dreaming/run?epistemic=baseline', {
        method: 'POST',
      }),
    });

    callIdx = 0;
    await executeDreamRun(env, 'acct_t', 'treatment.test', 'manual_user', {
      force: true,
      fetcher: flakyJsonFetcher,
      request: new Request('https://luminarasuite.com/api/dreaming/run?epistemic=treatment', {
        method: 'POST',
      }),
    });

    const readout = await db.prepare(abReadoutSql).all<Record<string, unknown>>();
    expect(readout.results).toEqual([
      {
        variant: 'baseline',
        unique_accounts: 1,
        exposures: 2,
        oracle_turns: 1,
        oracle_validator_ok: 1,
        oracle_leakage_hits: 0,
        dream_runs: 1,
        dream_fallbacks: 1,
        dream_retries: 0,
        oracle_validator_pass_rate: 1,
        dream_fallback_rate: 1,
      },
      {
        variant: 'treatment',
        unique_accounts: 1,
        exposures: 2,
        oracle_turns: 1,
        oracle_validator_ok: 1,
        oracle_leakage_hits: 0,
        dream_runs: 1,
        dream_fallbacks: 0,
        dream_retries: 1,
        oracle_validator_pass_rate: 1,
        dream_fallback_rate: 0,
      },
    ]);

    const threatRows = await db.prepare(threatAuditSql).all<Record<string, unknown>>();
    expect(Array.isArray(threatRows.results)).toBe(true);
  });

  it('exercises HTTP SSE handleOracleChatSse, Citation Watch /run epistemicNote, and Dreaming non-wake Set-Cookie guards end-to-end', async () => {
    const db = createSqliteD1();
    const kvMap = new Map<string, string>([
      ['sub:acct_http_ab', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86_400_000 })],
    ]);
    const kv = {
      get: async (key: string, type?: string) => {
        const raw = kvMap.get(key);
        if (raw == null) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      put: async (key: string, val: string) => {
        kvMap.set(key, val);
      },
      delete: async (key: string) => {
        kvMap.delete(key);
      },
    } as unknown as KVNamespace;

    const env: Env = {
      DB: db,
      LUMINARA_KV: kv,
      GROQ_API_KEY: 'gsk_test_sse',
      ORACLE_SERVER_ENABLED: 'true',
      EPISTEMIC_AB_ENABLED: 'true',
      ORACLE_LOOP_GUARDS_ENABLED: 'true',
      CITATION_WATCH_LIVE: 'true',
    };
    const user: HostedIdentity = {
      id: 'usr_http_ab',
      accountId: 'acct_http_ab',
      email: 'ab@example.com',
      plan: 'agency',
    };

    // 1. Dreaming /run that does not wake must NOT emit Set-Cookie or exposure rows.
    const nonWakeRes = await handleDreamingRoute(
      new Request('https://luminarasuite.com/api/dreaming/run?epistemic=treatment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'empty.test', force: false }),
      }),
      env,
      user,
      '/dreaming/run',
    );
    expect(nonWakeRes?.headers.get('set-cookie')).toBeNull();

    // 2. Oracle HTTP SSE: ?epistemic=treatment sets Set-Cookie, injects EPISTEMIC_STANCE_RULE, and surfaces verification on done.
    let capturedSystemPrompt = '';
    const encoder = new TextEncoder();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const reqBody = JSON.parse(String(init?.body || '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      capturedSystemPrompt = reqBody.messages?.find((m) => m.role === 'system')?.content || '';
      const reply = 'Review canonical tags first.\n\n## Unverified / Working Hypotheses\nNone.';
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    try {
      const sseRes = await handleOracleChatSse(
        new Request('https://luminarasuite.com/api/oracle/chat?epistemic=treatment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'What should I inspect on acme.com?', sessionId: 'sess_http_1' }),
        }),
        env,
        user,
      );
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get('set-cookie')).toContain(`${EPISTEMIC_AB_COOKIE}=treatment`);
      const sseText = await sseRes.text();
      expect(capturedSystemPrompt).toContain(EPISTEMIC_STANCE_RULE);
      expect(sseText).toContain('event: done');
      expect(sseText).toContain('"verification"');
    } finally {
      fetchSpy.mockRestore();
    }

    // 3. Citation Watch /run: treatment attaches validated epistemicNote, baseline sets epistemicNote: null.
    const createRes = await handleCitationWatchRoute(
      new Request('https://luminarasuite.com/api/citation-watches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'acme.com',
          engine: 'chatgpt',
          prompts: ['best b2b crm', 'crm with pipeline analytics'],
        }),
      }),
      env,
      user,
      '/citation-watches',
      { now: () => 1_000 },
    );
    expect(createRes.status).toBe(201);
    const createdWatch = ((await createRes.json()) as { watch: { id: string } }).watch;

    const runTreatmentRes = await handleCitationWatchRoute(
      new Request(`https://luminarasuite.com/api/citation-watches/${createdWatch.id}/run?epistemic=treatment`, {
        method: 'POST',
      }),
      env,
      user,
      `/citation-watches/${createdWatch.id}/run`,
      {
        now: () => 1_000,
        probe: async ({ prompts }) => ({
          status: 'measured',
          method: 'fixture',
          modelId: null,
          cited: prompts.map(() => true),
        }),
      },
    );
    expect(runTreatmentRes.status).toBe(200);
    expect(runTreatmentRes.headers.get('set-cookie')).toContain(`${EPISTEMIC_AB_COOKIE}=treatment`);
    const runTreatmentJson = (await runTreatmentRes.json()) as {
      run: { epistemicNote: string | null };
    };
    expect(runTreatmentJson.run.epistemicNote).toContain('## Unverified / Working Hypotheses');

    const runBaselineRes = await handleCitationWatchRoute(
      new Request(`https://luminarasuite.com/api/citation-watches/${createdWatch.id}/run?epistemic=baseline`, {
        method: 'POST',
      }),
      env,
      user,
      `/citation-watches/${createdWatch.id}/run`,
      {
        now: () => 90_000_000,
        probe: async ({ prompts }) => ({
          status: 'measured',
          method: 'fixture',
          modelId: null,
          cited: prompts.map(() => true),
        }),
      },
    );
    expect(runBaselineRes.status).toBe(200);
    const runBaselineJson = (await runBaselineRes.json()) as {
      run: { epistemicNote: string | null };
    };
    expect(runBaselineJson.run.epistemicNote).toBeNull();

    // 4. Local http://localhost cookies omit '; Secure' while https:// includes '; Secure'.
    const localhostOverride = assignEpistemicVariant({
      env: { EPISTEMIC_AB_ENABLED: 'true' },
      request: new Request('http://localhost:8787/api/oracle/chat?epistemic=treatment'),
    });
    expect(localhostOverride.setCookie).toContain(`${EPISTEMIC_AB_COOKIE}=treatment`);
    expect(localhostOverride.setCookie).not.toContain('Secure');

    // 5. Headless runCitationWatchTick cron runs must NOT emit phantom epistemic_ab_exposed events.
    const beforeCount = (
      await db
        .prepare(
          `SELECT COUNT(*) AS c FROM product_analytics_events
           WHERE event_type = 'epistemic_ab_exposed'
             AND json_extract(payload_json, '$.surface') = 'citation_watch'`,
        )
        .first<{ c: number }>()
    )?.c;
    await runCitationWatchTick(env, {
      now: () => 200_000_000,
      probe: async ({ prompts }) => ({
        status: 'measured',
        method: 'fixture',
        modelId: null,
        cited: prompts.map(() => true),
      }),
    });
    const afterCount = (
      await db
        .prepare(
          `SELECT COUNT(*) AS c FROM product_analytics_events
           WHERE event_type = 'epistemic_ab_exposed'
             AND json_extract(payload_json, '$.surface') = 'citation_watch'`,
        )
        .first<{ c: number }>()
    )?.c;
    expect(afterCount).toBe(beforeCount);
  });
});
