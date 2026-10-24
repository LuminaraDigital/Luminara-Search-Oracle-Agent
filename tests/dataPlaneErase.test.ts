import { describe, expect, it } from 'vitest';
import { ERASE_MIRROR_FAILED, reconcilePendingErases } from '../worker/accountMirror';
import { main, planBackfill } from '../worker/backfillFirestore';
import { auditDocId } from '../worker/dataPlaneDocs';
import { decodeFields, encodeFields } from '../worker/firestoreRest';
import { StubGcpTokenProvider } from '../worker/gcpToken';
import { eraseAccountRows } from '../worker/privacyService';
import { linkTelegramAndFirebase } from '../worker/userStore';
import { runWithWaitUntil } from '../worker/welcomeEmail';
import type { Env } from '../worker/env';
import type { DataPlaneDeps } from '../worker/dataPlane';
import { createSqliteD1 } from './helpers/sqliteD1';

const PROJECT = 'luminara-suite-staging';
const EMAIL = 'gone@example.com';

type Stored = { collection: string; id: string; fields: Record<string, unknown> };

function memoryFirestore() {
  const docs: Stored[] = [];
  let auditQueries = 0;
  let calls = 0;
  const fetchImpl = (fail: boolean): typeof fetch => async (input, init) => {
    calls += 1;
    const url = String(input);
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    if (url.endsWith(':runQuery')) {
      if (fail) return new Response('no', { status: 500 });
      const body = JSON.parse(bodyText) as {
        structuredQuery: {
          from: Array<{ collectionId: string }>;
          limit: number;
          where: { fieldFilter: { value: { stringValue: string } } };
        };
      };
      const collection = body.structuredQuery.from[0]?.collectionId ?? '';
      const accountId = body.structuredQuery.where.fieldFilter.value.stringValue;
      if (collection === 'audits') auditQueries += 1;
      const page = docs
        .filter((doc) => doc.collection === collection && doc.fields.accountId === accountId)
        .slice(0, body.structuredQuery.limit);
      return new Response(JSON.stringify(page.map((doc) => ({
        document: {
          name: `projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(doc.id)}`,
          fields: encodeFields(doc.fields),
        },
      }))), { status: 200 });
    }
    if (url.endsWith(':batchWrite')) {
      if (fail) return new Response('no', { status: 500 });
      const body = JSON.parse(bodyText) as { writes: Array<{ delete?: string }> };
      for (const write of body.writes) {
        const path = write.delete?.split('/documents/')[1] ?? '';
        const [collection, ...rest] = path.split('/');
        const id = decodeURIComponent(rest.join('/'));
        const index = docs.findIndex((doc) => doc.collection === collection && doc.id === id);
        if (index >= 0) docs.splice(index, 1);
      }
      return new Response('{}', { status: 200 });
    }
    const path = url.split('/documents/')[1]?.split('?')[0] ?? '';
    const [collection, ...rest] = path.split('/');
    const id = decodeURIComponent(rest.join('/'));
    if (init?.method === 'PATCH') {
      const fields = decodeFields(JSON.parse(bodyText).fields);
      const existing = docs.find((doc) => doc.collection === collection && doc.id === id);
      if (existing) Object.assign(existing.fields, fields);
      else docs.push({ collection, id, fields });
      return new Response('{}', { status: 200 });
    }
    if (init?.method === 'DELETE') {
      const index = docs.findIndex((doc) => doc.collection === collection && doc.id === id);
      if (index >= 0) docs.splice(index, 1);
      return new Response(null, { status: 200 });
    }
    return new Response('no', { status: 404 });
  };
  return {
    docs,
    calls: () => calls,
    auditQueries: () => auditQueries,
    fetch: fetchImpl,
  };
}

function envFor(plane: 'd1' | 'dual'): Env {
  return {
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    DATA_PLANE: plane === 'dual' ? 'dual' : undefined,
    GCP_PROJECT_ID: PROJECT,
  } as Env;
}

function depsFor(fetchImpl: typeof fetch, lines: string[]): DataPlaneDeps {
  return {
    fetch: fetchImpl,
    tokenProvider: new StubGcpTokenProvider(),
    erasePageSize: 2,
    log: (line) => lines.push(line),
  };
}

