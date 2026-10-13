/**
 * Index and search past audits and chats for one account.
 */
import type { Env } from './env';
import { brandFactNudge, searchMemoryDocuments, type MemoryDocKind, type MemoryDocument } from '../services/rsi/memorySearch';
import { RsiUserError } from './rsiErrors';

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new RsiUserError('Database unavailable.', 503);
  return env.DB;
}

function cleanDomain(domain: string | undefined): string | null {
  const clean = (domain || '').trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
  return clean || null;
}

export async function indexMemoryDocument(
  env: Env,
  accountId: string,
  input: { kind: MemoryDocKind; title: string; body: string; domain?: string; sourceId?: string },
) {
  const db = requireDb(env);
  if (input.kind !== 'audit' && input.kind !== 'chat') throw new RsiUserError('kind must be audit or chat.');
  const title = input.title.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  if (!title || body.length < 2) throw new RsiUserError('A title and a body are required.');
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO rsi_memory_documents (id, account_id, kind, domain, title, body, source_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, accountId, input.kind, cleanDomain(input.domain), title, body, input.sourceId || null, now)
    .run();
  return { id, createdAt: now };
}

export async function searchAccountMemory(env: Env, accountId: string, query: string) {
  const db = requireDb(env);
  const q = query.trim().slice(0, 200);
  if (q.length < 2) throw new RsiUserError('Query must be at least 2 characters.');
  const rows = await db
    .prepare(
      `SELECT id, kind, domain, title, body, source_id, created_at
       FROM rsi_memory_documents
       WHERE account_id = ?
       ORDER BY created_at DESC LIMIT 300`,
    )
    .bind(accountId)
    .all<{ id: string; kind: MemoryDocKind; domain: string | null; title: string; body: string; source_id: string | null; created_at: number }>();
  const docs: MemoryDocument[] = (rows.results || []).map((row) => ({
    id: row.id,
    kind: row.kind,
    domain: row.domain,
    title: row.title,
    body: row.body,
    sourceId: row.source_id,
    createdAt: row.created_at,
  }));
  const hits = searchMemoryDocuments(docs, q);
  return { hits, nudge: brandFactNudge(hits) };
}
