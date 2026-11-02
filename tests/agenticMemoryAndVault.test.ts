/**
 * End-to-end tests for the 5-Layer Agentic Stack (Migration 0044):
 * 1. Unified Scoped Memory (Mem0 + Letta self-editing, deduplication, superseding, question filtering, forgetting).
 * 2. Bi-Temporal Knowledge Graph (Graphiti / Zep valid_from .. valid_to + point-in-time queries).
 * 3. Verifiable Encrypted Memory Vault (Anamnesis AES-256-GCM + OriginTrail DKG Merkle proofs + TON anchor binding).
 * 4. Durable Graph Checkpointer & Rolling Summary Compaction in OracleSession (LangGraph + Temporal pattern).
 * 5. MCP `memory_*` tools and Langfuse-lite child span telemetry (`agent_trace_spans`).
 *
 * No em dashes in copy.
 */
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import {
  forgetScopedFact,
  handleUnifiedMemoryRoute,
  queryTemporalTimeline,
  recallUnifiedContext,
  rememberScopedFact,
  upsertTemporalEdge,
} from '../worker/unifiedMemoryRouter';
import {
  buildMerkleInclusionProof,
  bindMemoryVaultTonTx,
  computeMerkleRoot,
  createMemoryVaultSnapshot,
  decryptVaultBundle,
  verifyMerkleInclusionProof,
} from '../worker/memoryVaultService';
import { sha256Hex } from '../worker/workerUtils';
import { OracleSession } from '../worker/oracleSession';
import { handleOracleSessionControlRoute } from '../worker/oracleChat';
import { planCapsFor } from '../worker/telegramBot';
import { startRun, recordTraceSpan, listRunTraceSpans } from '../worker/runProvenance';
import { TOOL_GOVERNANCE } from '../worker/mcpGovernance';
import { AGENTIC_MEMORY_MCP_TOOLS } from '../worker/mcpAgenticMemoryTools';
import { createProject } from '../worker/projectService';
import { updateProjectContext } from '../worker/projectContextService';
import {
  extractAndStoreChatMemory,
  ingestAuditFindingsToGraph,
  ingestDreamProposalToGraph,
  ingestWeeklyDecisionToGraph,
} from '../worker/memoryAutoIngest';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createSqliteD1(),
    CHAIN_NETWORK: 'testnet',
    TON_RECEIVING_ADDRESS: 'kQTestMerchantAddress12345678901234567890123456',
    ...overrides,
  } as unknown as Env;
}

