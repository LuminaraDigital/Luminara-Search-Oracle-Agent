import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { createMemoryFact, listMemoryFacts } from '../worker/memoryService';
import { searchMemoryVectors } from '../worker/memoryRag';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

const userA: HostedIdentity = { id: 'fb:a', accountId: 'acct_a', source: 'firebase' };
const userB: HostedIdentity = { id: 'fb:b', accountId: 'acct_b', source: 'firebase' };

function env(): Env {
  return { DB: createSqliteD1(), WEBAPP_URL: 'https://luminarasuite.com/' } as unknown as Env;
}

describe('account isolation for memory', () => {
  it('lets account A read its fact and gives account B nothing', async () => {
    const db = env();
    const created = await createMemoryFact(
      new Request('https://luminarasuite.com/api/memory/facts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Account A keeps a private brand fact' }),
      }),
      db,
      userA,
    );
    expect(created.status).toBe(200);

    const own = (await (await listMemoryFacts(db, userA)).json()) as { facts: Array<{ text: string }> };
    const other = (await (await listMemoryFacts(db, userB)).json()) as { facts: Array<{ text: string }> };
    expect(own.facts.map((fact) => fact.text)).toContain('Account A keeps a private brand fact');
    expect(other.facts).toEqual([]);

    const hitsA = await searchMemoryVectors(db, 'acct_a', 'private brand fact', 5);
    const hitsB = await searchMemoryVectors(db, 'acct_b', 'private brand fact', 5);
    expect(hitsA.some((hit) => hit.text.includes('private brand'))).toBe(true);
    expect(hitsB).toEqual([]);
  });

  it('rejects a client-supplied accountId on a memory write', async () => {
    const res = await createMemoryFact(
      new Request('https://luminarasuite.com/api/memory/facts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'nope', accountId: 'acct_b' }),
      }),
      env(),
      userA,
    );
    expect(res.status).toBe(400);
  });
});

describe('Vertex memory search stays inside the account', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops neighbors that belong to another account', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: { datapoint: { restricts: Array<{ namespace: string; allowList: string[] }> } };
      };
      expect(body.query.datapoint.restricts).toEqual([{ namespace: 'account', allowList: ['acct_a'] }]);
      return new Response(
        JSON.stringify({
          nearestNeighbors: [
            { datapoint: { datapointId: 'acct_b:secret' }, distance: 0.1 },
            { datapoint: { datapointId: 'acct_a:mine' }, distance: 0.2 },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchImpl);

    const hits = await searchMemoryVectors(
      {
        GCP_VERTEX_VECTOR_ENDPOINT: 'https://vertex.example/v1/query',
        GCP_VERTEX_ACCESS_TOKEN: 'token',
      } as Env,
      'acct_a',
      'brand fact',
      5,
    );

    expect(hits.map((hit) => hit.id)).toEqual(['acct_a:mine']);
  });
});
