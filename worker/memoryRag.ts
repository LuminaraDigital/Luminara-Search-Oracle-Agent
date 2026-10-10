/**
 * Luminara memory vector adapter + chat→facts pipeline (Workers).
 * Flow inspired by mem0 / oracle-vector-store adapters; Azure + GCP + CF Vectorize.
 * No vendored third-party business code.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { wrapUntrustedContent } from '../utils/untrustedContent';

export type VectorProvider = 'vectorize' | 'azure' | 'gcp' | 'none';

export type MemoryHistoryEvent = 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';

export type MemoryVectorHit = {
  id: string;
  score: number;
  text: string;
  metadata?: Record<string, unknown>;
};

/** D1 append-only history so vector backends are not the sole record. */
export async function appendMemoryHistory(
  env: Env,
  opts: {
    accountId: string;
    memoryFactId?: string | null;
    event: MemoryHistoryEvent;
    text?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO memory_history (id, account_id, memory_fact_id, event, text_snapshot, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        opts.accountId,
        opts.memoryFactId || null,
        opts.event,
        (opts.text || '').slice(0, 2000),
        JSON.stringify(opts.metadata || {}),
        Date.now(),
      )
      .run();
  } catch {
    /* history must not block memory writes */
  }
}

/** Best-effort remote vector wipe for privacy erasure (fan-out processor). */
export async function deleteAccountMemoryVectors(env: Env, accountId: string): Promise<number> {
  if (!env.DB) return 0;
  const rows = await env.DB.prepare(
    `SELECT id, vector_id, embedding_provider FROM memory_facts WHERE account_id = ? AND vector_id IS NOT NULL`,
  )
    .bind(accountId)
    .all<{ id: string; vector_id: string; embedding_provider: string | null }>();
  let n = 0;
  for (const row of rows.results || []) {
    try {
      if (env.MEMORY_VECTORS && row.vector_id) {
        if (typeof env.MEMORY_VECTORS.deleteByIds === 'function') {
          await env.MEMORY_VECTORS.deleteByIds([row.vector_id]);
        }
      }
      // Azure / GCP: best-effort document delete by id when configured.
      if (row.embedding_provider === 'azure' && env.AZURE_AI_SEARCH_ENDPOINT && env.AZURE_AI_SEARCH_KEY && env.AZURE_AI_SEARCH_INDEX) {
        const endpoint = env.AZURE_AI_SEARCH_ENDPOINT.replace(/\/$/, '');
        const safeId = row.vector_id.replace(/[^a-zA-Z0-9_-]/g, '_');
        await fetch(
          `${endpoint}/indexes/${env.AZURE_AI_SEARCH_INDEX}/docs/index?api-version=2024-07-01`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'api-key': env.AZURE_AI_SEARCH_KEY,
            },
            body: JSON.stringify({ value: [{ '@search.action': 'delete', id: safeId }] }),
          },
        );
      }
      await appendMemoryHistory(env, {
        accountId,
        memoryFactId: row.id,
        event: 'DELETE',
        metadata: { reason: 'privacy_erase', vectorId: row.vector_id },
      });
      n += 1;
    } catch {
      /* continue fan-out */
    }
  }
  return n;
}

export function resolveVectorProvider(env: Env): VectorProvider {
  if (env.MEMORY_VECTORS) return 'vectorize';
  if (env.AZURE_AI_SEARCH_ENDPOINT && env.AZURE_AI_SEARCH_KEY && env.AZURE_AI_SEARCH_INDEX) return 'azure';
  if (env.GCP_VERTEX_VECTOR_ENDPOINT && env.GCP_VERTEX_ACCESS_TOKEN) return 'gcp';
  return 'none';
}

/** Very small local embedding stand-in when no remote embedder is configured. */
export function hashEmbed(text: string, dims = 32): number[] {
  const out = new Array<number>(dims).fill(0);
  const enc = new TextEncoder().encode(text.toLowerCase());
  for (let i = 0; i < enc.length; i++) {
    out[i % dims] += enc[i] / 255;
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => Number((v / norm).toFixed(6)));
}

