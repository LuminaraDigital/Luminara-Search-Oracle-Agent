import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleFindingsRoute } from '../worker/findingsService';
import { findingStableKey } from '../services/audit/findingStableKey';
import { sampleAiSaidFixtures } from '../services/audit/sampleAiSaidFixtures';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:FINDINGS_TEST';

function signInitData(fields: Record<string, string>): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
  } as Env;
}

describe('WDL findings API', () => {
  it('rejects unsigned bulk upsert', async () => {
    const env = makeEnv();
    const res = await handleFindingsRoute(
      new Request('https://luminarasuite.com/api/findings/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'example.com', findings: [] }),
      }),
      env,
      '/findings/bulk',
    );
    expect(res.status).toBe(401);
  });

  it('bulk upsert by stableKey then list and patch status', async () => {
    const env = makeEnv();
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 42, first_name: 'Owner' }),
    });
    const domain = 'acme.example';
    const title = 'Missing Organization schema';
    const category = 'schema';
    const sk = findingStableKey(domain, category, title);

    const createRes = await handleFindingsRoute(
      new Request('https://luminarasuite.com/api/findings/bulk', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({
          domain,
          auditRunId: 'run_1',
          findings: [
            {
              category,
              severity: 'high',
              title,
              description: 'Add Organization JSON-LD',
              stableKey: sk,
              evidence: { source: 'instant_audit_crew' },
            },
          ],
        }),
      }),
      env,
      '/findings/bulk',
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { findings: Array<{ id: string; stableKey: string }> };
    expect(created.findings).toHaveLength(1);
    expect(created.findings[0].stableKey).toBe(sk);
    const findingId = created.findings[0].id;

    const again = await handleFindingsRoute(
      new Request('https://luminarasuite.com/api/findings/bulk', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({
          domain,
          auditRunId: 'run_2',
          findings: [
            {
              category,
              severity: 'high',
              title,
              description: 'Still missing Organization JSON-LD',
              stableKey: sk,
            },
          ],
        }),
      }),
      env,
      '/findings/bulk',
    );
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { findings: unknown[] };
    expect(againBody.findings).toHaveLength(1);

    const listRes = await handleFindingsRoute(
      new Request(`https://luminarasuite.com/api/findings?domain=${domain}`, {
        headers: { 'x-telegram-init-data': initData },
      }),
      env,
      '/findings',
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { findings: unknown[] };
    expect(listed.findings).toHaveLength(1);

    const patchRes = await handleFindingsRoute(
      new Request(`https://luminarasuite.com/api/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({ status: 'in_progress' }),
      }),
      env,
      `/findings/${findingId}`,
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { finding: { status: string } };
    expect(patched.finding.status).toBe('in_progress');

    const reBulk = await handleFindingsRoute(
      new Request('https://luminarasuite.com/api/findings/bulk', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({
          domain,
          auditRunId: 'run_3',
          findings: [
            {
              category,
              severity: 'high',
              title,
              description: 'Re-bulk after status change',
              stableKey: sk,
              status: 'open',
            },
          ],
        }),
      }),
      env,
      '/findings/bulk',
    );
    expect(reBulk.status).toBe(200);

    const listAfter = await handleFindingsRoute(
      new Request(`https://luminarasuite.com/api/findings?domain=${domain}`, {
        headers: { 'x-telegram-init-data': initData },
      }),
      env,
      '/findings',
    );
    expect(listAfter.status).toBe(200);
    const afterBody = (await listAfter.json()) as { findings: Array<{ status: string }> };
    expect(afterBody.findings).toHaveLength(1);
    expect(afterBody.findings[0].status).toBe('in_progress');
  });

  it('sample AI-said fixtures are labeled Sample and estimated', () => {
    const rows = sampleAiSaidFixtures('https://www.brand.test/path');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.label).toBe('Sample');
      expect(row.measurementStatus).toBe('estimated');
    }
  });

  it('bulk reports skipped invalid categories without dropping valid upserts', async () => {
    const env = makeEnv();
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 7, first_name: 'Skip' }),
    });
    const res = await handleFindingsRoute(
      new Request('https://luminarasuite.com/api/findings/bulk', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify({
          domain: 'skip.example',
          findings: [
            {
              category: 'not_a_real_category',
              severity: 'high',
              title: 'Bad cat',
              description: 'x',
            },
            {
              category: 'schema',
              severity: 'high',
              title: 'Good cat',
              description: 'ok',
            },
          ],
        }),
      }),
      env,
      '/findings/bulk',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { findings: unknown[]; skipped: number };
    expect(body.findings).toHaveLength(1);
    expect(body.skipped).toBe(1);
  });
});

describe('finding board merge', () => {
  it('keeps local rows when remote returns a subset', async () => {
    const { mergeBoardWithRemote, isCrewAuditFinding } = await import(
      '../services/audit/findingBoardService'
    );
    const local = [
      {
        id: 'a',
        domain: 'ex.com',
        stableKey: 'k1',
        category: 'schema' as const,
        severity: 'high' as const,
        title: 'One',
        description: 'd1',
        status: 'open' as const,
        synced: false,
      },
      {
        id: 'b',
        domain: 'ex.com',
        stableKey: 'k2',
        category: 'technical' as const,
        severity: 'medium' as const,
        title: 'Two',
        description: 'd2',
        status: 'open' as const,
        synced: false,
      },
    ];
    const next = mergeBoardWithRemote(
      local,
      [
        {
          id: 'remote-a',
          stableKey: 'k1',
          category: 'schema',
          severity: 'high',
          title: 'One updated',
          description: 'd1b',
          status: 'in_progress',
        },
      ],
      'ex.com',
    );
    expect(next).toHaveLength(2);
    expect(next.find((f) => f.stableKey === 'k1')?.synced).toBe(true);
    expect(next.find((f) => f.stableKey === 'k2')?.title).toBe('Two');
    expect(
      isCrewAuditFinding({
        validator: 'banned',
        excerpt: 'x',
        severity: 'warn',
        span: { start: 0, end: 1 },
        detail: 'no',
      }),
    ).toBe(false);
    expect(
      isCrewAuditFinding({
        title: 'Missing schema',
        category: 'schema',
        severity: 'high',
        description: 'd',
      }),
    ).toBe(true);
  });
});
