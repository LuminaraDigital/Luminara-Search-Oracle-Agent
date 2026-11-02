/**
 * Unified 4-Tier Agentic Memory Router (Mem0 + Letta + Graphiti + OriginTrail dRAG).
 *
 * Bridges Luminara's four memory silos into one coherent, project-scoped engine:
 * 1. Core Symbolic Context (Project Context + Open Audit Findings + Weekly Decision + Dreaming Business Memories).
 * 2. Scoped Semantic & Episodic Facts (`memory_facts` with deduplication, superseding, expiry, and hybrid scoring).
 * 3. Bi-Temporal Knowledge Graph (`memory_edges` with `valid_from` .. `valid_to` and time-travel queries).
 * 4. Self-Editing Memory Tools (`remember`, `recall`, `forget`, `timeline`) for Oracle Chat and `/mcp`.
 *
 * No em dashes in copy.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { billingId, json, sha256Hex } from './workerUtils';
import { appendMemoryHistory, searchMemoryVectors, upsertMemoryVector } from './memoryRag';
import { getActiveBusinessMemories } from './dreamingService';
import type { BusinessMemoryItem } from './dreamingTypes';
import { getProjectContext } from './projectContextService';
import { listProjects } from './projectService';
import { wrapUntrustedContent } from '../utils/untrustedContent';
import { sanitizePii } from '../services/trust/piiSanitizer';

export type MemoryFactKind =
  | 'preference'
  | 'brand_fact'
  | 'decision'
  | 'finding_outcome'
  | 'episode'
  | 'constraint'
  | 'fact';

export type MemoryEdgeDerivation = 'rule' | 'model' | 'user' | 'verified';

export interface ScopedMemoryFact {
  id: string;
  accountId: string;
  projectId: string | null;
  domain: string | null;
  kind: MemoryFactKind;
  text: string;
  importance: number;
  confidence: number;
  status: 'active' | 'superseded' | 'deleted';
  supersededBy: string | null;
  createdAt: number;
  updatedAt: number | null;
  expiresAt: number | null;
  score?: number;
}

export interface TemporalMemoryEdge {
  id: string;
  accountId: string;
  projectId: string | null;
  domain: string | null;
  subjectEntity: string;
  predicate: string;
  objectEntity: string;
  validFrom: number;
  validTo: number | null;
  confidence: number;
  derivation: MemoryEdgeDerivation;
  sourceRef: string | null;
  supersededBy: string | null;
  createdAt: number;
}

export interface RememberFactInput {
  accountId: string;
  text: string;
  projectId?: string | null;
  domain?: string | null;
  kind?: MemoryFactKind;
  importance?: number;
  confidence?: number;
  supersedesFactId?: string | null;
  expiresAt?: number | null;
  source?: string;
}

export interface UpsertEdgeInput {
  accountId: string;
  projectId?: string | null;
  domain?: string | null;
  subjectEntity: string;
  predicate: string;
  objectEntity: string;
  confidence?: number;
  derivation?: MemoryEdgeDerivation;
  sourceRef?: string | null;
  validFrom?: number;
}

export interface UnifiedRecallResult {
  projectId: string | null;
  domain: string | null;
  projectDigest: string | null;
  weeklyDecision: { headline: string; actionText: string; weekStart: string } | null;
  openFindings: Array<{ id: string; severity: string; title: string; category: string }>;
  businessMemories: BusinessMemoryItem[];
  activeEdges: TemporalMemoryEdge[];
  facts: ScopedMemoryFact[];
  strictConstraints?: string[];
  l0Abstract?: string;
  promptBlock: string;
}

const VALID_FACT_KINDS = new Set<MemoryFactKind>([
  'preference', 'brand_fact', 'decision', 'finding_outcome', 'episode', 'constraint', 'fact',
]);

const VALID_EDGE_DERIVATIONS = new Set<MemoryEdgeDerivation>(['rule', 'model', 'user', 'verified']);

export function normalizeMemoryDomain(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
  return clean || null;
}

function clamp01(val: unknown, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(0, Math.min(1, Number(val.toFixed(4))));
}

function rowToScopedFact(
  r: Record<string, unknown>,
  fallback: {
    accountId: string; projectId?: string | null; domain?: string | null; kind?: MemoryFactKind;
    text?: string; importance?: number; confidence?: number; now: number; expiresAt?: number | null;
  },
): ScopedMemoryFact {
  return {
    id: String(r.id),
    accountId: String(r.account_id || fallback.accountId),
    projectId: (r.project_id as string | null) ?? fallback.projectId ?? null,
    domain: (r.domain as string | null) ?? fallback.domain ?? null,
    kind: ((r.kind as MemoryFactKind) || fallback.kind || 'fact'),
    text: String(r.text ?? fallback.text ?? ''),
    importance: Number(r.importance ?? fallback.importance ?? 0.5),
    confidence: Number(r.confidence ?? fallback.confidence ?? 0.8),
    status: ((r.status as 'active' | 'superseded' | 'deleted') || 'active'),
    supersededBy: (r.superseded_by as string | null) ?? null,
    createdAt: Number(r.created_at || fallback.now),
    updatedAt: r.updated_at !== undefined && r.updated_at !== null ? Number(r.updated_at) : fallback.now,
    expiresAt: (r.expires_at as number | null) ?? fallback.expiresAt ?? null,
  };
}

function rowToTemporalEdge(r: Record<string, unknown>, fallbackAccountId?: string): TemporalMemoryEdge {
  return {
    id: String(r.id),
    accountId: String(r.account_id || fallbackAccountId || ''),
    projectId: (r.project_id as string | null) ?? null,
    domain: (r.domain as string | null) ?? null,
    subjectEntity: String(r.subject_entity),
    predicate: String(r.predicate),
    objectEntity: String(r.object_entity),
    validFrom: Number(r.valid_from),
    validTo: r.valid_to !== null && r.valid_to !== undefined ? Number(r.valid_to) : null,
    confidence: Number(r.confidence ?? 0.8),
    derivation: ((r.derivation as MemoryEdgeDerivation) || 'user'),
    sourceRef: (r.source_ref as string | null) ?? null,
    supersededBy: (r.superseded_by as string | null) ?? null,
    createdAt: Number(r.created_at),
  };
}

/**
 * Rejects pure user questions from being stored as declarative facts unless explicitly typed as 'episode'.
 */