async function remoteEmbed(env: Env, text: string): Promise<number[]> {
  // Prefer Cloudflare Workers AI when bound; else hashed local vector.
  const ai = (env as Env & { AI?: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } }).AI;
  if (ai) {
    try {
      const res = await ai.run('@cf/baai/bge-base-en-v1.5', { text: [text.slice(0, 2000)] });
      const vec = res?.data?.[0];
      if (Array.isArray(vec) && vec.length) return vec;
    } catch {
      /* fall through */
    }
  }
  return hashEmbed(text, 64);
}

export async function upsertMemoryVector(
  env: Env,
  accountId: string,
  factId: string,
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<{ provider: VectorProvider; vectorId: string | null }> {
  const provider = resolveVectorProvider(env);
  // Memory embeddings are off until a vector index is configured (V decision 3). Workers AI is
  // bound for the chat fallback only, so with no index nothing is embedded.
  if (provider === 'none') return { provider: 'none', vectorId: null };
  const vectorId = `${accountId}:${factId}`;
  const values = await remoteEmbed(env, text);
  const meta = { accountId, factId, text: text.slice(0, 500), ...metadata };

  if (provider === 'vectorize' && env.MEMORY_VECTORS) {
    await env.MEMORY_VECTORS.upsert([{ id: vectorId, values, metadata: meta }]);
    return { provider, vectorId };
  }

  if (provider === 'azure') {
    const endpoint = env.AZURE_AI_SEARCH_ENDPOINT!.replace(/\/$/, '');
    const index = env.AZURE_AI_SEARCH_INDEX!;
    const url = `${endpoint}/indexes/${index}/docs/index?api-version=2024-07-01`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': env.AZURE_AI_SEARCH_KEY!,
      },
      body: JSON.stringify({
        value: [
          {
            '@search.action': 'mergeOrUpload',
            id: vectorId.replace(/[^a-zA-Z0-9_-]/g, '_'),
            content: text,
            accountId,
            embedding: values,
          },
        ],
      }),
    });
    return { provider, vectorId };
  }

  if (provider === 'gcp') {
    await fetch(env.GCP_VERTEX_VECTOR_ENDPOINT!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.GCP_VERTEX_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        datapoints: [{ datapointId: vectorId, featureVector: values, restricts: [{ namespace: 'account', allowList: [accountId] }] }],
      }),
    });
    return { provider, vectorId };
  }

  return { provider: 'none', vectorId: null };
}