async function seedUser(env: Env, id: string, accountId: string, createdAt: number): Promise<void> {
  await env.DB!.prepare(
    `INSERT INTO users (id, source, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at, account_id)
     VALUES (?, ?, ?, 'Pat', ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    id.startsWith('fb:') ? 'firebase' : 'telegram',
    EMAIL,
    id.startsWith('fb:') ? null : id,
    id.startsWith('fb:') ? id.slice(3) : null,
    createdAt,
    createdAt,
    accountId,
  ).run();
}

describe('privacy erase mirror', () => {
  it('does not call Firestore in d1 mode and the ledger blocks a later backfill', async () => {
    const env = envFor('d1');
    await seedUser(env, '42', '42', 1);
    const store = memoryFirestore();
    const lines: string[] = [];
    const counts = await eraseAccountRows(env, '42', depsFor(store.fetch(false), lines));
    expect(counts.users_anon).toBe(1);
    expect(store.calls()).toBe(0);
    const ledger = await env.DB!.prepare(
      `SELECT status, user_ids_json FROM firestore_erase_ledger WHERE account_id = ?`,
    ).bind('42').first<{ status: string; user_ids_json: string }>();
    expect(ledger?.status).toBe('done');
    const planned = planBackfill({
      users: [{ id: '42', source: 'telegram', account_id: '42', email: EMAIL, created_at: 1, last_seen_at: 1 }],
      audits: [{ account_id: '42', id: 'a', domain: 'acme.example', measured_at: 1, updated_at: 1, entry_json: '{"id":"a","domain":"acme.example","measuredAt":1}' }],
      erasedUserIds: JSON.parse(ledger?.user_ids_json ?? '[]') as string[],
      erasedAccountIds: ['42'],
    });
    expect(planned.writes).toEqual([]);
    expect(planned.skipped).toBe(2);
    expect(JSON.stringify(lines)).not.toContain(EMAIL);
  });

  it('deletes the user doc and every audit page, then a failed erase stays pending until reconcile', async () => {
    const env = envFor('dual');
    await seedUser(env, '42', '42', 1);
    await env.DB!.prepare(
      `INSERT INTO audit_history (account_id, id, domain, measured_at, entry_json, updated_at) VALUES ('42', 'a', 'acme.example', 1, '{}', 1)`,
    ).run();
    const store = memoryFirestore();
    store.docs.push({ collection: 'users', id: '42', fields: { id: '42', accountId: '42' } });
    for (const id of ['a', 'b', 'c']) {
      store.docs.push({ collection: 'audits', id, fields: { id, accountId: '42', domain: 'acme.example', measuredAt: 1 } });
    }
    const lines: string[] = [];
    const tasks: Promise<unknown>[] = [];
    const counts = await runWithWaitUntil({ waitUntil: (task) => tasks.push(task) }, () =>
      eraseAccountRows(env, '42', depsFor(store.fetch(false), lines)),
    );
    expect(counts.audit_history).toBe(1);
    await Promise.all(tasks);
    expect(store.auditQueries()).toBeGreaterThan(1);
    expect(store.docs.filter((doc) => doc.fields.accountId === '42')).toEqual([]);
    const done = await env.DB!.prepare(`SELECT status FROM firestore_erase_ledger WHERE account_id = ?`).bind('42').first<{ status: string }>();
    expect(done?.status).toBe('done');
    expect(JSON.stringify(lines)).not.toContain(EMAIL);

    const again = envFor('dual');
    await seedUser(again, '42', '42', 1);
    const failed = memoryFirestore();
    failed.docs.push({ collection: 'users', id: '42', fields: { id: '42', accountId: '42' } });
    for (const id of ['a', 'b', 'c']) {
      failed.docs.push({ collection: 'audits', id, fields: { id, accountId: '42', domain: 'acme.example', measuredAt: 1 } });
    }
    const failedTasks: Promise<unknown>[] = [];
    const failedCounts = await runWithWaitUntil({ waitUntil: (task) => failedTasks.push(task) }, () =>
      eraseAccountRows(again, '42', depsFor(failed.fetch(true), lines)),
    );
    expect(failedCounts.users_anon).toBe(1);
    await Promise.all(failedTasks);
    const pending = await again.DB!.prepare(
      `SELECT status, code FROM firestore_erase_ledger WHERE account_id = ?`,
    ).bind('42').first<{ status: string; code: string }>();
    expect(pending).toEqual({ status: 'pending', code: ERASE_MIRROR_FAILED });
    expect(failed.docs.some((doc) => doc.collection === 'audits')).toBe(true);

    const cleared = await reconcilePendingErases(again, depsFor(failed.fetch(false), lines));
    expect(cleared).toEqual({ cleared: 1, pending: 0 });
    expect(failed.docs.filter((doc) => doc.fields.accountId === '42')).toEqual([]);
    const second = await reconcilePendingErases(again, depsFor(failed.fetch(false), lines));
    expect(second).toEqual({ cleared: 0, pending: 0 });
    const finished = await again.DB!.prepare(`SELECT status, code FROM firestore_erase_ledger WHERE account_id = ?`).bind('42').first<{ status: string; code: string }>();
    expect(finished?.status).toBe('done');
  });
});

describe('account link mirror', () => {
  it('writes the shared account id onto both user docs and moves the audit doc', async () => {
    const env = envFor('dual');
    await seedUser(env, '111', '111', 200);
    await seedUser(env, 'fb:abc', 'fb:abc', 50);
    await env.DB!.prepare(
      `INSERT INTO audit_history (account_id, id, domain, measured_at, entry_json, updated_at) VALUES ('111', 'e1', 'acme.example', 1, '{}', 1)`,
    ).run();
    const store = memoryFirestore();
    const oldId = auditDocId('111', 'e1');
    store.docs.push({ collection: 'audits', id: oldId, fields: { id: 'e1', accountId: '111', domain: 'acme.example', measuredAt: 1 } });
    const lines: string[] = [];
    const tasks: Promise<unknown>[] = [];
    const linked = await runWithWaitUntil({ waitUntil: (task) => tasks.push(task) }, () =>
      linkTelegramAndFirebase(env, '111', 'abc', { email: EMAIL, name: 'Pat' }, depsFor(store.fetch(false), lines)),
    );
    await Promise.all(tasks);
    expect(linked.accountId).toBe('fb:abc');
    const accounts = await env.DB!.prepare(`SELECT id, account_id FROM users ORDER BY id`).all<{ id: string; account_id: string }>();
    expect(accounts.results?.map((row) => row.account_id)).toEqual(['fb:abc', 'fb:abc']);
    const moved = await env.DB!.prepare(`SELECT account_id FROM audit_history WHERE id = 'e1'`).first<{ account_id: string }>();
    expect(moved?.account_id).toBe('fb:abc');
    const userDocs = store.docs.filter((doc) => doc.collection === 'users');
    expect(userDocs.map((doc) => doc.fields.accountId).sort()).toEqual(['fb:abc', 'fb:abc']);
    expect(store.docs.some((doc) => doc.id === oldId)).toBe(false);
    const nextId = auditDocId('fb:abc', 'e1');
    expect(store.docs.find((doc) => doc.id === nextId)?.fields.accountId).toBe('fb:abc');
    expect(JSON.stringify(lines)).not.toContain(EMAIL);
  });
});

describe('reconcile command', () => {
  it('dry-runs pending erases without calling Firestore', async () => {
    let fetches = 0;
    let printed = '';
    const code = await main(['--reconcile-erases', 'pending.json', '--project', PROJECT], {
      readText: () => JSON.stringify([{ accountId: '42', userIds: ['42'] }]),
      write: (text) => { printed = text; },
      fetch: async () => {
        fetches += 1;
        return new Response('no', { status: 500 });
      },
      tokenProvider: new StubGcpTokenProvider(),
    });
    expect(code).toBe(0);
    expect(fetches).toBe(0);
    expect(printed).toContain('accounts: 1');
    expect(printed).not.toContain(EMAIL);
  });
});