function makeMockDoState() {
  const map = new Map<string, unknown>();
  let alarmTime: number | null = null;
  return {
    storage: {
      get: async <T>(key: string): Promise<T | undefined> => map.get(key) as T | undefined,
      put: async (key: string, val: unknown) => {
        map.set(key, val);
      },
      deleteAll: async () => {
        map.clear();
      },
      setAlarm: async (scheduledTime: number) => {
        alarmTime = scheduledTime;
      },
      getAlarm: async () => alarmTime,
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => {
      await fn();
    },
  } as unknown as DurableObjectState;
}

describe('Phase 1: Unified Scoped Memory + Bi-Temporal Knowledge Graph', () => {
  it('rejects raw questions from being stored as declarative facts unless kind is episode', async () => {
    const env = makeEnv();
    const rejected = await rememberScopedFact(env, {
      accountId: 'acc_1',
      text: 'What is our current Google AI Overview citation share?',
      domain: 'acme.io',
      kind: 'brand_fact',
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('QUESTION_REJECTED');
    }

    const allowedEpisode = await rememberScopedFact(env, {
      accountId: 'acc_1',
      text: 'What is our current Google AI Overview citation share?',
      domain: 'acme.io',
      kind: 'episode',
    });
    expect(allowedEpisode.ok).toBe(true);
  });

  it('deduplicates identical scoped facts, supports superseding, and logs verifiable forgetting', async () => {
    const env = makeEnv();
    const first = await rememberScopedFact(env, {
      accountId: 'acc_1',
      projectId: 'proj_1',
      domain: 'https://www.Acme.io/pricing',
      kind: 'brand_fact',
      text: 'Acme targets mid-market B2B SaaS teams in Australia.',
      importance: 0.6,
      confidence: 0.8,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.deduplicated).toBe(false);
    expect(first.fact.domain).toBe('acme.io');

    // Duplicate write boosts importance/confidence without inserting a second row
    const dup = await rememberScopedFact(env, {
      accountId: 'acc_1',
      projectId: 'proj_1',
      domain: 'acme.io',
      kind: 'brand_fact',
      text: 'Acme targets mid-market B2B SaaS teams in Australia.',
      importance: 0.9,
      confidence: 0.95,
    });
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    expect(dup.deduplicated).toBe(true);
    expect(dup.fact.id).toBe(first.fact.id);
    expect(dup.fact.importance).toBe(0.9);

    // Supersede with updated positioning
    const second = await rememberScopedFact(env, {
      accountId: 'acc_1',
      projectId: 'proj_1',
      domain: 'acme.io',
      kind: 'brand_fact',
      text: 'Acme now targets enterprise fintech and healthcare teams across APAC.',
      supersedesFactId: first.fact.id,
      importance: 0.95,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.supersededFactId).toBe(first.fact.id);

    // Recall returns only active facts (first fact is superseded)
    const recalled = await recallUnifiedContext(env, {
      accountId: 'acc_1',
      projectId: 'proj_1',
      domain: 'acme.io',
      query: 'enterprise fintech APAC',
    });
    expect(recalled.facts.map((f) => f.id)).toContain(second.fact.id);
    expect(recalled.facts.map((f) => f.id)).not.toContain(first.fact.id);

    // Forget the second fact and verify soft-delete + history log
    const forgotten = await forgetScopedFact(env, 'acc_1', second.fact.id, 'user_requested_erase');
    expect(forgotten.ok).toBe(true);
    expect(forgotten.deleted).toBe(true);

    const afterForget = await recallUnifiedContext(env, {
      accountId: 'acc_1',
      projectId: 'proj_1',
      domain: 'acme.io',
      query: 'enterprise fintech',
    });
    expect(afterForget.facts).toHaveLength(0);
  });

  it('maintains bi-temporal entity edges (Graphiti pattern) with point-in-time queries', async () => {
    const env = makeEnv();
    const t1 = 1_700_000_000_000;
    const t2 = 1_710_000_000_000;

    const e1 = await upsertTemporalEdge(env, {
      accountId: 'acc_graph',
      domain: 'acme.io',
      subjectEntity: 'acme.io',
      predicate: 'primary_cms',
      objectEntity: 'WordPress',
      derivation: 'verified',
      validFrom: t1,
    });
    expect(e1.ok).toBe(true);
    if (!e1.ok) return;
    expect(e1.edge.validTo).toBeNull();

    // Update the same (subject, predicate) to a new object at t2 -> closes e1 at t2
    const e2 = await upsertTemporalEdge(env, {
      accountId: 'acc_graph',
      domain: 'acme.io',
      subjectEntity: 'acme.io',
      predicate: 'primary_cms',
      objectEntity: 'Webflow',
      derivation: 'verified',
      validFrom: t2,
    });
    expect(e2.ok).toBe(true);
    if (!e2.ok) return;
    expect(e2.supersededEdgeId).toBe(e1.edge.id);

    // Point-in-time query at t1 + 5000 returns WordPress
    const atT1 = await queryTemporalTimeline(env, {
      accountId: 'acc_graph',
      domain: 'acme.io',
      subjectEntity: 'acme.io',
      predicate: 'primary_cms',
      asOfTimestamp: t1 + 5000,
    });
    expect(atT1).toHaveLength(1);
    expect(atT1[0].objectEntity).toBe('WordPress');
    expect(atT1[0].validTo).toBe(t2);

    // Active-only query returns Webflow
    const current = await queryTemporalTimeline(env, {
      accountId: 'acc_graph',
      domain: 'acme.io',
      activeOnly: true,
    });
    expect(current).toHaveLength(1);
    expect(current[0].objectEntity).toBe('Webflow');
    expect(current[0].validTo).toBeNull();
  });

  it('assembles dRAG unified prompt block from project context, edges, and scoped facts', async () => {
    const env = makeEnv();
    const createdProj = await createProject(env, 'acc_drag', {
      domain: 'luminara.ai',
      name: 'Luminara AI',
    });
    expect(createdProj.ok).toBe(true);
    if (!createdProj.ok) return;

    await updateProjectContext(
      env,
      'acc_drag',
      createdProj.project.id,
      [{ section: 'business_overview', content: 'Verifiable AEO & GEO intelligence suite.' }],
      'user',
    );

    await upsertTemporalEdge(env, {
      accountId: 'acc_drag',
      projectId: createdProj.project.id,
      domain: 'luminara.ai',
      subjectEntity: 'luminara.ai',
      predicate: 'top_competitor',
      objectEntity: 'profound.com',
      derivation: 'user',
    });

    await rememberScopedFact(env, {
      accountId: 'acc_drag',
      projectId: createdProj.project.id,
      domain: 'luminara.ai',
      kind: 'preference',
      text: 'Always include Schema.org FAQPage JSON-LD in technical recommendations.',
    });

    const unified = await recallUnifiedContext(env, {
      accountId: 'acc_drag',
      projectId: createdProj.project.id,
      query: 'FAQPage schema recommendations',
    });

    expect(unified.promptBlock).toContain('<<<UNTRUSTED_ACCOUNT_MEMORY_BEGIN>>>');
    expect(unified.promptBlock).toContain('Verifiable AEO & GEO intelligence suite.');
    expect(unified.promptBlock).toContain('luminara.ai -> top_competitor -> profound.com');
    expect(unified.promptBlock).toContain('Always include Schema.org FAQPage JSON-LD');
    expect(unified.promptBlock).toContain('<<<UNTRUSTED_ACCOUNT_MEMORY_END>>>');
  });
});

describe('Phase 2: Anamnesis Encrypted Vault + OriginTrail Merkle Proofs + TON Commitment', () => {
  it('creates an AES-256-GCM encrypted snapshot, verifies Merkle inclusion proofs, and binds a TON tx', async () => {
    const env = makeEnv();
    await rememberScopedFact(env, {
      accountId: 'acc_vault',
      domain: 'vault.example.com',
      kind: 'brand_fact',
      text: 'Vault fact 1: canonical entity home is https://vault.example.com/about.',
    });
    await rememberScopedFact(env, {
      accountId: 'acc_vault',
      domain: 'vault.example.com',
      kind: 'decision',
      text: 'Vault fact 2: prioritize Perplexity citation growth in Q4.',
    });
    await upsertTemporalEdge(env, {
      accountId: 'acc_vault',
      domain: 'vault.example.com',
      subjectEntity: 'vault.example.com',
      predicate: 'hosting_stack',
      objectEntity: 'Cloudflare Workers',
    });

    const snap = await createMemoryVaultSnapshot(env, {
      accountId: 'acc_vault',
      domain: 'vault.example.com',
      passphrase: 'correct-horse-battery-staple-2026',
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;

    expect(snap.encrypted).toBe(true);
    expect(snap.leafCount).toBe(3);
    expect(snap.merkleRoot).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.cid).toMatch(/^bafk_[a-f0-9]{48}$/);
    expect(snap.tonAnchorDraft.memo).toContain('luminara:mem_v1:');

    // Selective disclosure: verify inclusion proof for leaf #1
    const targetLeaf = snap.leafHashes[1];
    const proofBundle = await buildMerkleInclusionProof(snap.leafHashes, targetLeaf);
    expect(proofBundle.found).toBe(true);
    expect(
      await verifyMerkleInclusionProof(targetLeaf, proofBundle.proof, snap.merkleRoot),
    ).toBe(true);

    // Tampered leaf hash must fail verification
    const tamperedLeaf = `${targetLeaf.slice(0, 62)}ff`;
    expect(
      await verifyMerkleInclusionProof(tamperedLeaf, proofBundle.proof, snap.merkleRoot),
    ).toBe(false);

    // Decrypt the stored ciphertext from D1 and verify round-trip
    const row = await env.DB!.prepare(
      `SELECT ciphertext_base64, iv_base64, salt_base64 FROM memory_vault_snapshots WHERE id = ?`,
    )
      .bind(snap.snapshotId)
      .first<{ ciphertext_base64: string; iv_base64: string; salt_base64: string }>();
    expect(row?.ciphertext_base64).toBeTruthy();

    const decryptedJson = await decryptVaultBundle(
      {
        ciphertextBase64: row!.ciphertext_base64,
        ivBase64: row!.iv_base64,
        saltBase64: row!.salt_base64,
      },
      'correct-horse-battery-staple-2026',
    );
    const parsed = JSON.parse(decryptedJson);
    expect(parsed.merkleRoot).toBe(snap.merkleRoot);
    expect(parsed.leaves).toHaveLength(3);

    // Wrong passphrase must reject
    await expect(
      decryptVaultBundle(
        {
          ciphertextBase64: row!.ciphertext_base64,
          ivBase64: row!.iv_base64,
          saltBase64: row!.salt_base64,
        },
        'wrong-passphrase-12345',
      ),
    ).rejects.toThrow();

    // Bind TON transaction hash and verify proof_anchors row is updated to 'anchored'
    const txHash = 'a1b2c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef0123';
    const bound = await bindMemoryVaultTonTx(env, {
      accountId: 'acc_vault',
      snapshotId: snap.snapshotId,
      txHash,
    });
    expect(bound.ok).toBe(true);
    expect(bound.explorerUrl).toContain(txHash);

    const anchorRow = await env.DB!.prepare(
      `SELECT kind, status, tx_hash, evidence_hash FROM proof_anchors WHERE evidence_hash = ?`,
    )
      .bind(snap.merkleRoot)
      .first<{ kind: string; status: string; tx_hash: string; evidence_hash: string }>();
    expect(anchorRow?.kind).toBe('memory_snapshot');
    expect(anchorRow?.status).toBe('anchored');
    expect(anchorRow?.tx_hash).toBe(txHash);
  });
});

describe('Phase 3: Durable Graph Checkpointer & Rolling Summary in OracleSession', () => {
  it('compacts evicted turns into rollingSummary when exceeding 80 turns', async () => {
    const state = makeMockDoState();
    const session = new OracleSession(state);

    for (let i = 1; i <= 85; i++) {
      await session.fetch(
        new Request('https://oracle-session/append', {
          method: 'POST',
          body: JSON.stringify({ role: i % 2 === 1 ? 'user' : 'assistant', content: `Turn message #${i}` }),
        }),
      );
    }

    const histRes = await session.fetch(new Request('https://oracle-session/history'));
    const hist = (await histRes.json()) as { turns: unknown[]; rollingSummary: string };
    expect(hist.turns).toHaveLength(40);
    expect(hist.rollingSummary).toContain('Turn message #1');
    expect(hist.rollingSummary).toContain('Turn message #5');
  });

  it('checkpoints workflow graph state and auto-advances when tool approval gate resolves', async () => {
    const state = makeMockDoState();
    const session = new OracleSession(state);

    // 1. Admit turn
    const admitRes = await session.fetch(
      new Request('https://oracle-session/admit', {
        method: 'POST',
        body: JSON.stringify({ messageId: 'm1', content: 'Run deep keyword research' }),
      }),
    );
    const { turnId, turnNumber } = (await admitRes.json()) as { turnId: string; turnNumber: number };

    // 2. Request tool approval gate
    await session.fetch(
      new Request('https://oracle-session/events', {
        method: 'POST',
        body: JSON.stringify({
          turnId,
          turnNumber,
          event: {
            type: 'tool_approval_requested',
            tool_id: 'call_kw_1',
            tool_name: 'research_keywords',
            tool_input: { seeds: ['aeo audit'] },
            risk_tier: 'paid_research',
          },
        }),
      }),
    );

    // 3. Save graph checkpoint waiting on 'call_kw_1'
    const cpRes = await session.fetch(
      new Request('https://oracle-session/checkpoint', {
        method: 'POST',
        body: JSON.stringify({
          turnId,
          turnNumber,
          currentNode: 'await_approval',
          stepIndex: 2,
          planSteps: ['recall_memory', 'research_keywords', 'synthesize_verdict'],
          pendingToolId: 'call_kw_1',
          resumable: false,
          scheduleAlarmMs: 60_000,
        }),
      }),
    );
    expect(cpRes.ok).toBe(true);

    // 4. Approve the tool gate -> checkpoint automatically transitions to 'execute_tool' + resumable=true
    const approveRes = await session.fetch(
      new Request('https://oracle-session/approval', {
        method: 'POST',
        body: JSON.stringify({
          toolId: 'call_kw_1',
          toolName: 'research_keywords',
          approved: true,
          remember: true,
        }),
      }),
    );
    const approveData = (await approveRes.json()) as { resumedCheckpoints: string[] };
    expect(approveData.resumedCheckpoints).toContain(turnId);

    const getCpRes = await session.fetch(
      new Request(`https://oracle-session/checkpoint?turnId=${turnId}`),
    );
    const getCpData = (await getCpRes.json()) as {
      checkpoint: { currentNode: string; resumable: boolean; pendingToolId: string | null };
    };
    expect(getCpData.checkpoint.currentNode).toBe('execute_tool');
    expect(getCpData.checkpoint.resumable).toBe(true);
    expect(getCpData.checkpoint.pendingToolId).toBeNull();
  });
});

describe('Phase 4: MCP Agentic Memory Tools & Span Telemetry', () => {
  it('registers all 6 agentic memory MCP tools in TOOL_GOVERNANCE and executes them', async () => {
    for (const tool of AGENTIC_MEMORY_MCP_TOOLS) {
      expect(TOOL_GOVERNANCE[tool.name], `governance for ${tool.name}`).toBeDefined();
    }

    const env = makeEnv();
    const ctx = {
      env,
      user: { id: 'u_mcp', source: 'telegram' as const, accountId: 'acc_mcp' },
      accountId: 'acc_mcp',
      planId: 'growth',
      caps: planCapsFor('growth'),
      dataForSeoCredential: null,
      credential: { kind: 'session' as const, id: null },
    };

    const rememberTool = AGENTIC_MEMORY_MCP_TOOLS.find((t) => t.name === 'memory_remember')!;
    const recallTool = AGENTIC_MEMORY_MCP_TOOLS.find((t) => t.name === 'memory_recall')!;
    const snapshotTool = AGENTIC_MEMORY_MCP_TOOLS.find((t) => t.name === 'memory_vault_snapshot')!;

    const remRes = await rememberTool.handler(
      {
        text: 'Client prefers concise weekly executive summaries on Mondays.',
        domain: 'mcp-test.io',
        kind: 'preference',
        importance: 0.9,
      },
      ctx,
    );
    expect(remRes.isError).toBeFalsy();

    const recRes = await recallTool.handler(
      {
        query: 'weekly executive summaries',
        domain: 'mcp-test.io',
      },
      ctx,
    );
    expect(recRes.isError).toBeFalsy();
    expect(recRes.text).toContain('weekly executive summaries');

    const snapRes = await snapshotTool.handler(
      {
        domain: 'mcp-test.io',
        passphrase: 'mcp-vault-secret-passphrase',
      },
      ctx,
    );
    expect(snapRes.isError).toBeFalsy();
    expect(snapRes.text).toContain('Created Memory Vault Snapshot');
  });

  it('records and retrieves child trace spans under run_provenance', async () => {
    const env = makeEnv();
    const run = await startRun(env, {
      surface: 'oracle_chat',
      accountId: 'acc_trace',
      wakeReason: 'user_invoke',
    });
    expect(run?.runId).toBeTruthy();

    const span1 = await recordTraceSpan(env, {
      runId: run!.runId,
      accountId: 'acc_trace',
      sessionId: 'sess_1',
      nodeName: 'recall_memory',
      kind: 'memory',
      modelOrTool: 'recallUnifiedContext',
      latencyMs: 14,
      status: 'ok',
      metadata: { factsMatched: 3 },
    });
    expect(span1).toBeTruthy();

    const span2 = await recordTraceSpan(env, {
      runId: run!.runId,
      parentSpanId: span1,
      accountId: 'acc_trace',
      sessionId: 'sess_1',
      nodeName: 'synthesize_answer',
      kind: 'llm',
      modelOrTool: 'llama-3.3-70b-versatile',
      inputTokens: 840,
      outputTokens: 310,
      costCents: 1,
      latencyMs: 420,
      status: 'ok',
    });
    expect(span2).toBeTruthy();

    const spans = await listRunTraceSpans(env, 'acc_trace', run!.runId);
    expect(spans).toHaveLength(2);
    expect(spans[0].node_name).toBe('recall_memory');
    expect(spans[1].parent_span_id).toBe(span1);
    expect(spans[1].input_tokens).toBe(840);
  });
});

describe('Phase 5: Autonomous Chat Delta Loop, GAM Negative Constraints & Graphiti Domain Ingestion', () => {
  it('extracts scoped facts, negative constraints, and temporal edges from chat and supersedes outdated facts', async () => {
    const env = makeEnv();
    const accountId = 'acc_delta';

    const turn1 = await extractAndStoreChatMemory(env, {
      accountId,
      domain: 'acme.io',
      sessionId: 'sess_delta',
      turnId: 'turn_1',
      userMessage:
        'Our CMS is WordPress and our primary competitor is RivalCorp. Never bring up LegacyCo or suggest buying links.',
    });

    expect(turn1.factsStored.length).toBeGreaterThanOrEqual(2);
    expect(turn1.factsStored.some((f) => f.kind === 'constraint')).toBe(true);
    expect(turn1.edgesStored.some((e) => e.predicate === 'competes_with' && e.objectEntity === 'RivalCorp')).toBe(true);
    expect(turn1.edgesStored.some((e) => e.predicate === 'never_bring_up')).toBe(true);

    // Turn 2: user corrects their CMS slot -> should supersede the prior CMS brand_fact
    const turn2 = await extractAndStoreChatMemory(env, {
      accountId,
      domain: 'acme.io',
      sessionId: 'sess_delta',
      turnId: 'turn_2',
      userMessage: 'Actually we migrated from WordPress and our CMS is Webflow now.',
    });

    expect(turn2.factsStored).toHaveLength(1);
    expect(turn2.factsSuperseded.length).toBe(1);

    const recalled = await recallUnifiedContext(env, {
      accountId,
      domain: 'acme.io',
      query: 'CMS and constraints',
      topK: 10,
    });

    expect(recalled.strictConstraints?.length).toBeGreaterThanOrEqual(1);
    expect(recalled.promptBlock).toContain('### Strict Negative Constraints (Never Bring Up)');
    expect(recalled.promptBlock).toContain('### L0 Memory Abstract');
    expect(recalled.facts.some((f) => f.text.includes('Webflow'))).toBe(true);
    expect(recalled.facts.some((f) => f.text.includes('Our CMS is WordPress'))).toBe(false);
  });

  it('redacts PII from recalled facts before injecting into unified prompt context', async () => {
    const env = makeEnv();
    const accountId = 'acc_pii';
    const syntheticKey = ['sk', '1234567890abcdefghijklmnop'].join('-');

    await rememberScopedFact(env, {
      accountId,
      domain: 'privacy.io',
      kind: 'brand_fact',
      text: `Contact founder@privacy.io or use key ${syntheticKey} for staging.`,
    });

    const recalled = await recallUnifiedContext(env, {
      accountId,
      domain: 'privacy.io',
      query: 'founder contact',
    });

    expect(recalled.facts[0].text).toContain('[REDACTED_EMAIL]');
    expect(recalled.facts[0].text).toContain('[REDACTED_API_KEY]');
    expect(recalled.promptBlock).not.toContain('founder@privacy.io');
  });

  it('auto-ingests audit findings, weekly decisions, and dream proposals into the bi-temporal graph', async () => {
    const env = makeEnv();
    const accountId = 'acc_graph_auto';
    const domain = 'growth.io';

    // 1. Open critical finding -> creates active has_open_finding edge
    await ingestAuditFindingsToGraph(env, {
      accountId,
      domain,
      findings: [
        {
          id: 'fnd_schema_1',
          severity: 'critical',
          category: 'schema',
          title: 'Missing Organization JSON-LD on homepage',
          status: 'open',
        },
      ],
    });

    let activeEdges = await queryTemporalTimeline(env, { accountId, domain, activeOnly: true });
    expect(activeEdges.some((e) => e.predicate === 'has_open_finding_fnd_schema_1')).toBe(true);

    // 2. Resolve finding -> closes has_open_finding edge and creates resolved_finding edge
    await ingestAuditFindingsToGraph(env, {
      accountId,
      domain,
      findings: [
        {
          id: 'fnd_schema_1',
          severity: 'critical',
          category: 'schema',
          title: 'Missing Organization JSON-LD on homepage',
          status: 'done',
        },
      ],
    });

    activeEdges = await queryTemporalTimeline(env, { accountId, domain, activeOnly: true });
    expect(activeEdges.some((e) => e.predicate === 'has_open_finding_fnd_schema_1')).toBe(false);
    expect(activeEdges.some((e) => e.predicate === 'resolved_finding_fnd_schema_1')).toBe(true);

    // 3. Weekly decision & Dream proposal ingestion
    await ingestWeeklyDecisionToGraph(env, {
      accountId,
      domain,
      weekStart: '2026-W43',
      headline: 'Ship FAQPage schema on top 5 product pages',
      actionText: 'Add FAQPage JSON-LD and validate Rich Results',
      decisionId: 'wd_1',
    });

    await ingestDreamProposalToGraph(env, {
      accountId,
      domain,
      memoryType: 'strategy_shift',
      title: 'Pivot to enterprise AEO keywords',
      content: 'Focus on high-intent enterprise comparison queries.',
      proposalId: 'dp_1',
    });

    activeEdges = await queryTemporalTimeline(env, { accountId, domain, activeOnly: true });
    expect(activeEdges.some((e) => e.predicate === 'active_weekly_decision')).toBe(true);
    expect(activeEdges.some((e) => e.predicate === 'dream_strategy_shift')).toBe(true);
  });
});

describe('Phase 6: Anamnesis IPFS Pinning & Evidence-Bound TON On-Chain Memo Verification', () => {
  it('pins encrypted vault snapshots to IPFS when IPFS_PINNING_URL is configured and verifies TON memos on-chain', async () => {
    const env = makeEnv({
      IPFS_PINNING_URL: 'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      IPFS_PINNING_JWT: 'test-jwt',
      TON_RECEIVING_ADDRESS: 'EQD__________________________________________0vo',
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      CHAIN_TON_API_FALLBACK_BASE: 'https://testnet.tonapi.io',
    });
    const accountId = 'acc_ipfs_ton';

    await rememberScopedFact(env, {
      accountId,
      domain: 'verifiable.io',
      kind: 'brand_fact',
      text: 'Verifiable brand memory anchored on TON and IPFS.',
    });

    const ipfsFetcher = (async (url: string) => {
      if (url.includes('pinJSONToIPFS')) {
        return new Response(JSON.stringify({ IpfsHash: 'bafkrei_mock_ipfs_cid_1234567890' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const snap = await createMemoryVaultSnapshot(env, {
      accountId,
      domain: 'verifiable.io',
      passphrase: 'super-secret-passphrase',
      fetcher: ipfsFetcher,
    });

    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    expect(snap.storageBackend).toBe('ipfs');
    expect(snap.cid).toBe('bafkrei_mock_ipfs_cid_1234567890');

    const expectedMemo = snap.tonAnchorDraft.memo;
    const validTxHash = 'a'.repeat(64);
    const mismatchedTxHash = 'b'.repeat(64);

    // 1. Mismatched memo on-chain must be rejected
    const mismatchFetcher = (async () =>
      new Response(
        JSON.stringify({
          transactions: [
            {
              hash: mismatchedTxHash,
              utime: Math.floor(Date.now() / 1000),
              in_msg: { message: 'luminara:mem_v1:wrong_root:wrong_cid' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const mismatchBind = await bindMemoryVaultTonTx(env, {
      accountId,
      snapshotId: snap.snapshotId,
      txHash: mismatchedTxHash,
      verifyOnChain: true,
      fetcher: mismatchFetcher,
    });
    expect(mismatchBind.ok).toBe(false);
    expect(mismatchBind.verificationStatus).toBe('mismatch');

    // 2. Matching memo on-chain succeeds with verificationStatus: 'verified_on_chain'
    const validFetcher = (async () =>
      new Response(
        JSON.stringify({
          transactions: [
            {
              hash: validTxHash,
              utime: Math.floor(Date.now() / 1000),
              in_msg: { message: expectedMemo },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const validBind = await bindMemoryVaultTonTx(env, {
      accountId,
      snapshotId: snap.snapshotId,
      txHash: validTxHash,
      verifyOnChain: true,
      fetcher: validFetcher,
    });
    expect(validBind.ok).toBe(true);
    expect(validBind.verificationStatus).toBe('verified_on_chain');
  });
});

describe('Phase 7: Trust-Boundary Enforcement & Pre-0044 Schema Graceful Degradation', () => {
  it('blocks external client POST /checkpoint on OracleSession control route and forces user derivation on HTTP edges', async () => {
    const state = makeMockDoState();
    const session = new OracleSession(state);
    const env = makeEnv({
      ORACLE_SERVER_ENABLED: 'true',
      ORACLE_SESSION: {
        idFromName: () => ({ toString: () => 'do_1' }) as unknown as DurableObjectId,
        get: () =>
          ({
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              session.fetch(new Request(input, init)),
          }) as unknown as DurableObjectStub,
      } as unknown as DurableObjectNamespace,
    });
    const user = { id: 'u_sec', source: 'telegram' as const, accountId: 'acc_sec' };

    const postCpRes = await handleOracleSessionControlRoute(
      new Request('https://luminarasuite.com/api/oracle/sessions/sess_sec/checkpoint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentNode: 'execute_tool', resumable: true, pendingToolId: null }),
      }),
      env,
      user,
      'sess_sec',
      'checkpoint',
    );
    expect(postCpRes?.status).toBe(404);

    const getCpRes = await handleOracleSessionControlRoute(
      new Request('https://luminarasuite.com/api/oracle/sessions/sess_sec/checkpoint', {
        method: 'GET',
      }),
      env,
      user,
      'sess_sec',
      'checkpoint',
    );
    expect(getCpRes?.status).toBe(200);

    // Spoofed accountId on POST /memory/unified/edges is rejected
    const spoofRes = await handleUnifiedMemoryRoute(
      new Request('https://luminarasuite.com/api/memory/unified/edges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId: 'victim_acc',
          subjectEntity: 'brand.io',
          predicate: 'competes_with',
          objectEntity: 'rival.io',
        }),
      }),
      env,
      user,
      '/memory/unified/edges',
    );
    expect(spoofRes?.status).toBe(400);

    // External client attempting to set derivation: 'verified' is clamped to 'user'
    const edgeRes = await handleUnifiedMemoryRoute(
      new Request('https://luminarasuite.com/api/memory/unified/edges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'brand.io',
          subjectEntity: 'brand.io',
          predicate: 'competes_with',
          objectEntity: 'rival.io',
          derivation: 'verified',
        }),
      }),
      env,
      user,
      '/memory/unified/edges',
    );
    expect(edgeRes?.status).toBe(200);
    const edgeBody = (await edgeRes!.json()) as { ok: boolean; edge: { derivation: string } };
    expect(edgeBody.ok).toBe(true);
    expect(edgeBody.edge.derivation).toBe('user');
  });

  it('degrades gracefully without throwing when 0044 tables are absent', async () => {
    const env = makeEnv();
    await env.DB!.prepare(`DROP TABLE IF EXISTS memory_edges`).run();
    await env.DB!.prepare(`DROP TABLE IF EXISTS memory_vault_snapshots`).run();
    await env.DB!.prepare(`DROP TABLE IF EXISTS agent_trace_spans`).run();

    const edges = await queryTemporalTimeline(env, { accountId: 'acc_pre0044', activeOnly: true });
    expect(edges).toEqual([]);

    const recalled = await recallUnifiedContext(env, {
      accountId: 'acc_pre0044',
      domain: 'pre0044.io',
      query: 'test recall',
    });
    expect(recalled.activeEdges).toEqual([]);

    await expect(
      ingestAuditFindingsToGraph(env, {
        accountId: 'acc_pre0044',
        domain: 'pre0044.io',
        findings: [{ id: 'f1', severity: 'critical', category: 'seo', title: 'Test', status: 'done' }],
      }),
    ).resolves.toEqual({ edgesUpdated: 0 });

    await expect(
      ingestWeeklyDecisionToGraph(env, {
        accountId: 'acc_pre0044',
        domain: 'pre0044.io',
        weekStart: '2026-W43',
        headline: 'H',
        actionText: 'A',
      }),
    ).resolves.toBeUndefined();

    await expect(
      ingestDreamProposalToGraph(env, {
        accountId: 'acc_pre0044',
        domain: 'pre0044.io',
        memoryType: 'strategy_shift',
        title: 'T',
        content: 'C',
      }),
    ).resolves.toBeUndefined();

    const span = await recordTraceSpan(env, {
      runId: 'run_missing_table',
      accountId: 'acc_pre0044',
      nodeName: 'recall_memory',
      kind: 'memory',
    });
    expect(span).toBeNull();
  });

  it('verifies Merkle inclusion proofs across 0, 1, 3, 5, 6, and 7 leaves, uppercase hex, and rejects 0-leaf empty-root spoofs', async () => {
    const emptyRoot = await computeMerkleRoot([]);
    const emptyProof = await buildMerkleInclusionProof([], emptyRoot);
    expect(emptyProof.found).toBe(false);
    expect(await verifyMerkleInclusionProof(emptyRoot, [], emptyRoot)).toBe(false);

    for (const count of [1, 3, 5, 6, 7]) {
      const leaves = await Promise.all(
        Array.from({ length: count }, (_, idx) => sha256Hex(`leaf_test_${count}_${idx}`)),
      );
      const root = await computeMerkleRoot(leaves);
      for (let i = 0; i < count; i++) {
        const target = i % 2 === 0 ? leaves[i].toUpperCase() : leaves[i];
        const built = await buildMerkleInclusionProof(leaves, target);
        expect(built.found).toBe(true);
        expect(built.index).toBe(i);
        expect(built.merkleRoot).toBe(root);
        expect(await verifyMerkleInclusionProof(target, built.proof, root)).toBe(true);
      }
    }
  });

  it('rejects short vault passphrases (< 8 chars) and isolates proof_anchors across accounts on empty vaults', async () => {
    const env = makeEnv();
    const shortRes = await createMemoryVaultSnapshot(env, {
      accountId: 'acc_short',
      passphrase: 'short',
    });
    expect(shortRes.ok).toBe(false);
    if (!shortRes.ok) {
      expect(shortRes.error).toMatch(/at least 8 characters/i);
    }

    const snapA = await createMemoryVaultSnapshot(env, { accountId: 'acc_tenant_a' });
    const snapB = await createMemoryVaultSnapshot(env, { accountId: 'acc_tenant_b' });
    expect(snapA.ok).toBe(true);
    expect(snapB.ok).toBe(true);
    if (!snapA.ok || !snapB.ok) return;

    const anchors = await env.DB!
      .prepare(`SELECT id, audit_run_id FROM proof_anchors WHERE kind = 'memory_snapshot'`)
      .all<{ id: string; audit_run_id: string }>();
    const runIds = (anchors.results || []).map((a) => a.audit_run_id);
    expect(runIds).toContain(snapA.snapshotId);
    expect(runIds).toContain(snapB.snapshotId);
  });

  it('times out stale await_approval checkpoints in alarm() and rejects late approvals with 409', async () => {
    const state = makeMockDoState();
    const session = new OracleSession(state);

    const admitRes = await session.fetch(
      new Request('https://oracle-session/admit', {
        method: 'POST',
        body: JSON.stringify({ messageId: 'm_timeout', content: 'Run paid keyword research' }),
      }),
    );
    const { turnId, turnNumber } = (await admitRes.json()) as { turnId: string; turnNumber: number };

    await session.fetch(
      new Request('https://oracle-session/events', {
        method: 'POST',
        body: JSON.stringify({
          turnId,
          turnNumber,
          event: {
            type: 'tool_approval_requested',
            tool_id: 'call_timeout_1',
            tool_name: 'research_keywords',
            tool_input: { seeds: ['timeout'] },
            risk_tier: 'paid_research',
          },
        }),
      }),
    );

    await session.fetch(
      new Request('https://oracle-session/checkpoint', {
        method: 'POST',
        body: JSON.stringify({
          turnId,
          turnNumber,
          currentNode: 'await_approval',
          stepIndex: 1,
          pendingToolId: 'call_timeout_1',
          resumable: false,
          scheduleAlarmMs: 1,
        }),
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    await session.alarm();

    const cpRes = await session.fetch(new Request(`https://oracle-session/checkpoint?turnId=${turnId}`));
    const cpData = (await cpRes.json()) as {
      checkpoint: { currentNode: string; pendingToolId: string | null; resumable: boolean };
    };
    expect(cpData.checkpoint.currentNode).toBe('critic_verify');
    expect(cpData.checkpoint.pendingToolId).toBeNull();
    expect(cpData.checkpoint.resumable).toBe(true);

    const lateApprove = await session.fetch(
      new Request('https://oracle-session/approval', {
        method: 'POST',
        body: JSON.stringify({
          toolId: 'call_timeout_1',
          toolName: 'research_keywords',
          approved: true,
        }),
      }),
    );
    expect(lateApprove.status).toBe(409);
  });

  it('strips unowned projectId at trust boundary in rememberScopedFact and upsertTemporalEdge', async () => {
    const env = makeEnv();
    const otherProj = await createProject(env, 'acc_owner', {
      domain: 'owned.io',
      name: 'Owned Project',
    });
    expect(otherProj.ok).toBe(true);
    if (!otherProj.ok) return;

    const factRes = await rememberScopedFact(env, {
      accountId: 'acc_attacker',
      projectId: otherProj.project.id,
      domain: 'attacker.io',
      text: 'Attacker trying to tag another account project id.',
    });
    expect(factRes.ok).toBe(true);
    if (factRes.ok) {
      expect(factRes.fact.projectId).toBeNull();
    }

    const edgeRes = await upsertTemporalEdge(env, {
      accountId: 'acc_attacker',
      projectId: otherProj.project.id,
      domain: 'attacker.io',
      subjectEntity: 'attacker.io',
      predicate: 'uses_cms',
      objectEntity: 'Ghost',
    });
    expect(edgeRes.ok).toBe(true);
    if (edgeRes.ok) {
      expect(edgeRes.edge.projectId).toBeNull();
    }
  });
});