export async function searchMemoryVectors(
  env: Env,
  accountId: string,
  query: string,
  topK = 5,
): Promise<MemoryVectorHit[]> {
  const provider = resolveVectorProvider(env);
  // With no vector index the keyword search at the end needs no vector, so nothing is embedded.
  const values = provider === 'none' ? [] : await remoteEmbed(env, query);

  if (provider === 'vectorize' && env.MEMORY_VECTORS) {
    const res = await env.MEMORY_VECTORS.query(values, {
      topK,
      returnMetadata: 'all',
      filter: { accountId },
    });
    return (res.matches || []).map((m) => ({
      id: m.id,
      score: m.score,
      text: String((m.metadata as { text?: string } | null)?.text || ''),
      metadata: (m.metadata as Record<string, unknown>) || {},
    }));
  }

  if (provider === 'azure') {
    const endpoint = env.AZURE_AI_SEARCH_ENDPOINT!.replace(/\/$/, '');
    const index = env.AZURE_AI_SEARCH_INDEX!;
    const url = `${endpoint}/indexes/${index}/docs/search?api-version=2024-07-01`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': env.AZURE_AI_SEARCH_KEY!,
      },
      body: JSON.stringify({
        vectorQueries: [{ kind: 'vector', vector: values, fields: 'embedding', k: topK }],
        filter: `accountId eq '${accountId.replace(/'/g, '')}'`,
        select: 'id,content',
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { value?: Array<{ id: string; content?: string; '@search.score'?: number }> };
    return (data.value || []).map((v) => ({
      id: v.id,
      score: v['@search.score'] || 0,
      text: v.content || '',
    }));
  }

  if (provider === 'gcp') {
    const res = await fetch(env.GCP_VERTEX_VECTOR_ENDPOINT!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.GCP_VERTEX_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        query: { datapoint: { featureVector: values } },
        neighborCount: topK,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { nearestNeighbors?: Array<{ datapoint?: { datapointId?: string }; distance?: number }> };
    return (data.nearestNeighbors || []).map((n) => ({
      id: n.datapoint?.datapointId || '',
      score: 1 - (n.distance || 0),
      text: '',
    }));
  }

  // Fallback: recent D1 facts keyword overlap.
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    `SELECT id, text FROM memory_facts WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(accountId)
    .all<{ id: string; text: string }>();
  const q = query.toLowerCase();
  return (rows.results || [])
    .map((r) => {
      const t = r.text.toLowerCase();
      const score = q.split(/\s+/).filter(Boolean).reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
      return { id: r.id, score, text: r.text };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Chat turn → pending extraction → optional auto-store when confidence high. */
export async function extractFactsFromChat(
  env: Env,
  user: HostedIdentity,
  opts: { sessionId?: string; turnId?: string; message: string; autoStore?: boolean },
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);
  const message = opts.message.trim().slice(0, 4000);
  if (!message) return json({ ok: false, error: 'message required' }, 400);

  // Heuristic extractor (LLM optional later): durable preference / brand lines.
  const candidates: Array<{ text: string; confidence: number }> = [];
  const lines = message.split(/[\n.!?]+/).map((s) => s.trim()).filter((s) => s.length > 12);
  for (const line of lines.slice(0, 8)) {
    const lower = line.toLowerCase();
    let confidence = 0.35;
    if (/\b(prefer|always|never|our brand|we are|competitor|located|serves)\b/.test(lower)) {
      confidence = 0.72;
    }
    if (confidence >= 0.5) candidates.push({ text: line.slice(0, 500), confidence });
  }

  const ids: string[] = [];
  const now = Date.now();
  for (const c of candidates) {
    const id = crypto.randomUUID();
    let memoryFactId: string | null = null;
    let status: 'pending' | 'stored' = 'pending';
    if (opts.autoStore && c.confidence >= 0.7) {
      memoryFactId = `mem_${Date.now().toString(36)}_${ids.length}`;
      const vector = await upsertMemoryVector(env, accountId, memoryFactId, c.text, { source: 'chat' });
      await env.DB.prepare(
        `INSERT INTO memory_facts (id, account_id, text, source, created_at, embedding_provider, vector_id, metadata_json)
         VALUES (?, ?, ?, 'chat', ?, ?, ?, ?)`,
      )
        .bind(
          memoryFactId,
          accountId,
          c.text,
          now,
          vector.provider === 'none' ? null : vector.provider,
          vector.vectorId,
          JSON.stringify({ sessionId: opts.sessionId || null }),
        )
        .run();
      await appendMemoryHistory(env, {
        accountId,
        memoryFactId,
        event: 'ADD',
        text: c.text,
        metadata: { source: 'chat', confidence: c.confidence, provider: vector.provider },
      });
      status = 'stored';
    }
    await env.DB.prepare(
      `INSERT INTO memory_chat_extractions
        (id, account_id, session_id, source_turn_id, fact_text, confidence, status, memory_fact_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, accountId, opts.sessionId || null, opts.turnId || null, c.text, c.confidence, status, memoryFactId, now)
      .run();
    ids.push(id);
  }

  return json({ ok: true, extractionIds: ids, candidates: candidates.length });
}

export async function ragContextForOracle(
  env: Env,
  accountId: string,
  query: string,
): Promise<string> {
  const hits = await searchMemoryVectors(env, accountId, query, 5);
  if (!hits.length) return '';
  const joined = hits.map((h, i) => `${i + 1}. (${h.score.toFixed(2)}) ${h.text}`).join('\n');
  // Memory may contain attacker-influenced chat extracts; fence before system prompt merge.
  return `## Account memory (retrieved)\n${wrapUntrustedContent('ACCOUNT_MEMORY', joined)}`.trim();
}

export async function handleMemoryRagRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (path === '/memory/search' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { query?: string; topK?: number };
    if (!body.query) return json({ ok: false, error: 'query required' }, 400);
    const hits = await searchMemoryVectors(env, billingId(user), body.query, body.topK || 5);
    return json({ ok: true, provider: resolveVectorProvider(env), hits });
  }
  if (path === '/memory/extract' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      sessionId?: string;
      turnId?: string;
      autoStore?: boolean;
    };
    return extractFactsFromChat(env, user, {
      message: body.message || '',
      sessionId: body.sessionId,
      turnId: body.turnId,
      autoStore: Boolean(body.autoStore),
    });
  }
  return null;
}
