/**
 * Run provenance threading on the Oracle SSE chat route (Wave 1 additive).
 * Asserts the run_provenance row, the extra 'provenance' SSE event, and the
 * env.DB-absent no-op path. Tests the exported handler directly to keep the
 * auth surface out of scope.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handleOracleChatSse } from '../worker/oracleChat';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ORACLE_SERVER_ENABLED: 'true',
    GROQ_API_KEY: 'gsk_test',
    DB: createSqliteD1(),
    ...overrides,
  } as unknown as Env;
}

const mockUser: HostedIdentity = { id: 'user_1', accountId: 'acct_1' } as HostedIdentity;

const makeRequest = (body: Record<string, unknown>) =>
  new Request('https://luminarasuite.com/api/oracle/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Minimal Groq SSE stream: one token then [DONE]. */
const groqSseStub = () => {
  const frame =
    'data: {"choices":[{"delta":{"content":"Hello world"}}]}\n\ndata: [DONE]\n\n';
  return new Response(frame, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

async function drain(res: Response): Promise<string> {
  return await res.text();
}

describe('oracleChat run provenance', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => groqSseStub()) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('records one completed run_provenance row and emits a provenance SSE event', async () => {
    const db = createSqliteD1();
    const env = makeEnv({ DB: db as unknown as D1Database });

    const res = await handleOracleChatSse(
      makeRequest({ message: 'hello oracle' }),
      env,
      mockUser,
    );
    expect(res.status).toBe(200);
    const body = await drain(res);

    const rows = (await (db as SqliteD1)
      .prepare("SELECT * FROM run_provenance WHERE surface = 'oracle_chat'")
      .all()).results as Array<{ run_id: string; status: string; account_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].account_id).toBe('acct_1');

    const lines = body.split(/\n/);
    const provIdx = lines.findIndex((l) => l === 'event: provenance');
    expect(provIdx).toBeGreaterThanOrEqual(0);
    const dataLine = lines[provIdx + 1];
    expect(dataLine?.startsWith('data: ')).toBe(true);
    const payload = JSON.parse(dataLine.slice(6)) as {
      runId: string;
      validation?: { ok: boolean; summary: { block: number; warn: number; info: number } };
    };
    expect(payload.runId).toBe(rows[0].run_id);
    expect(payload.validation).toBeDefined();
    expect(payload.validation?.ok).toBe(true);
  });

  it('flags invented metrics in provenance without breaking the stream', async () => {
    const inventedFrame =
      'data: {"choices":[{"delta":{"content":"Domain Authority is 73 according to studies."}}]}\n\ndata: [DONE]\n\n';
    globalThis.fetch = vi.fn(async () =>
      new Response(inventedFrame, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch;

    const db = createSqliteD1();
    const env = makeEnv({ DB: db as unknown as D1Database });

    const res = await handleOracleChatSse(
      makeRequest({ message: 'what is my DA?' }),
      env,
      mockUser,
    );
    expect(res.status).toBe(200);
    const body = await drain(res);
    expect(body).toContain('event: done');
    expect(body).toContain('event: provenance');

    const lines = body.split(/\n/);
    const provIdx = lines.findIndex((l) => l === 'event: provenance');
    const dataLine = lines[provIdx + 1];
    const payload = JSON.parse(dataLine.slice(6)) as {
      validation: {
        ok: boolean;
        summary: { warn: number };
        findings: Array<{ validator: string; severity: string }>;
      };
    };
    // v1: warn-level honesty hits land in provenance; ok stays true unless a block fires.
    expect(payload.validation.findings.length).toBeGreaterThan(0);
    expect(payload.validation.summary.warn).toBeGreaterThan(0);
    expect(payload.validation.findings.some((f) => f.validator === 'noInventedMetrics')).toBe(true);
  });

  it('streams identically with env.DB undefined and emits no provenance event', async () => {
    const env = makeEnv({ DB: undefined });

    const res = await handleOracleChatSse(
      makeRequest({ message: 'hello oracle' }),
      env,
      mockUser,
    );
    expect(res.status).toBe(200);
    const body = await drain(res);
    expect(body).not.toContain('event: provenance');
    expect(body).toContain('event: done');
  });
});
