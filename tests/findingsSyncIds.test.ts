import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { findingStableKey } from '../services/audit/findingStableKey';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

// Allora CL0-1: the server mints every row id; a crew rule id lives only in evidence.provenance.ruleId.

const botToken = '123456:FINDINGS_SYNC_IDS';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const RULE = 'finding-schema-org';
const TITLE = 'Missing Organization / Brand Entity Schema';

function initData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

function makeEnv(): Env {
  const store = new Map<string, string>();
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: {
      get: async (key: string, type?: string) => {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (key: string, value: string) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
    } as unknown as KVNamespace,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
  } as Env;
}

type PublicFinding = {
  id: string;
  domain: string;
  stableKey: string;
  description: string;
  status: string;
  evidence: Record<string, unknown> | null;
};

/** The payload ingestCrewFindings sends: the crew rule id as `id`, provenance in evidence. */
function crewItem(domain: string, extra: Record<string, unknown> = {}) {
  return {
    id: RULE,
    stableKey: findingStableKey(domain, 'schema', TITLE),
    category: 'schema',
    severity: 'critical',
    title: TITLE,
    description: 'No Organization markup',
    status: 'open',
    evidence: { source: 'instant_audit_crew', provenance: { ruleId: RULE } },
    ...extra,
  };
}

async function call(env: Env, userId: number, method: string, path: string, body?: unknown) {
  const res = await worker.fetch(
    new Request(`https://luminarasuite.com/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-telegram-init-data': initData(userId),
        'cf-connecting-ip': `10.9.0.${userId % 250}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx,
  );
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

async function bulk(env: Env, userId: number, domain: string, item: Record<string, unknown>) {
  const res = await call(env, userId, 'POST', '/findings/bulk', { domain, auditRunId: 'run_1', findings: [item] });
  return { status: res.status, findings: (res.data.findings || []) as PublicFinding[] };
}

async function list(env: Env, userId: number, domain: string) {
  const res = await call(env, userId, 'GET', `/findings?domain=${domain}`);
  return (res.data.findings || []) as PublicFinding[];
}

describe('findings sync ids (Allora CL0-1)', () => {
  it('two accounts, and one account on two domains, keep separate server-minted rows for one rule id', async () => {
    const env = makeEnv();
    const a = await bulk(env, 42, 'movida.com.au', crewItem('movida.com.au'));
    const b = await bulk(env, 99, 'movida.com.au', crewItem('movida.com.au'));
    const c = await bulk(env, 42, 'other.example', crewItem('other.example'));
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);

    const ids = [a, b, c].map((r) => r.findings[0].id);
    for (const id of ids) expect(id).toMatch(/^fnd_[0-9a-f]{24}$/);
    expect(new Set(ids).size).toBe(3);

    const mine = await list(env, 42, 'movida.com.au');
    expect(mine.map((f) => f.id)).toEqual([ids[0]]);
    expect(mine[0].evidence?.provenance).toEqual({ ruleId: RULE });
    expect((await list(env, 99, 'movida.com.au')).map((f) => f.id)).toEqual([ids[1]]);
    expect((await list(env, 42, 'other.example')).map((f) => f.id)).toEqual([ids[2]]);
  });

  it('a re-audit updates the row in place and keeps its id', async () => {
    const env = makeEnv();
    const first = await bulk(env, 42, 'movida.com.au', crewItem('movida.com.au'));
    const id = first.findings[0].id;
    const again = await bulk(env, 42, 'movida.com.au', crewItem('movida.com.au', { id, description: 'Still missing' }));
    expect(again.findings[0].id).toBe(id);
    const rows = await list(env, 42, 'movida.com.au');
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Still missing');
    // The client resent the server id, which is not a rule id, so the provenance it sent is what stays.
    expect(rows[0].evidence?.provenance).toEqual({ ruleId: RULE });
  });

  it('a bulk call with no evidence leaves stored evidence intact', async () => {
    const env = makeEnv();
    await bulk(env, 42, 'movida.com.au', crewItem('movida.com.au'));
    const { evidence: _drop, ...noEvidence } = crewItem('movida.com.au', { description: 'Re-run' });
    void _drop;
    await bulk(env, 42, 'movida.com.au', noEvidence);
    const [row] = await list(env, 42, 'movida.com.au');
    expect(row.description).toBe('Re-run');
    expect(row.evidence).toEqual({ source: 'instant_audit_crew', provenance: { ruleId: RULE } });
  });

  it('keeps only rule-shaped ids as provenance', async () => {
    const env = makeEnv();
    await bulk(
      env,
      42,
      'movida.com.au',
      crewItem('movida.com.au', {
        id: 'fnd_0123456789abcdef01234567',
        evidence: { source: 'instant_audit_crew', provenance: { ruleId: 'Not A Rule!' } },
      }),
    );
    const [row] = await list(env, 42, 'movida.com.au');
    expect(row.evidence).toEqual({ source: 'instant_audit_crew' });

    await bulk(env, 42, 'movida.com.au', crewItem('movida.com.au', { evidence: { source: 'legacy_client' } }));
    const [legacy] = await list(env, 42, 'movida.com.au');
    expect(legacy.evidence).toEqual({ source: 'legacy_client', provenance: { ruleId: RULE } });
  });

  it('an unsynced client can PATCH by stable key and domain, only within its own account', async () => {
    const env = makeEnv();
    const created = await bulk(env, 42, 'movida.com.au', crewItem('movida.com.au'));
    const { id, stableKey } = created.findings[0];

    const byKey = await call(env, 42, 'PATCH', `/findings/${stableKey}`, {
      status: 'in_progress',
      domain: 'https://www.movida.com.au/',
    });
    expect(byKey.status).toBe(200);
    expect((byKey.data.finding as PublicFinding).id).toBe(id);
    expect((byKey.data.finding as PublicFinding).status).toBe('in_progress');

    expect((await call(env, 42, 'PATCH', `/findings/${stableKey}`, { status: 'done' })).status).toBe(404);
    expect(
      (await call(env, 99, 'PATCH', `/findings/${stableKey}`, { status: 'done', domain: 'movida.com.au' })).status,
    ).toBe(404);
    expect((await call(env, 99, 'PATCH', `/findings/${id}`, { status: 'done' })).status).toBe(404);

    const byId = await call(env, 42, 'PATCH', `/findings/${id}`, { status: 'done' });
    expect((byId.data.finding as PublicFinding).status).toBe('done');
  });
});
