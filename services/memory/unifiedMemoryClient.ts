/**
 * Frontend Client SDK for Luminara's 4-Tier Agentic Memory, Bi-Temporal Knowledge Graph,
 * and Verifiable On-Chain Memory Vault (`/api/memory/unified/*` & `/api/memory/vault/*`).
 *
 * Includes offline/guest resilience via `localStorage` and syncs facts into `mem0MemoryEngine`.
 * No em dashes in copy.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import { mem0MemoryEngine } from '../agentCore/mem0MemoryEngine';

export type ClientMemoryFactKind =
  | 'preference'
  | 'brand_fact'
  | 'decision'
  | 'finding_outcome'
  | 'episode'
  | 'constraint'
  | 'fact';

export interface ClientScopedFact {
  id: string;
  accountId: string;
  projectId: string | null;
  domain: string | null;
  kind: ClientMemoryFactKind;
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

export interface ClientTemporalEdge {
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
  derivation: 'rule' | 'model' | 'user' | 'verified';
  sourceRef: string | null;
  supersededBy: string | null;
  createdAt: number;
}

export interface ClientVaultSnapshotRow {
  id: string;
  project_id: string | null;
  domain: string | null;
  merkle_root: string;
  leaf_count: number;
  cid: string;
  storage_backend: 'd1' | 'r2' | 'ipfs' | 'client_only';
  anchor_id: string | null;
  chain: string;
  network: 'mainnet' | 'testnet';
  tx_hash: string | null;
  created_at: number;
}

export interface CreateVaultSnapshotResponse {
  ok: boolean;
  snapshotId?: string;
  merkleRoot?: string;
  cid?: string;
  leafCount?: number;
  leafHashes?: string[];
  storageBackend?: 'd1' | 'r2' | 'ipfs' | 'client_only';
  encrypted?: boolean;
  tonAnchorDraft?: {
    validUntil: number;
    network: 'mainnet' | 'testnet';
    memo: string;
    amountNano: string;
    recipientAddress: string | null;
  };
  error?: string;
}

export type UnifiedRecallResponse = Awaited<ReturnType<typeof unifiedMemoryClient.recallContext>>;

const LOCAL_FACTS_KEY = 'luminara:unified_memory:facts_v1';
const LOCAL_EDGES_KEY = 'luminara:unified_memory:edges_v1';
const LOCAL_SNAPSHOTS_KEY = 'luminara:unified_memory:vault_snapshots_v1';

function readLocal<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

function cleanDomain(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  return trimmed || null;
}

export const unifiedMemoryClient = {
  async recallContext(opts: {
    domain?: string | null;
    projectId?: string | null;
    query?: string;
    topK?: number;
  }): Promise<{
    ok: boolean;
    domain: string | null;
    projectId: string | null;
    l0Abstract?: string;
    strictConstraints: string[];
    facts: ClientScopedFact[];
    activeEdges: ClientTemporalEdge[];
  }> {
    const dom = cleanDomain(opts.domain);
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/unified/recall`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: dom,
          projectId: opts.projectId || null,
          query: opts.query || '',
          topK: opts.topK ?? 20,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ok: boolean;
          domain: string | null;
          projectId: string | null;
          l0Abstract?: string;
          strictConstraints?: string[];
          facts?: ClientScopedFact[];
          activeEdges?: ClientTemporalEdge[];
        };
        if (Array.isArray(data.facts)) {
          writeLocal(LOCAL_FACTS_KEY, data.facts);
        }
        return {
          ok: true,
          domain: data.domain ?? dom,
          projectId: data.projectId ?? (opts.projectId || null),
          l0Abstract: data.l0Abstract,
          strictConstraints: data.strictConstraints || [],
          facts: data.facts || [],
          activeEdges: data.activeEdges || [],
        };
      }
    } catch {
      /* fallback to local storage */
    }

    const localFacts = readLocal<ClientScopedFact[]>(LOCAL_FACTS_KEY, []).filter(
      (f) => f.status === 'active' && (!dom || !f.domain || f.domain === dom),
    );
    const localEdges = readLocal<ClientTemporalEdge[]>(LOCAL_EDGES_KEY, []).filter(
      (e) => e.validTo === null && (!dom || !e.domain || e.domain === dom),
    );
    const strictConstraints = localFacts.filter((f) => f.kind === 'constraint').map((f) => f.text);

    return {
      ok: true,
      domain: dom,
      projectId: opts.projectId || null,
      l0Abstract: `Scope: ${dom || 'local'} | Active facts: ${localFacts.length} | Graph edges: ${localEdges.length} | Strict constraints: ${strictConstraints.length}`,
      strictConstraints,
      facts: localFacts,
      activeEdges: localEdges,
    };
  },

  async rememberFact(opts: {
    text: string;
    domain?: string | null;
    projectId?: string | null;
    kind?: ClientMemoryFactKind;
    importance?: number;
    confidence?: number;
    supersedesFactId?: string | null;
  }): Promise<{
    ok: boolean;
    fact?: ClientScopedFact;
    deduplicated?: boolean;
    supersededFactId?: string | null;
    error?: string;
  }> {
    const dom = cleanDomain(opts.domain);
    const kind = opts.kind || 'fact';
    if (opts.text.trim().length > 0) {
      try {
        mem0MemoryEngine.applyDelta({
          action: 'ADD',
          tier: kind === 'preference' || kind === 'constraint' ? 'user' : 'domain_entity',
          entityId: dom || 'account',
          key: `${kind}_${Date.now().toString(36)}`,
          value: opts.text.trim(),
          rationale: 'Unified memory client sync',
          confidence: opts.confidence ?? 0.9,
        });
      } catch {
        /* ignore local mem0 sync error */
      }
    }

    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/unified/remember`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: opts.text,
          domain: dom,
          projectId: opts.projectId || null,
          kind,
          importance: opts.importance,
          confidence: opts.confidence,
          supersedesFactId: opts.supersedesFactId || null,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        fact?: ClientScopedFact;
        deduplicated?: boolean;
        supersededFactId?: string | null;
        error?: string;
      };
      if (res.ok && data.ok) return data;
      if (data.error) return { ok: false, error: data.error };
    } catch {
      /* fallback to local storage */
    }

    const now = Date.now();
    const localFacts = readLocal<ClientScopedFact[]>(LOCAL_FACTS_KEY, []);
    const newFact: ClientScopedFact = {
      id: `mem_local_${now.toString(36)}`,
      accountId: 'local',
      projectId: opts.projectId || null,
      domain: dom,
      kind,
      text: opts.text.trim(),
      importance: opts.importance ?? (kind === 'constraint' ? 0.95 : 0.75),
      confidence: opts.confidence ?? 0.9,
      status: 'active',
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    };
    if (opts.supersedesFactId) {
      for (const item of localFacts) {
        if (item.id === opts.supersedesFactId) {
          item.status = 'superseded';
          item.supersededBy = newFact.id;
        }
      }
    }
    localFacts.unshift(newFact);
    writeLocal(LOCAL_FACTS_KEY, localFacts.slice(0, 200));
    return {
      ok: true,
      fact: newFact,
      deduplicated: false,
      supersededFactId: opts.supersedesFactId || null,
    };
  },

  async forgetFact(factId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
    const evictLocal = () => {
      const localFacts = readLocal<ClientScopedFact[]>(LOCAL_FACTS_KEY, []).filter(
        (f) => f.id !== factId,
      );
      writeLocal(LOCAL_FACTS_KEY, localFacts);
    };
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/unified/forget`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ factId, reason }),
      });
      if (res.ok) {
        evictLocal();
        return { ok: true };
      }
    } catch {
      /* fallback to local storage */
    }
    evictLocal();
    return { ok: true };
  },

  async upsertEdge(opts: {
    domain?: string | null;
    projectId?: string | null;
    subjectEntity: string;
    predicate: string;
    objectEntity: string;
    confidence?: number;
  }): Promise<{
    ok: boolean;
    edge?: ClientTemporalEdge;
    supersededEdgeId?: string | null;
    error?: string;
  }> {
    const dom = cleanDomain(opts.domain);
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/unified/edges`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: dom,
          projectId: opts.projectId || null,
          subjectEntity: opts.subjectEntity,
          predicate: opts.predicate,
          objectEntity: opts.objectEntity,
          confidence: opts.confidence ?? 0.9,
          derivation: 'user',
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        edge?: ClientTemporalEdge;
        supersededEdgeId?: string | null;
        error?: string;
      };
      if (res.ok && data.ok) return data;
      if (data.error) return { ok: false, error: data.error };
    } catch {
      /* fallback to local storage */
    }

    const now = Date.now();
    const localEdges = readLocal<ClientTemporalEdge[]>(LOCAL_EDGES_KEY, []);
    const cleanPred = opts.predicate.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
    const newEdge: ClientTemporalEdge = {
      id: `edge_local_${now.toString(36)}`,
      accountId: 'local',
      projectId: opts.projectId || null,
      domain: dom,
      subjectEntity: opts.subjectEntity.trim(),
      predicate: cleanPred,
      objectEntity: opts.objectEntity.trim(),
      validFrom: now,
      validTo: null,
      confidence: opts.confidence ?? 0.9,
      derivation: 'user',
      sourceRef: 'ui',
      supersededBy: null,
      createdAt: now,
    };
    let supersededEdgeId: string | null = null;
    for (const edge of localEdges) {
      if (
        edge.validTo === null &&
        edge.subjectEntity.toLowerCase() === newEdge.subjectEntity.toLowerCase() &&
        edge.predicate === newEdge.predicate
      ) {
        edge.validTo = now;
        edge.supersededBy = newEdge.id;
        supersededEdgeId = edge.id;
      }
    }
    localEdges.unshift(newEdge);
    writeLocal(LOCAL_EDGES_KEY, localEdges.slice(0, 200));
    return { ok: true, edge: newEdge, supersededEdgeId };
  },

  async queryTimeline(opts: {
    domain?: string | null;
    projectId?: string | null;
    activeOnly?: boolean;
    asOfTimestamp?: number | null;
    limit?: number;
  }): Promise<ClientTemporalEdge[]> {
    const dom = cleanDomain(opts.domain);
    const params = new URLSearchParams();
    if (dom) params.set('domain', dom);
    if (opts.projectId) params.set('projectId', opts.projectId);
    if (opts.activeOnly) params.set('activeOnly', 'true');
    if (opts.asOfTimestamp) params.set('asOf', String(opts.asOfTimestamp));
    params.set('limit', String(opts.limit ?? 50));

    try {
      const res = await workerFetchWithAuthRetry(
        `${apiBase()}/api/memory/unified/timeline?${params.toString()}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; edges?: ClientTemporalEdge[] };
        if (Array.isArray(data.edges)) {
          if (!opts.asOfTimestamp && !opts.activeOnly) {
            writeLocal(LOCAL_EDGES_KEY, data.edges);
          }
          return data.edges;
        }
      }
    } catch {
      /* fallback to local storage */
    }

    return readLocal<ClientTemporalEdge[]>(LOCAL_EDGES_KEY, []).filter((e) => {
      if (dom && e.domain && e.domain !== dom) return false;
      if (opts.asOfTimestamp) {
        return e.validFrom <= opts.asOfTimestamp && (e.validTo === null || e.validTo > opts.asOfTimestamp);
      }
      if (opts.activeOnly) return e.validTo === null;
      return true;
    });
  },

  async createVaultSnapshot(opts: {
    domain?: string | null;
    projectId?: string | null;
    passphrase?: string | null;
  }): Promise<CreateVaultSnapshotResponse> {
    const dom = cleanDomain(opts.domain);
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/vault/snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: dom,
          projectId: opts.projectId || null,
          passphrase: opts.passphrase || null,
        }),
      });
      const data = (await res.json()) as CreateVaultSnapshotResponse;
      if (res.ok && data.ok) return data;
      return { ok: false, error: data.error || 'Failed to create vault snapshot' };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  },

  async listVaultSnapshots(): Promise<ClientVaultSnapshotRow[]> {
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/vault/list`);
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; snapshots?: ClientVaultSnapshotRow[] };
        if (Array.isArray(data.snapshots)) {
          writeLocal(LOCAL_SNAPSHOTS_KEY, data.snapshots);
          return data.snapshots;
        }
      }
    } catch {
      /* fallback to local storage */
    }
    return readLocal<ClientVaultSnapshotRow[]>(LOCAL_SNAPSHOTS_KEY, []);
  },

  async verifyVaultLeaf(opts: {
    snapshotId: string;
    leafHash: string;
  }): Promise<{
    ok: boolean;
    verified?: boolean;
    merkleRoot?: string;
    index?: number;
    proof?: Array<{ siblingHash: string; position: 'left' | 'right' }>;
    error?: string;
  }> {
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/vault/verify-leaf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts),
      });
      return (await res.json()) as {
        ok: boolean;
        verified?: boolean;
        merkleRoot?: string;
        index?: number;
        proof?: Array<{ siblingHash: string; position: 'left' | 'right' }>;
        error?: string;
      };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Verification failed' };
    }
  },

  async decryptVaultSnapshot(
    snapshotId: string,
    passphrase: string,
  ): Promise<{
    ok: boolean;
    merkleRoot?: string;
    bundle?: {
      version: number;
      domain: string | null;
      merkleRoot: string;
      leafCount: number;
      leaves: Array<{ leafType: string; id: string; canonicalPayload: string; leafHash: string }>;
    };
    error?: string;
  }> {
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/vault/decrypt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId, passphrase }),
      });
      return (await res.json()) as {
        ok: boolean;
        merkleRoot?: string;
        bundle?: {
          version: number;
          domain: string | null;
          merkleRoot: string;
          leafCount: number;
          leaves: Array<{ leafType: string; id: string; canonicalPayload: string; leafHash: string }>;
        };
        error?: string;
      };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Decryption failed' };
    }
  },

  async anchorVaultTonTx(opts: {
    snapshotId: string;
    txHash: string;
    verifyOnChain?: boolean;
  }): Promise<{
    ok: boolean;
    explorerUrl?: string | null;
    verificationStatus?: 'verified_on_chain' | 'recorded_unverified' | 'mismatch';
    error?: string;
  }> {
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/memory/vault/anchor-tx`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts),
      });
      return (await res.json()) as {
        ok: boolean;
        explorerUrl?: string | null;
        verificationStatus?: 'verified_on_chain' | 'recorded_unverified' | 'mismatch';
        error?: string;
      };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Anchor bind failed' };
    }
  },
};