export function isQuestionLike(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith('?')) return true;
  return /^(what|why|how|when|where|who|can you|could you|should we|is there|do you)\b/i.test(trimmed);
}

async function verifyOwnedProjectId(env: Env, accountId: string, raw?: string | null): Promise<string | null> {
  const pid = raw?.trim() || null;
  if (!pid || !env.DB) return null;
  const owned = await env.DB.prepare(`SELECT id FROM projects WHERE id = ? AND account_id = ?`)
    .bind(pid, accountId)
    .first<{ id: string }>()
    .catch(() => null);
  return owned ? pid : null;
}

/**
 * Store or supersede a scoped fact in `memory_facts` with SHA-256 deduplication and history tracking.
 */
export async function rememberScopedFact(
  env: Env,
  input: RememberFactInput,
): Promise<
  | { ok: true; fact: ScopedMemoryFact; deduplicated: boolean; supersededFactId: string | null }
  | { ok: false; error: string; code: string }
> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', code: 'DB_UNAVAILABLE' };
  const text = String(input.text || '').trim().slice(0, 2000);
  if (text.length < 3) {
    return { ok: false, error: 'Fact text must be at least 3 characters', code: 'INVALID_TEXT' };
  }
  const kind: MemoryFactKind = input.kind && VALID_FACT_KINDS.has(input.kind) ? input.kind : 'fact';
  if (kind !== 'episode' && isQuestionLike(text)) {
    return {
      ok: false,
      error: 'Questions cannot be stored as declarative facts; use kind="episode" or state a durable fact.',
      code: 'QUESTION_REJECTED',
    };
  }

  const projectId = await verifyOwnedProjectId(env, input.accountId, input.projectId);
  const domain = normalizeMemoryDomain(input.domain);
  const importance = clamp01(input.importance, 0.6);
  const confidence = clamp01(input.confidence, 0.85);
  const now = Date.now();
  const expiresAt =
    typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt) && input.expiresAt > now
      ? Math.floor(input.expiresAt)
      : null;

  const contentSha256 = await sha256Hex(
    `${projectId || ''}|${domain || ''}|${text.toLowerCase().replace(/\s+/g, ' ')}`,
  );

  try {
    // 1. Check for exact active duplicate in the same scope.
    const existing = await env.DB.prepare(
      `SELECT id, account_id, project_id, domain, kind, text, importance, confidence, status,
              superseded_by, created_at, updated_at, expires_at
       FROM memory_facts
       WHERE account_id = ? AND content_sha256 = ? AND (status IS NULL OR status = 'active')
       LIMIT 1`,
    )
      .bind(input.accountId, contentSha256)
      .first<Record<string, unknown>>();

    if (existing && typeof existing.id === 'string') {
      const mergedImportance = Math.max(Number(existing.importance ?? 0.5), importance);
      const mergedConfidence = Math.max(Number(existing.confidence ?? 0.8), confidence);
      const nextExpiresAt = expiresAt ?? (typeof existing.expires_at === 'number' && existing.expires_at > now ? existing.expires_at : null);
      await env.DB.prepare(
        `UPDATE memory_facts
         SET kind = ?, importance = ?, confidence = ?, status = 'active', expires_at = ?, updated_at = ?,
             project_id = COALESCE(project_id, ?), domain = COALESCE(domain, ?)
         WHERE id = ? AND account_id = ?`,
      )
        .bind(kind, mergedImportance, mergedConfidence, nextExpiresAt, now, projectId, domain, existing.id, input.accountId)
        .run();

      return {
        ok: true,
        deduplicated: true,
        supersededFactId: null,
        fact: rowToScopedFact(
          {
            ...existing,
            kind,
            status: 'active',
            importance: mergedImportance,
            confidence: mergedConfidence,
            expires_at: nextExpiresAt,
            updated_at: now,
          },
          { accountId: input.accountId, projectId, domain, kind, text, now, expiresAt: nextExpiresAt },
        ),
      };
    }

    const newId = `mem_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const vector = await upsertMemoryVector(env, input.accountId, newId, text, {
      source: input.source || 'agent',
      projectId,
      domain,
      kind,
    });

    const statements: D1PreparedStatement[] = [];
    let supersededFactId: string | null = null;

    if (input.supersedesFactId) {
      const oldRow = await env.DB.prepare(
        `SELECT id FROM memory_facts WHERE id = ? AND account_id = ? AND (status IS NULL OR status = 'active')`,
      )
        .bind(input.supersedesFactId, input.accountId)
        .first<{ id: string }>();
      if (oldRow?.id) {
        supersededFactId = oldRow.id;
        statements.push(
          env.DB.prepare(
            `UPDATE memory_facts SET status = 'superseded', superseded_by = ?, updated_at = ?
             WHERE id = ? AND account_id = ?`,
          ).bind(newId, now, oldRow.id, input.accountId),
        );
      }
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO memory_facts (
          id, account_id, project_id, domain, kind, text, source,
          importance, confidence, content_sha256, status, superseded_by,
          expires_at, created_at, updated_at, embedding_provider, vector_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId,
        input.accountId,
        projectId,
        domain,
        kind,
        text,
        input.source || 'agent',
        importance,
        confidence,
        contentSha256,
        expiresAt,
        now,
        now,
        vector.provider === 'none' ? null : vector.provider,
        vector.vectorId,
        JSON.stringify({
          projectId,
          domain,
          kind,
          importance,
          confidence,
          supersededFactId,
        }),
      ),
    );

    await env.DB.batch(statements);

    await appendMemoryHistory(env, {
      accountId: input.accountId,
      memoryFactId: newId,
      event: supersededFactId ? 'UPDATE' : 'ADD',
      text,
      metadata: { projectId, domain, kind, importance, confidence, supersededFactId },
    });

    return {
      ok: true,
      deduplicated: false,
      supersededFactId,
      fact: rowToScopedFact(
        { id: newId, importance, confidence, created_at: now, updated_at: now },
        { accountId: input.accountId, projectId, domain, kind, text, now, expiresAt },
      ),
    };
  } catch {
    return { ok: false, error: 'Memory schema migration 0044 required', code: 'SCHEMA_NOT_MIGRATED' };
  }
}

/**
 * Soft-delete a memory fact, purge its vector if bound, and record a DELETE audit entry.
 */
export async function forgetScopedFact(
  env: Env,
  accountId: string,
  factId: string,
  reason = 'user_or_agent_forget',
): Promise<{ ok: boolean; deleted: boolean; error?: string }> {
  if (!env.DB) return { ok: false, deleted: false, error: 'Database unavailable' };
  try {
    const row = await env.DB.prepare(
      `SELECT id, text, vector_id FROM memory_facts WHERE id = ? AND account_id = ?`,
    )
      .bind(factId, accountId)
      .first<{ id: string; text: string; vector_id: string | null }>();

    if (!row) return { ok: false, deleted: false, error: 'Memory fact not found' };

    const now = Date.now();
    await env.DB.prepare(
      `UPDATE memory_facts SET status = 'deleted', updated_at = ? WHERE id = ? AND account_id = ?`,
    )
      .bind(now, factId, accountId)
      .run();

    if (row.vector_id && env.MEMORY_VECTORS && typeof env.MEMORY_VECTORS.deleteByIds === 'function') {
      try {
        await env.MEMORY_VECTORS.deleteByIds([row.vector_id]);
      } catch {
        /* best effort vector delete */
      }
    }

    await appendMemoryHistory(env, {
      accountId,
      memoryFactId: factId,
      event: 'DELETE',
      text: row.text,
      metadata: { reason },
    });

    return { ok: true, deleted: true };
  } catch {
    return { ok: false, deleted: false, error: 'Memory schema migration 0044 required' };
  }
}

/**
 * Bi-Temporal Knowledge Graph (Graphiti / Zep pattern):
 * Inserts or supersedes a `(subject_entity, predicate, object_entity)` edge.
 * If an active edge (`valid_to IS NULL`) for the same `(subject, predicate)` has a different object,
 * it closes the old edge's validity interval (`valid_to = validFrom`) and points `superseded_by` to the new edge.
 */
export async function upsertTemporalEdge(
  env: Env,
  input: UpsertEdgeInput,
): Promise<
  | {
      ok: true;
      edge: TemporalMemoryEdge;
      deduplicated: boolean;
      supersededEdgeId: string | null;
    }
  | { ok: false; error: string }
> {
  if (!env.DB) return { ok: false, error: 'Database unavailable' };
  const subjectEntity = String(input.subjectEntity || '').trim().slice(0, 200);
  const predicate = String(input.predicate || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .slice(0, 120);
  const objectEntity = String(input.objectEntity || '').trim().slice(0, 500);

  if (!subjectEntity || !predicate || !objectEntity) {
    return { ok: false, error: 'subjectEntity, predicate, and objectEntity are required' };
  }

  const projectId = await verifyOwnedProjectId(env, input.accountId, input.projectId);
  const domain = normalizeMemoryDomain(input.domain);
  const confidence = clamp01(input.confidence, 0.85);
  const derivation: MemoryEdgeDerivation =
    input.derivation && VALID_EDGE_DERIVATIONS.has(input.derivation) ? input.derivation : 'user';
  const now = Date.now();
  const validFrom =
    typeof input.validFrom === 'number' && Number.isFinite(input.validFrom) ? Math.floor(input.validFrom) : now;

  try {
    // Find active edge with same (account_id, project_id, domain, subject_entity, predicate)
    const active = await env.DB.prepare(
      `SELECT id, project_id, domain, subject_entity, predicate, object_entity,
              valid_from, valid_to, confidence, derivation, source_ref, superseded_by, created_at
       FROM memory_edges
       WHERE account_id = ?
         AND COALESCE(project_id, '') = COALESCE(?, '')
         AND COALESCE(domain, '') = COALESCE(?, '')
         AND LOWER(subject_entity) = LOWER(?)
         AND predicate = ?
         AND valid_to IS NULL
       ORDER BY valid_from DESC
       LIMIT 1`,
    )
      .bind(input.accountId, projectId, domain, subjectEntity, predicate)
      .first<Record<string, unknown>>();

    if (
      active &&
      typeof active.id === 'string' &&
      String(active.object_entity || '').trim().toLowerCase() === objectEntity.toLowerCase()
    ) {
      const mergedConfidence = Math.max(Number(active.confidence ?? 0.8), confidence);
      await env.DB.prepare(
        `UPDATE memory_edges SET confidence = ?, source_ref = COALESCE(?, source_ref) WHERE id = ? AND account_id = ?`,
      )
        .bind(mergedConfidence, input.sourceRef || null, active.id, input.accountId)
        .run();

      return {
        ok: true,
        deduplicated: true,
        supersededEdgeId: null,
        edge: rowToTemporalEdge(
          {
            ...active,
            project_id: (active.project_id as string | null) ?? projectId,
            domain: (active.domain as string | null) ?? domain,
            confidence: mergedConfidence,
            source_ref: (input.sourceRef ?? (active.source_ref as string | null)) || null,
          },
          input.accountId,
        ),
      };
    }

    const newEdgeId = `edge_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const statements: D1PreparedStatement[] = [];
    let supersededEdgeId: string | null = null;

    if (active && typeof active.id === 'string') {
      supersededEdgeId = active.id;
      statements.push(
        env.DB.prepare(
          `UPDATE memory_edges SET valid_to = ?, superseded_by = ? WHERE id = ? AND account_id = ?`,
        ).bind(validFrom, newEdgeId, active.id, input.accountId),
      );
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO memory_edges (
          id, account_id, project_id, domain, subject_entity, predicate, object_entity,
          valid_from, valid_to, confidence, derivation, source_ref, superseded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)`,
      ).bind(
        newEdgeId, input.accountId, projectId, domain, subjectEntity, predicate, objectEntity,
        validFrom, confidence, derivation, input.sourceRef || null, now,
      ),
    );

    await env.DB.batch(statements);

    return {
      ok: true,
      deduplicated: false,
      supersededEdgeId,
      edge: rowToTemporalEdge(
        {
          id: newEdgeId, account_id: input.accountId, project_id: projectId, domain,
          subject_entity: subjectEntity, predicate, object_entity: objectEntity,
          valid_from: validFrom, valid_to: null, confidence, derivation,
          source_ref: input.sourceRef || null, superseded_by: null, created_at: now,
        },
        input.accountId,
      ),
    };
  } catch {
    return { ok: false, error: 'Memory edges schema migration 0044 required' };
  }
}

/**
 * Query the Bi-Temporal Knowledge Graph (`memory_edges`) with optional point-in-time (`asOfTimestamp`)
 * or full historical timeline retrieval.
 */
export async function queryTemporalTimeline(
  env: Env,
  opts: {
    accountId: string;
    projectId?: string | null;
    domain?: string | null;
    subjectEntity?: string | null;
    predicate?: string | null;
    activeOnly?: boolean;
    asOfTimestamp?: number | null;
    limit?: number;
  },
): Promise<TemporalMemoryEdge[]> {
  if (!env.DB) return [];
  const clauses: string[] = ['account_id = ?'];
  const binds: unknown[] = [opts.accountId];

  const cleanDom = normalizeMemoryDomain(opts.domain);
  if (cleanDom) {
    clauses.push('domain = ?');
    binds.push(cleanDom);
  }
  if (opts.projectId) {
    clauses.push('project_id = ?');
    binds.push(opts.projectId.trim());
  }
  if (opts.subjectEntity) {
    clauses.push('LOWER(subject_entity) = LOWER(?)');
    binds.push(opts.subjectEntity.trim());
  }
  if (opts.predicate) {
    clauses.push('predicate = ?');
    binds.push(opts.predicate.trim().toLowerCase().replace(/\s+/g, '_'));
  }
  if (typeof opts.asOfTimestamp === 'number' && Number.isFinite(opts.asOfTimestamp)) {
    clauses.push('valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)');
    binds.push(Math.floor(opts.asOfTimestamp), Math.floor(opts.asOfTimestamp));
  } else if (opts.activeOnly) {
    clauses.push('valid_to IS NULL');
  }

  const rawLimit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) ? Math.floor(opts.limit) : 30;
  const limit = Math.max(1, Math.min(100, rawLimit));
  binds.push(limit);

  try {
    const res = await env.DB.prepare(
      `SELECT id, account_id, project_id, domain, subject_entity, predicate, object_entity,
              valid_from, valid_to, confidence, derivation, source_ref, superseded_by, created_at
       FROM memory_edges
       WHERE ${clauses.join(' AND ')}
       ORDER BY valid_from DESC, created_at DESC
       LIMIT ?`,
    )
      .bind(...binds)
      .all<Record<string, unknown>>();

    return (res.results || []).map((r) => rowToTemporalEdge(r, opts.accountId));
  } catch {
    return [];
  }
}

/**
 * Compute hybrid retrieval score combining lexical/vector similarity, importance, exponential recency decay,
 * and project/domain scope affinity.
 */
function scoreMemoryCandidate(
  queryTokens: string[],
  row: {
    text: string;
    importance: number;
    createdAt: number;
    projectId: string | null;
    domain: string | null;
  },
  targetProjectId: string | null,
  targetDomain: string | null,
  vectorScoreMap: Map<string, number>,
  factId: string,
  now: number,
): number {
  const lower = row.text.toLowerCase();
  const lexicalHits = queryTokens.length
    ? queryTokens.reduce((acc, tok) => acc + (lower.includes(tok) ? 1 : 0), 0) / queryTokens.length
    : 0.3;
  const vecSim = vectorScoreMap.get(factId) ?? lexicalHits;
  const sim = Math.max(lexicalHits, vecSim);

  const ageDays = Math.max(0, (now - row.createdAt) / (1000 * 60 * 60 * 24));
  const recency = Math.exp(-0.04 * ageDays);

  const scopeMatch =
    (targetProjectId && row.projectId === targetProjectId) ||
    (targetDomain && row.domain === targetDomain)
      ? 1.0
      : !row.projectId && !row.domain
        ? 0.5
        : 0.0;

  return Number((0.45 * sim + 0.25 * row.importance + 0.2 * recency + 0.1 * scopeMatch).toFixed(4));
}

/**
 * OriginTrail dRAG + Mem0 Hybrid Retrieval:
 * 1. Pulls deterministic symbolic context first (Project Context, Weekly Decision, Open Audit Findings,
 *    Luminara Dreaming Business Memories, and active Bi-Temporal Knowledge Graph edges).
 * 2. Runs hybrid semantic + recency + importance + scope scoring over active `memory_facts`.
 */
export async function recallUnifiedContext(
  env: Env,
  opts: {
    accountId: string;
    query?: string;
    projectId?: string | null;
    domain?: string | null;
    topK?: number;
  },
): Promise<UnifiedRecallResult> {
  const now = Date.now();
  const topK = Math.max(1, Math.min(25, opts.topK ?? 8));
  let projectId = opts.projectId?.trim() || null;
  let domain = normalizeMemoryDomain(opts.domain);
  const query = (opts.query || '').trim();
  const queryTokens = query
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((w) => w.length >= 2);

  const loadRawFacts = async (): Promise<Record<string, unknown>[]> => {
    if (!env.DB) return [];
    try {
      const rows = await env.DB.prepare(
        `SELECT id, account_id, project_id, domain, kind, text, importance, confidence,
                status, superseded_by, created_at, updated_at, expires_at
         FROM memory_facts
         WHERE account_id = ?
           AND (status IS NULL OR status = 'active')
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC
         LIMIT 100`,
      )
        .bind(opts.accountId, now)
        .all<Record<string, unknown>>();
      return rows.results || [];
    } catch {
      try {
        const legacyRows = await env.DB.prepare(
          `SELECT id, account_id, text, created_at
           FROM memory_facts
           WHERE account_id = ?
           ORDER BY created_at DESC
           LIMIT 100`,
        )
          .bind(opts.accountId)
          .all<Record<string, unknown>>();
        return legacyRows.results || [];
      } catch {
        return [];
      }
    }
  };

  // Run account-scoped lookups in a single parallel batch to minimize microtask latency.
  const [projects, rawTimelineEdges, vecHits, rawFacts] = await Promise.all([
    env.DB && (!projectId || !domain)
      ? listProjects(env, opts.accountId).catch(() => [])
      : Promise.resolve([]),
    queryTemporalTimeline(env, {
      accountId: opts.accountId,
      projectId,
      domain,
      activeOnly: true,
      limit: 24,
    }),
    query
      ? searchMemoryVectors(env, opts.accountId, query, topK * 2).catch(() => [])
      : Promise.resolve([]),
    loadRawFacts(),
  ]);

  if (projects.length > 0 && (!projectId || !domain)) {
    if (projectId && !domain) {
      const match = projects.find((p) => p.id === projectId);
      if (match) domain = normalizeMemoryDomain(match.domain);
    } else if (!projectId && domain) {
      const match = projects.find((p) => normalizeMemoryDomain(p.domain) === domain);
      if (match) projectId = match.id;
    } else if (!projectId && !domain && projects.length === 1) {
      projectId = projects[0].id;
      domain = normalizeMemoryDomain(projects[0].domain);
    }
  }

  const activeEdges = rawTimelineEdges
    .filter((e) => {
      if (projectId && e.projectId && e.projectId !== projectId) return false;
      if (domain && e.domain && e.domain.toLowerCase() !== domain.toLowerCase()) return false;
      return true;
    })
    .slice(0, 12);

  let projectDigest: string | null = null;
  let openFindings: Array<{ id: string; severity: string; title: string; category: string }> = [];
  let weeklyDecision: { headline: string; actionText: string; weekStart: string } | null = null;
  let businessMemories: BusinessMemoryItem[] = [];

  if (env.DB && (projectId || domain)) {
    const [ctxRes, findingsRes, wdlRow, bmRes] = await Promise.all([
      projectId ? getProjectContext(env, opts.accountId, projectId).catch(() => null) : Promise.resolve(null),
      domain
        ? env.DB.prepare(
            `SELECT id, severity, title, category
             FROM audit_findings
             WHERE account_id = ? AND LOWER(domain) = LOWER(?) AND status IN ('open', 'in_progress')
             ORDER BY updated_at DESC LIMIT 5`,
          )
            .bind(opts.accountId, domain)
            .all<{ id: string; severity: string; title: string; category: string }>()
            .then((r) => r.results || [])
            .catch(() => [])
        : Promise.resolve([]),
      domain
        ? env.DB.prepare(
            `SELECT week_key, title, why_text
             FROM weekly_decisions
             WHERE account_id = ? AND LOWER(domain) = LOWER(?)
             ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
          )
            .bind(opts.accountId, domain)
            .first<{ week_key: string; title: string; why_text: string }>()
            .catch(() => null)
        : Promise.resolve(null),
      domain ? getActiveBusinessMemories(env, opts.accountId, domain).catch(() => []) : Promise.resolve([]),
    ]);
    if (ctxRes) projectDigest = ctxRes.digestMarkdown;
    openFindings = findingsRes;
    if (wdlRow) {
      weeklyDecision = {
        weekStart: wdlRow.week_key,
        headline: wdlRow.title,
        actionText: wdlRow.why_text,
      };
    }
    businessMemories = bmRes;
  }

  const vectorScoreMap = new Map<string, number>();
  for (const h of vecHits) {
    const cleanId = h.id.includes(':') ? h.id.split(':').slice(1).join(':') : h.id;
    vectorScoreMap.set(cleanId, h.score);
  }

  let facts: ScopedMemoryFact[] = [];
  let allScopedConstraintTexts: string[] = [];
  if (env.DB) {

    const inScope = rawFacts
      .map((r) => {
        const id = String(r.id);
        const cleanText = sanitizePii(String(r.text || '')).sanitized;
        const item = rowToScopedFact(
          { ...r, text: cleanText, updated_at: r.updated_at ?? null },
          { accountId: opts.accountId, now },
        );
        item.score = scoreMemoryCandidate(queryTokens, item, projectId, domain, vectorScoreMap, id, now);
        return item;
      })
      .filter((item) => {
        if (domain && item.domain && item.domain.toLowerCase() !== domain.toLowerCase()) return false;
        if (projectId && item.projectId && item.projectId !== projectId) return false;
        return true;
      });

    allScopedConstraintTexts = inScope.filter((f) => f.kind === 'constraint').map((f) => f.text);
    facts = inScope.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
  }

  // 5. Build Fenced Prompt Block with GAM L0 Abstract + Negative Constraints Gate
  const strictConstraints = Array.from(
    new Set([
      ...allScopedConstraintTexts,
      ...activeEdges
        .filter((e) => e.predicate === 'never_bring_up')
        .map((e) => `Never bring up or suggest: ${sanitizePii(e.objectEntity).sanitized}`),
    ]),
  );
  const l0Abstract = `Scope: ${domain || 'account-wide'}${projectId ? ` (${projectId})` : ''} | Active facts: ${facts.length} | Graph edges: ${activeEdges.length} | Open findings: ${openFindings.length} | Strict constraints: ${strictConstraints.length}`;

  const sections: string[] = [`### L0 Memory Abstract\n${l0Abstract}`];
  if (strictConstraints.length) {
    sections.push(`### Strict Negative Constraints (Never Bring Up)\n${strictConstraints.map((c) => `- [DO NOT VIOLATE] ${c}`).join('\n')}`);
  }
  if (projectDigest) sections.push(`### Project Context\n${projectDigest.slice(0, 2000)}`);
  if (weeklyDecision) {
    sections.push(`### Active Weekly Decision (${weeklyDecision.weekStart})\n- Headline: ${weeklyDecision.headline}\n- Next Action: ${weeklyDecision.actionText}`);
  }
  if (openFindings.length) {
    sections.push(`### Open Audit Findings (${domain})\n${openFindings.map((f) => `- [${f.severity.toUpperCase()}] (${f.category}) ${f.title}`).join('\n')}`);
  }
  if (businessMemories.length) {
    sections.push(`### Consolidated Business Memories (Dreaming)\n${businessMemories.slice(0, 6).map((m) => `- [${m.memoryType}] ${m.title}: ${m.content.slice(0, 240)}`).join('\n')}`);
  }
  if (activeEdges.length) {
    sections.push(`### Temporal Knowledge Graph (Active Entities & Relationships)\n${activeEdges.map((e) => `- ${e.subjectEntity} -> ${e.predicate} -> ${e.objectEntity} (since ${new Date(e.validFrom).toISOString().slice(0, 10)}, ${e.derivation})`).join('\n')}`);
  }
  if (facts.length) {
    sections.push(`### Scoped Memory Facts\n${facts.map((f, i) => `${i + 1}. [${f.kind}] (score ${(f.score ?? 0).toFixed(2)}) ${f.text}`).join('\n')}`);
  }

  const hasSignal = sections.length > 1;
  const promptBlock = hasSignal
    ? `## Unified Agent Memory (retrieved)\n${wrapUntrustedContent('ACCOUNT_MEMORY', sanitizePii(sections.join('\n\n')).sanitized)}`
    : '';

  return {
    projectId,
    domain,
    projectDigest,
    weeklyDecision,
    openFindings,
    businessMemories,
    activeEdges,
    facts,
    strictConstraints,
    l0Abstract,
    promptBlock,
  };
}

