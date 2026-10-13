import { describe, expect, it } from 'vitest';
import { brandFactNudge, searchMemoryDocuments, type MemoryDocument } from '../services/rsi/memorySearch';
import { saveBrandFact } from '../services/memory/brandMemoryVaultService';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { handleRsiRoute } from '../worker/rsiRoutes';

const user = { id: 'acct_mem', accountId: 'acct_mem' } as HostedIdentity;
const other = { id: 'acct_other', accountId: 'acct_other' } as HostedIdentity;

function envFor(): Env {
  return { DB: createSqliteD1() } as unknown as Env;
}

function call(env: Env, who: HostedIdentity, path: string, init?: RequestInit) {
  return handleRsiRoute(new Request(`https://luminarasuite.com/api${path}`, init), env, who, path.split('?')[0]);
}

function doc(partial: Partial<MemoryDocument> & Pick<MemoryDocument, 'id' | 'title' | 'body'>): MemoryDocument {
  return {
    kind: 'audit',
    domain: 'example.com',
    sourceId: null,
    createdAt: 1,
    ...partial,
  };
}

describe('memory search', () => {
  it('ranks a title match above a body match and nudges only from a chat fact', () => {
    const hits = searchMemoryDocuments(
      [
        doc({ id: 'body', title: 'notes', body: 'citation audit details', createdAt: 2 }),
        doc({ id: 'title', title: 'citation audit', body: 'nothing', createdAt: 1 }),
      ],
      'citation',
    );
    expect(hits.map((hit) => hit.id)).toEqual(['title', 'body']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(brandFactNudge(hits).shouldSave).toBe(false);

    const chatHits = searchMemoryDocuments(
      [doc({ id: 'chat', kind: 'chat', title: 'session', body: 'our usp is fast answers.', createdAt: 3 })],
      'usp',
    );
    expect(brandFactNudge(chatHits)).toEqual({
      shouldSave: true,
      title: 'USP',
      summary: 'fast answers',
      domain: 'example.com',
    });
  });

  it('keeps accounts apart, refuses a short query or empty body, and leaves the vault to the client', async () => {
    const env = envFor();
    const empty = await call(env, user, '/rsi/memory/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'audit', title: 'Weekly audit', body: ' ' }),
    });
    expect(empty!.status).toBe(400);

    const short = await call(env, user, '/rsi/memory/search?q=a');
    expect(short!.status).toBe(400);

    await call(env, other, '/rsi/memory/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'chat', title: 'Other', body: 'secret lighthouse phrase' }),
    });
    await call(env, user, '/rsi/memory/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'audit',
        title: 'Citation audit',
        body: 'Measured pages only.',
        domain: 'luminara.digital',
        sourceId: 'run-1',
      }),
    });
    await call(env, user, '/rsi/memory/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'chat', title: 'Oracle', body: 'our usp is fast answers.', domain: 'luminara.digital' }),
    });

    const isolated = await call(env, user, '/rsi/memory/search?q=lighthouse');
    const isolatedBody = (await isolated!.json()) as { hits: unknown[]; nudge: { shouldSave: boolean } };
    expect(isolated!.status).toBe(200);
    expect(isolatedBody.hits).toEqual([]);
    expect(isolatedBody.nudge.shouldSave).toBe(false);

    const found = await call(env, user, '/rsi/memory/search?q=citation');
    const foundBody = (await found!.json()) as {
      hits: Array<{ title: string; kind: string }>;
      nudge: { shouldSave: boolean; title?: string; summary?: string };
    };
    expect(foundBody.hits[0].title).toBe('Citation audit');
    expect(foundBody.nudge).toEqual({ shouldSave: false });

    const nudged = await call(env, user, '/rsi/memory/search?q=usp');
    const nudgedBody = (await nudged!.json()) as { nudge: { shouldSave: boolean; title: string; summary: string } };
    expect(nudgedBody.nudge).toMatchObject({ shouldSave: true, title: 'USP', summary: 'fast answers' });

    const saved = saveBrandFact({ title: nudgedBody.nudge.title, summary: nudgedBody.nudge.summary, domain: 'luminara.digital' });
    expect(saved.type).toBe('brand_fact');
    expect(saved.title).toBe('USP');
    expect(saved.summary).toBe('fast answers');
    expect(saved.domain).toBe('luminara.digital');
  });
});
