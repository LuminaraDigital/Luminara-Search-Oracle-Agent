# Evidence Ledger

Tags: **OBSERVED** means read in source at the cited place. **INFERRED** means reasoned from observed facts. **UNKNOWN** means not checked.
Upstream paths are relative to the clone at commit `42d4cde`. Luminara paths are relative to this repository: branch `fix/audit-file-detection-and-summary`, cross-checked against `origin/staging` at `4a02d4e8`.

## Upstream skeleton (TencentDB Agent Memory)
| # | Finding | Tag | Source |
| --- | --- | --- | --- |
| U1 | Four services: MemoryCore (420 files), MemoryProxy (304), MemoryKnowledge (121) and MemoryPanel (309), plus SDKs in TypeScript and Python | OBSERVED | `find` counts per folder |
| U2 | Memory has four layers: L0 raw conversation, L1 atom (fact), L2 scenario, L3 core/persona | OBSERVED | `README.md` "Technical Implementation"; `MemoryCore/src/core/{record,scene,persona}` |
| U3 | The L1 extractor keeps only three types: `persona`, `episodic` and `instruction`. A work variant uses `work_fact`, `work_task`, `work_method` and `work_artifact` | OBSERVED | `MemoryCore/src/core/prompts/l1-extraction.ts:16,40-52,345` |
| U4 | An L1 row carries `team_id`, `task_id`, `user_id`, `agent_id`, `scene_name`, `priority`, `version`, time span and `metadata_json` | OBSERVED | `MemoryCore/src/core/store/types.ts:115-135` |
| U5 | Hybrid retrieval merges FTS/BM25 and vector lists with Reciprocal Rank Fusion, k=60, in about 20 lines | OBSERVED | `MemoryCore/src/core/store/search-utils.ts:18-62` |
| U6 | Recall is capped by item count, a character budget and a timeout | OBSERVED (README claim) / UNKNOWN (enforced values) | `README.md` §1 |
| U7 | The Proxy parses the OpenAI or Anthropic request body, runs injector hooks (L1 recall, profile, skills, knowledge tools), then forwards the modified body upstream | OBSERVED | `MemoryProxy/src/injection/pipeline.ts:1-5`; `injection/injectors/*`; `pipeline/stages/forward.ts` |
| U8 | The REST surface is POST `/v3/conversation\|atomic\|scenario\|core\|skill\|knowledge/*` plus user, team, agent and task admin | OBSERVED | `MemoryCore/v3-api-memorycore-doc.md` §3 |
| U9 | Visibility levels are `private`, `team`, `restricted` (ACL) and `agent`; new items are private by default | OBSERVED (README) | `README.md` "Shared Experience" |
| U10 | Native or Node-only dependencies: sqlite-vec, better-sqlite3, @node-rs/jieba, node-pty, mongodb, ioredis, OpenTelemetry sdk-node | OBSERVED | each `package.json` |
| U11 | Reported benchmark: PersonaMem 48% → 76% | OBSERVED as a claim; not reproduced | `README.md` "Benchmark" |

## Luminara skeleton (what already exists)
| # | Finding | Tag | Source |
| --- | --- | --- | --- |
| L1 | The Oracle chat already injects memory RAG into the system prompt, best-effort | OBSERVED | `worker/oracleChat.ts:674-684` |
| L2 | `memory_facts` is mem0-style, with `memory_history` (ADD, UPDATE, DELETE, NONE) and `memory_chat_extractions` (pending, approved, stored) | OBSERVED (via helper) | migrations 0008, 0015, 0016 |
| L3 | Fact extraction is a regex heuristic, and recall is keyword overlap over the latest 50 facts | OBSERVED | `worker/memoryRag.ts:285`; plan table `docs/plans/verifiable-flow-memory-10x-ship.md:115` |
| L4 | Workers AI (`AI`) is bound in all environments; Vectorize `MEMORY_VECTORS` is not | OBSERVED | `wrangler.jsonc:60,170,251,365` |
| L5 | The owner decided not to bind Vectorize for memory and to use typed, scoped D1 retrieval only | OBSERVED | `docs/plans/verifiable-flow-memory-10x-ship.md:601` (decision 3) |
| L6 | No D1 FTS5 table exists | OBSERVED (branch) / UNKNOWN (staging 0044-0056) | `grep fts5 migrations/` |
| L7 | The Telegram bot does not use memory RAG; it keeps 6 turns in KV for 24 h | OBSERVED | `worker/telegramBot.ts` (no `memoryRag` import); `:784-814` per helper |
| L8 | Android Ask calls the `/api/providers/*` relay, not `/api/oracle/chat`, so it gets no memory | OBSERVED (via helper) | `apps/android/.../LuminaraRepository.kt:301-343` |
| L9 | Persona-like layer: `business_memories` (business_dna, preference_memory and others) from Dreaming | OBSERVED (via helper) | migration 0022; `worker/dreamingService.ts` |
| L10 | Skills library: `rsi_skills` with revisions and proposals | OBSERVED (via helper) | migration 0027; `specs/0021-rsi-skill-library.md` |
| L11 | Memory is scoped by account (`billingId`) only; `teams` exist, but memory has no team or agent ACL | OBSERVED (via helper) | `worker/workerUtils.ts:122`; migration 0003 |
| L12 | Staging's latest migration is 0056 and draft PR 413 uses 0057 | OBSERVED | `git ls-tree origin/staging migrations/` |
| L13 | Staging migration 0046 already gives `memory_facts` scope, kind, dedupe key, status and expiry; `scopedMemory.ts` stores owner rules as `kind='constraint'` | OBSERVED | `migrations/0046_scoped_review_rules.sql:4-18`; `worker/scopedMemory.ts:66-71` |
| L14 | The old fallback already skips `kind='constraint'` | OBSERVED | `worker/memoryRag.ts:276` (staging) |
| L15 | FTS5 plus triggers apply in node:sqlite and in local wrangler D1 | OBSERVED (local) / UNKNOWN (remote D1) | `tests/memoryRecall.test.ts`; `wrangler d1 migrations apply DB --local` |
| L16 | The Telegram honesty filter keeps a figure from account memory only once the memory is in `userTexts` | OBSERVED | `tests/telegramMemoryRecall.test.ts` (on keeps it, off removes it) |

## Log
- 2026-11-18, ORIENT → BLUEPRINT: first pass. The owner has not yet given any corrections.
- 2026-11-18, BUILD: the owner approved F1 to F3. The blueprint's data model was corrected (L13): staging already had the scope columns, so only the FTS migration was needed.