/**
 * HTTP Route handler for `/memory/unified/*` endpoints (`remember`, `recall`, `forget`, `edges`, `timeline`).
 */
export async function handleUnifiedMemoryRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  const accountId = billingId(user);

  if (path === '/memory/unified/remember' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as Record<string, unknown>;
    if (body.accountId !== undefined || body.userId !== undefined) {
      return json({ ok: false, error: 'Identity comes from auth', code: 'INVALID_PAYLOAD' }, 400);
    }
    const res = await rememberScopedFact(env, {
      accountId,
      text: typeof body.text === 'string' ? body.text : '',
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      domain: typeof body.domain === 'string' ? body.domain : null,
      kind: typeof body.kind === 'string' ? (body.kind as MemoryFactKind) : undefined,
      importance: typeof body.importance === 'number' ? body.importance : undefined,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      supersedesFactId: typeof body.supersedesFactId === 'string' ? body.supersedesFactId : null,
      expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : null,
      source: 'api',
    });
    return json(res, res.ok ? 200 : 400);
  }

  if (path === '/memory/unified/recall' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as Record<string, unknown>;
    const res = await recallUnifiedContext(env, {
      accountId,
      query: typeof body.query === 'string' ? body.query : '',
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      domain: typeof body.domain === 'string' ? body.domain : null,
      topK: typeof body.topK === 'number' ? body.topK : 8,
    });
    return json({ ok: true, ...res });
  }

  if (path === '/memory/unified/forget' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as { factId?: string; reason?: string };
    if (!body.factId || typeof body.factId !== 'string') {
      return json({ ok: false, error: 'factId required' }, 400);
    }
    const res = await forgetScopedFact(env, accountId, body.factId.trim(), body.reason);
    return json(res, res.ok ? 200 : 404);
  }

  if (path === '/memory/unified/edges' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as Record<string, unknown>;
    if (body.accountId !== undefined || body.userId !== undefined) {
      return json({ ok: false, error: 'Identity comes from auth', code: 'INVALID_PAYLOAD' }, 400);
    }
    const res = await upsertTemporalEdge(env, {
      accountId,
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      domain: typeof body.domain === 'string' ? body.domain : null,
      subjectEntity: typeof body.subjectEntity === 'string' ? body.subjectEntity : '',
      predicate: typeof body.predicate === 'string' ? body.predicate : '',
      objectEntity: typeof body.objectEntity === 'string' ? body.objectEntity : '',
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      derivation: 'user',
      sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef : null,
      validFrom: typeof body.validFrom === 'number' ? body.validFrom : undefined,
    });
    return json(res, res.ok ? 200 : 400);
  }

  if (path === '/memory/unified/timeline' && request.method === 'GET') {
    const url = new URL(request.url);
    const asOfRaw = url.searchParams.get('asOf');
    const parsedAsOf = asOfRaw != null && asOfRaw.trim() !== '' ? Number(asOfRaw) : null;
    const parsedLimit = Number(url.searchParams.get('limit') || 30);
    const edges = await queryTemporalTimeline(env, {
      accountId,
      projectId: url.searchParams.get('projectId'),
      domain: url.searchParams.get('domain'),
      subjectEntity: url.searchParams.get('subjectEntity'),
      predicate: url.searchParams.get('predicate'),
      activeOnly: url.searchParams.get('activeOnly') === 'true',
      asOfTimestamp: parsedAsOf != null && Number.isFinite(parsedAsOf) ? parsedAsOf : null,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 30,
    });
    return json({ ok: true, edges });
  }

  return null;
}
