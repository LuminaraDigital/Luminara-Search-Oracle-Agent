import { describe, expect, it } from 'vitest';
import { classifyInvoiceDelta } from '../worker/invoiceReconcile';
import { assertHonestyLabel } from '../worker/weeklyDecisionService';
import {
  canPulseAsScored,
  freshnessFromCaptures,
  normalizeMeasurementStatus,
} from '../services/wdl/liveHonesty';
import { hashEmbed, resolveVectorProvider } from '../worker/memoryRag';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';
import { createPrivacyJob, getPrivacyJob } from '../worker/privacyService';
import type { HostedIdentity } from '../worker/userTypes';

function mockKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

describe('invoice reconcile classifier', () => {
  it('classifies ok / warn / reconciliation_required bands', () => {
    expect(classifyInvoiceDelta(1000, 1000).status).toBe('ok');
    expect(classifyInvoiceDelta(1000, 1015).status).toBe('warn');
    expect(classifyInvoiceDelta(1000, 1060).status).toBe('reconciliation_required');
  });
});

describe('live honesty', () => {
  it('never pulses not_measured as scored', () => {
    expect(canPulseAsScored('not_measured')).toBe(false);
    expect(canPulseAsScored('measured')).toBe(true);
    expect(normalizeMeasurementStatus('bogus')).toBe('not_measured');
    expect(assertHonestyLabel('estimated')).toBe('estimated');
    expect(freshnessFromCaptures(['not_measured', 'measured'])).toBe('mixed');
  });
});

describe('memory vector helpers', () => {
  it('hashEmbed is stable length and resolveVectorProvider defaults to none', () => {
    expect(hashEmbed('hello brand', 16)).toHaveLength(16);
    expect(resolveVectorProvider({} as Env)).toBe('none');
  });
});

describe('memory history', () => {
  it('records ADD events when creating hosted facts', async () => {
    const env = {
      DB: createSqliteD1(),
      LUMINARA_KV: mockKv(),
      WEBAPP_URL: 'https://luminarasuite.com/',
    } as unknown as Env;
    const user: HostedIdentity = {
      id: 'fb:hist',
      accountId: 'acct_hist',
      source: 'firebase',
    } as HostedIdentity;
    const { createMemoryFact } = await import('../worker/memoryService');
    const req = new Request('https://luminarasuite.com/api/memory/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'We prefer plain-language audits for local clients' }),
    });
    const res = await createMemoryFact(req, env, user);
    expect(res.status).toBe(200);
    const row = await env.DB!.prepare(
      `SELECT event, text_snapshot FROM memory_history WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind('acct_hist')
      .first<{ event: string; text_snapshot: string }>();
    expect(row?.event).toBe('ADD');
    expect(row?.text_snapshot).toContain('plain-language');
  });
});

describe('privacy export job', () => {
  it('creates a ready export with download token when KV is bound', async () => {
    const env = {
      DB: createSqliteD1(),
      LUMINARA_KV: mockKv(),
      WEBAPP_URL: 'https://luminarasuite.com/',
    } as unknown as Env;
    const user: HostedIdentity = {
      id: 'fb:test',
      accountId: 'acct_privacy',
      source: 'firebase',
    } as HostedIdentity;
    await env.DB!.prepare(
      `INSERT OR IGNORE INTO users (id, source, account_id, created_at, last_seen_at) VALUES (?, 'firebase', ?, ?, ?)`,
    )
      .bind(user.id, 'acct_privacy', Date.now(), Date.now())
      .run();

    const res = await createPrivacyJob(env, user, 'export');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobId?: string; downloadToken?: string; status?: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ready');
    expect(body.jobId).toBeTruthy();
    expect(body.downloadToken).toBeTruthy();

    const statusRes = await getPrivacyJob(env, user, body.jobId!);
    const statusBody = (await statusRes.json()) as { ok: boolean; job?: { status: string } };
    expect(statusBody.ok).toBe(true);
    expect(statusBody.job?.status).toBe('ready');
  });
});
