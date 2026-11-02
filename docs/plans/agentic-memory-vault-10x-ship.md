# Agentic Memory, Bi-Temporal Knowledge Graph & Verifiable On-Chain Vault (AMV0-AMV5)

## Purpose

Deliver Luminara-native, production-grade agentic memory and verifiable on-chain memory commitments inspired by:

- **Mem0 (`mem0ai/mem0`)**: Scoped semantic facts (`account_id`, `project_id`, `domain`, `kind`) with SHA-256 content deduplication and hybrid Vectorize + D1 recall.
- **Letta / MemGPT (`letta-ai/letta`)**: Self-editing agent memory (`memory_remember`, `memory_recall`, `memory_forget`, `memory_timeline`, `supersedesFactId`) plus autonomous post-turn semantic delta extraction.
- **Graphiti / Zep**: Bi-temporal knowledge graph (`memory_edges` with `valid_from`, `valid_to`, `derivation`, `superseded_by`) updated automatically when audit findings, weekly decisions, Dreaming proposals, or chat turns occur.
- **GAM (`VectorSpaceLab/general-agentic-memory`)**: L0/L1/L2 progressive context assembly, strict negative constraints (`kind: 'constraint'`, `never_bring_up`), and pre-prompt PII redaction (`sanitizePii`).
- **OriginTrail DKG + Anamnesis + AnchorChain**: Canonical memory bundle serialization, deterministic SHA-256 Merkle tree with selective-disclosure inclusion proofs, PBKDF2 (100,000 iterations) + AES-256-GCM encryption, optional IPFS pinning (`IPFS_PINNING_URL`), and TON on-chain commitment verification (`luminara:mem_v1:<merkleRoot32>:<cid24>`).
- **Context0 (`Itz-Agasta/context0`)**: Cross-agent MCP access (`/mcp`) and unified client-server Brand Memory + Verifiable Vault UI.

## Architecture & Module Boundaries

1. **`migrations/0044_agentic_memory_and_vault.sql`**:
   - Scoped `memory_facts` columns (`project_id`, `domain`, `kind`, `importance`, `confidence`, `content_sha256`, `status`, `superseded_by`, `expires_at`, `updated_at`).
   - Bi-temporal `memory_edges` table (`subject_entity`, `predicate`, `object_entity`, `valid_from`, `valid_to`, `derivation`, `confidence`, `source_ref`, `superseded_by`).
   - `memory_vault_snapshots` table (`merkle_root`, `leaf_count`, `leaf_hashes_json`, `cid`, `storage_backend`, `ciphertext_base64`, `iv_base64`, `salt_base64`, `anchor_id`, `chain`, `network`, `tx_hash`).
2. **`worker/unifiedMemoryRouter.ts`**:
   - Core CRUD and recall router (`rememberScopedFact`, `forgetScopedFact`, `upsertTemporalEdge`, `queryTemporalTimeline`, `recallUnifiedContext`).
   - Enforces GAM L0/L1/L2 progressive formatting, strict negative constraint promotion, and PII redaction (`sanitizePii`).
3. **`worker/memoryAutoIngest.ts`**:
   - Autonomous post-chat semantic delta extractor (`extractAndStoreChatMemory`) replacing naive regex-only raw inserts.
   - Automatic bi-temporal graph ingestion hooks for audit findings (`ingestAuditFindingsToGraph`), weekly decisions (`ingestWeeklyDecisionToGraph`), and Dreaming consolidations (`ingestDreamProposalToGraph`).
4. **`worker/memoryVaultService.ts`**:
   - Deterministic SHA-256 Merkle root and leaf inclusion proof builder/verifier.
   - WebCrypto PBKDF2-SHA256 + AES-256-GCM encryption/decryption.
   - Optional IPFS pinning (`IPFS_PINNING_URL` / `IPFS_PINNING_JWT`) with R2 and D1 fallback.
   - Evidence-bound TON on-chain memo verification (`verifyTonMemoryAnchorOnChain` via Toncenter v3 / TonAPI v2).
5. **`services/memory/unifiedMemoryClient.ts` & `components/suite/UnifiedAgentMemoryPanel.tsx`**:
   - Client SDK and interactive Brand Memory UI for managing scoped facts, exploring the bi-temporal knowledge graph (with As-Of point-in-time filtering), minting encrypted Merkle vault snapshots, verifying individual leaves, and anchoring/verifying TON transactions.

## Quality Gates

- Every touched file remains strictly under 1,000 lines.
- Zero em dashes (`U+2014`) across all code, comments, tests, and copy.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` must pass cleanly.
