/**
 * MCP Tool Definitions for Unified Agentic Memory (Mem0 + Letta), Bi-Temporal Knowledge Graph (Graphiti),
 * and Verifiable Encrypted Memory Vaults (Anamnesis + OriginTrail DKG).
 *
 * Extracted from `worker/mcpServer.ts` to keep `mcpServer.ts` below the 1,000-line ceiling.
 * No em dashes in copy.
 */
import type { McpToolDef, McpToolResult } from './mcpServer';
import {
  forgetScopedFact,
  queryTemporalTimeline,
  recallUnifiedContext,
  rememberScopedFact,
  upsertTemporalEdge,
  type MemoryFactKind,
} from './unifiedMemoryRouter';
import {
  createMemoryVaultSnapshot,
  verifySnapshotLeaf,
} from './memoryVaultService';

function toTextResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  isError?: boolean,
): McpToolResult {
  const base: McpToolResult = { text };
  if (structuredContent !== undefined) base.structuredContent = structuredContent;
  if (isError) base.isError = true;
  return base;
}

export const AGENTIC_MEMORY_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'memory_remember',
    description:
      'Uses no credits. Stores or supersedes a project-scoped memory fact or bi-temporal entity relationship edge.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        projectId: { type: 'string' },
        domain: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['preference', 'brand_fact', 'decision', 'finding_outcome', 'episode', 'constraint', 'fact'],
        },
        importance: { type: 'number' },
        confidence: { type: 'number' },
        supersedesFactId: { type: 'string' },
        subjectEntity: { type: 'string' },
        predicate: { type: 'string' },
        objectEntity: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const subjectEntity = typeof args.subjectEntity === 'string' ? args.subjectEntity.trim() : '';
      const predicate = typeof args.predicate === 'string' ? args.predicate.trim() : '';
      const objectEntity = typeof args.objectEntity === 'string' ? args.objectEntity.trim() : '';

      if (subjectEntity && predicate && objectEntity) {
        const edgeRes = await upsertTemporalEdge(ctx.env, {
          accountId: ctx.accountId,
          projectId: typeof args.projectId === 'string' ? args.projectId : null,
          domain: typeof args.domain === 'string' ? args.domain : null,
          subjectEntity,
          predicate,
          objectEntity,
          confidence: typeof args.confidence === 'number' ? args.confidence : 0.85,
          derivation: 'user',
          sourceRef: 'mcp',
        });
        if (!edgeRes.ok) return toTextResult(edgeRes.error, undefined, true);
        return toTextResult(
          `Recorded temporal edge ${edgeRes.edge.id}: ${subjectEntity} -> ${edgeRes.edge.predicate} -> ${objectEntity}${
            edgeRes.supersededEdgeId ? ` (superseded ${edgeRes.supersededEdgeId})` : ''
          }`,
          {
            edge: edgeRes.edge,
            deduplicated: edgeRes.deduplicated,
            supersededEdgeId: edgeRes.supersededEdgeId,
          },
        );
      }

      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!text) {
        return toTextResult(
          'Provide either text for a memory fact or (subjectEntity, predicate, objectEntity) for a temporal edge.',
          undefined,
          true,
        );
      }
      const res = await rememberScopedFact(ctx.env, {
        accountId: ctx.accountId,
        text,
        projectId: typeof args.projectId === 'string' ? args.projectId : null,
        domain: typeof args.domain === 'string' ? args.domain : null,
        kind: typeof args.kind === 'string' ? (args.kind as MemoryFactKind) : 'fact',
        importance: typeof args.importance === 'number' ? args.importance : undefined,
        confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
        supersedesFactId: typeof args.supersedesFactId === 'string' ? args.supersedesFactId : null,
        source: 'mcp',
      });
      if (!res.ok) return toTextResult(res.error, { code: res.code }, true);
      return toTextResult(
        `Stored memory ${res.fact.id} [${res.fact.kind}]${res.deduplicated ? ' (deduplicated)' : ''}${
          res.supersededFactId ? ` (superseded ${res.supersededFactId})` : ''
        }`,
        {
          fact: res.fact,
          deduplicated: res.deduplicated,
          supersededFactId: res.supersededFactId,
        },
      );
    },
  },
  {
    name: 'memory_recall',
    description:
      'Uses no credits. Performs symbolic dRAG + hybrid vector/recency/importance recall across project context, findings, temporal edges, and facts.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        projectId: { type: 'string' },
        domain: { type: 'string' },
        topK: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const recalled = await recallUnifiedContext(ctx.env, {
        accountId: ctx.accountId,
        query: typeof args.query === 'string' ? args.query : '',
        projectId: typeof args.projectId === 'string' ? args.projectId : null,
        domain: typeof args.domain === 'string' ? args.domain : null,
        topK: typeof args.topK === 'number' ? args.topK : 8,
      });
      const summary =
        recalled.promptBlock ||
        'No matching project context, temporal edges, or memory facts found.';
      return toTextResult(summary, {
        projectId: recalled.projectId,
        domain: recalled.domain,
        weeklyDecision: recalled.weeklyDecision,
        openFindingsCount: recalled.openFindings.length,
        businessMemoriesCount: recalled.businessMemories.length,
        activeEdgesCount: recalled.activeEdges.length,
        factsCount: recalled.facts.length,
        facts: recalled.facts,
        activeEdges: recalled.activeEdges,
      });
    },
  },
  {
    name: 'memory_forget',
    description:
      'Uses no credits. Soft-deletes a memory fact, removes its vector embedding, and appends a verifiable DELETE entry in memory_history.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        factId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['factId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const factId = typeof args.factId === 'string' ? args.factId.trim() : '';
      if (!factId) return toTextResult('factId required', undefined, true);
      const reason = typeof args.reason === 'string' ? args.reason.trim() : 'mcp_forget';
      const res = await forgetScopedFact(ctx.env, ctx.accountId, factId, reason);
      if (!res.ok) return toTextResult(res.error || 'Memory fact not found', undefined, true);
      return toTextResult(`Deleted memory fact ${factId}.`, { factId, deleted: true });
    },
  },
  {
    name: 'memory_timeline',
    description:
      'Uses no credits. Queries the bi-temporal knowledge graph (valid_from .. valid_to) with optional point-in-time asOfTimestamp.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        domain: { type: 'string' },
        subjectEntity: { type: 'string' },
        predicate: { type: 'string' },
        activeOnly: { type: 'boolean' },
        asOfTimestamp: { type: 'number' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const edges = await queryTemporalTimeline(ctx.env, {
        accountId: ctx.accountId,
        projectId: typeof args.projectId === 'string' ? args.projectId : null,
        domain: typeof args.domain === 'string' ? args.domain : null,
        subjectEntity: typeof args.subjectEntity === 'string' ? args.subjectEntity : null,
        predicate: typeof args.predicate === 'string' ? args.predicate : null,
        activeOnly: Boolean(args.activeOnly),
        asOfTimestamp: typeof args.asOfTimestamp === 'number' ? args.asOfTimestamp : null,
        limit: typeof args.limit === 'number' ? args.limit : 25,
      });
      const lines = edges.length
        ? edges
            .map(
              (e) =>
                `- [${e.id}] ${e.subjectEntity} -> ${e.predicate} -> ${e.objectEntity} (valid ${new Date(
                  e.validFrom,
                )
                  .toISOString()
                  .slice(0, 10)} .. ${
                  e.validTo ? new Date(e.validTo).toISOString().slice(0, 10) : 'present'
                })`,
            )
            .join('\n')
        : 'No temporal edges matched.';
      return toTextResult(lines, { count: edges.length, edges });
    },
  },
  {
    name: 'memory_vault_snapshot',
    description:
      'Uses no credits. Builds a canonical Merkle-rooted memory snapshot, optionally encrypts with AES-256-GCM, and prepares a TON anchor payload.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        domain: { type: 'string' },
        passphrase: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const res = await createMemoryVaultSnapshot(ctx.env, {
        accountId: ctx.accountId,
        projectId: typeof args.projectId === 'string' ? args.projectId : null,
        domain: typeof args.domain === 'string' ? args.domain : null,
        passphrase: typeof args.passphrase === 'string' ? args.passphrase : null,
      });
      if (!res.ok) return toTextResult(res.error, undefined, true);
      return toTextResult(
        [
          `Created Memory Vault Snapshot ${res.snapshotId}`,
          `- Merkle Root: ${res.merkleRoot}`,
          `- Content CID: ${res.cid}`,
          `- Leaves: ${res.leafCount} (Encrypted: ${res.encrypted ? 'yes' : 'no'})`,
          `- TON Memo Draft: ${res.tonAnchorDraft.memo}`,
          `- On-Chain Status: unanchored_draft (submit txHash to /api/memory/vault/anchor-tx to verify on-chain)`,
        ].join('\n'),
        { ...(res as unknown as Record<string, unknown>), onChainStatus: 'unanchored_draft' },
      );
    },
  },
  {
    name: 'memory_vault_verify_leaf',
    description:
      'Uses no credits. Generates and verifies a selective-disclosure Merkle inclusion proof for a single memory leaf hash.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string' },
        leafHash: { type: 'string' },
      },
      required: ['snapshotId', 'leafHash'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const snapshotId = typeof args.snapshotId === 'string' ? args.snapshotId.trim() : '';
      const leafHash = typeof args.leafHash === 'string' ? args.leafHash.trim() : '';
      if (!snapshotId || !leafHash) {
        return toTextResult('snapshotId and leafHash are required', undefined, true);
      }
      const check = await verifySnapshotLeaf(ctx.env, ctx.accountId, snapshotId, leafHash);
      if (!check.ok) return toTextResult(check.error, undefined, true);
      return toTextResult(
        check.verified
          ? `Verified leaf ${leafHash.slice(0, 16)}... in Merkle root ${check.merkleRoot.slice(0, 16)}... (index ${check.index})`
          : `Leaf ${leafHash} is NOT present in snapshot ${snapshotId}`,
        {
          verified: check.verified,
          merkleRoot: check.merkleRoot,
          index: check.index,
          proof: check.proof,
        },
        !check.verified,
      );
    },
  },
];
