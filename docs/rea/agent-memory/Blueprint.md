# Blueprint: Luminara Layered Memory (ideas from TencentDB Agent Memory)

Status: **F1 to F3 built on `feat/memory-recall-v2`, from `origin/staging` at `4a02d4e8`, on 2026-11-18. Both flags are off.** See §6. Tags refer to rows in Evidence_Ledger.md.

## 1. Decision: rebuild the ideas inside Luminara; don't run the Tencent stack

| Option | What it means | Verdict |
| --- | --- | --- |
| A. Run upstream as-is | Host 4 Node services and Docker somewhere outside Cloudflare, then point Luminara's LLM calls at its Proxy | **No.** None of it runs on Workers (U10). The Proxy would sit in every LLM call, hold provider keys and keep a second copy of user data outside D1. That is a new always-on server for a team that has none today. It also has Chinese prompts, a Tencent-mirror lockfile, and two bundled projects with unknown licences. |
| B. Vendor the TypeScript into `worker/` | Copy MemoryCore files and strip out the Node parts | **No.** Most of the 360 files are storage adapters (SQLite, Mongo, TCVDB, COS), OpenTelemetry and admin APIs that Luminara already has in its own form. We would be maintaining a fork of code we don't use. |
| C. Rebuild the ideas on Luminara's own tables | Bring the layer model, typed extraction, hybrid retrieval with RRF, recall budgets and visibility levels to `memory_facts` and its existing tables | **Yes.** Luminara already has about 60% of the skeleton (L1, L2, L9, L10). The real gaps are retrieval quality, extraction quality and coverage (L3, L6, L7, L8). This option uses original code, Luminara's prompts and Luminara's branding. MIT would allow copying, but we don't need to. If any snippet is copied word for word (for example `rrfMerge`, U5), add the Tencent MIT notice to `THIRD_PARTY_NOTICES`. |

## 2. Skeleton map: their layer → our table

```
TencentDB Agent Memory            Luminara today                          Gap
──────────────────────            ──────────────                          ───
L0 conversation          ──►  OracleSession DO turns (80), TG KV (6)      not searchable (fine for now)
L1 atom (typed facts)    ──►  memory_facts + memory_history (mem0 ops)    regex extraction, no type, keyword recall
L2 scenario              ──►  project_context_sections                    not linked to facts
L3 core / persona        ──►  business_memories (Dreaming)                not injected into chat
Skills                   ──►  rsi_skills + rsi_skill_proposals            no extraction from chats
Wiki / CodeGraph         ──►  rsi_memory_documents (audits, chats)        out of scope
Proxy injectors          ──►  ragContextForOracle (Oracle chat only)      Telegram, Android Ask, MCP miss it
Visibility / ACL         ──►  account_id only                             no team/agent scope
```

## 3. Feature list (MAP)

| # | Feature | Trigger | Steps | Data | Output | Edge cases |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | **Hybrid recall** | Any agent turn | Run FTS5 BM25 over the account's facts. Optionally add cosine over stored embeddings. Merge with RRF. Cap by item count, characters and a timeout | `memory_facts`, a new `memory_facts_fts` | A fenced `ACCOUNT_MEMORY` block | Empty account; FTS syntax in the user's text (escape it); timeout → no block, never fail the chat |
| F2 | **Typed extraction** | After an assistant reply (`oracleChat.ts:787-797`) | An LLM returns `{type: persona\|episodic\|instruction\|business, text, confidence}`. Dedup against nearby facts gives ADD/UPDATE/DELETE/NONE. Write to `memory_chat_extractions` as pending, or store when auto-store is on | Chat turn, existing facts | Rows plus `memory_history` events | Questions must not become facts (a known regex bug, L3); prompt injection in the chat; LLM down → keep the regex fallback |
| F3 | **Recall on every surface** | Telegram reply, Android Ask, MCP | Call the same `recallMemory()` as F1 | Same as F1 | Same block in each prompt, or an MCP tool result | Telegram has no linked account → skip; Android calls the relay, so it needs a server-side hook |
| F4 | Persona digest (L3) | Dreaming run | Fold `business_memories` into a short profile and inject it on the first turn | `business_memories` | 1 short paragraph | Stale profile |
| F5 | Visibility / scope | Write and read | Add `visibility` (`private\|team\|agent`), `project_id` and `agent_id` columns, and filter on read | `memory_facts`, `teams` | Scoped recall | Team member leaves |
| F6 | Skill extraction | Multi-step task finished | Propose a skill into `rsi_skill_proposals` for a human to approve | Chat and tool trace | A proposal | Low-quality skills |
| F7 | Memory MCP tools | Agent call | `recall_memory` and `remember` (pending, not auto-stored) | F1 and F2 | Tool results | Rate limits; delegate scopes |

**Recommended first three: F1, F2 and F3 (Telegram only).** Each is a small change to an existing call site. Each fixes a documented weakness (L3, L7). None needs a new service, a binding or an owner cost decision.

## 4. Design of the first three

```
 user turn ─► surface (Oracle chat │ Telegram │ later Android/MCP)
                 │
                 ├─► recallMemory(env, {accountId, projectId?}, query, budget)   [F1]
                 │      ├─ FTS5 bm25 over memory_facts_fts  (top 20)
                 │      ├─ (flag) cosine over stored bge embeddings (top 20)
                 │      └─ rrfMerge → cap 5 items / 1,200 chars / 150 ms
                 │      → wrapUntrustedContent('ACCOUNT_MEMORY', …) into system prompt
                 │
                 ├─► LLM reply (unchanged)
                 │
                 └─► ctx.waitUntil(extractTypedFacts(...))                      [F2]
                        → memory_chat_extractions (pending) / memory_facts + memory_history
```

**Data model** (corrected after reading staging, L13). Staging migration 0046 already added `project_id`, `domain`, `kind` (default `'fact'`), `importance`, `confidence`, `content_sha256`, `status`, `superseded_by` and `expires_at` to `memory_facts`. The only new piece is migration `0058_memory_facts_fts.sql`. Open PRs hold 0044, 0047, 0052 and 0057.
- `memory_facts_fts`: an FTS5 table with `fact_id UNINDEXED` and `text` (porter unicode61). It keeps its own copy keyed by fact id, not by rowid, so a VACUUM that renumbers rowids cannot break it.
- Triggers run after insert, after delete, and after an update of `text`. The privacy erase deletes `memory_facts` rows, so the index loses them too (tested).
- Existing facts are backfilled once.
- Embeddings stay off (decision 3). Hybrid recall merges vector hits only when a vector index is configured.

**Code (as built, see §6).**
- `worker/memoryRecall.ts` (new): `recallMemory` and `rrfMerge`. `memoryRag.searchMemoryVectors` stays as the fallback when FTS isn't there.
- `worker/memoryExtract.ts` (new): the typed extraction prompt, written fresh in Luminara's voice, plus the dedup decision. It reuses `appendMemoryHistory`.
- `worker/oracleChat.ts:674-684`: `ragContextForOracle` calls `recallMemory` when `MEMORY_RECALL_V2` is on.
- `worker/telegramBot.ts:275`: inject recall when the chat is linked to an account and `MEMORY_RECALL_V2` is on.

**Flags** (string vars, off by default, added to `PREPROD_GATED_FLAGS` until reviewed): `MEMORY_RECALL_V2` and `MEMORY_LLM_EXTRACT`. With both off, behaviour is byte-identical to today. That is the "don't break the application" guarantee.

**Tests.**
- Unit tests for `rrfMerge` and the budget caps.
- FTS query escaping, with hostile input.
- The extraction parser: a question must never produce a fact.
- Prompt-injection text stays fenced.
- Flag off means the prompt matches today's prompt exactly (a golden test).

## 5. Open unknowns
1. Does D1 support FTS5 external-content tables and triggers on staging? (Prove with a throwaway migration.)
2. Which LLM handles extraction, and what does it cost per turn? (Groq `llama-3.3-70b` is already used here.)
3. Do Android Ask and MCP get memory in this track or a later one? Android files are currently being edited by another session.
4. Should auto-store stay off, with every fact pending review, as now?
5. Licences of the bundled CodeGraph and Hermes code. This only matters if we ever copy from those modules.
6. The upstream PersonaMem gain (U11) is not reproduced. Do we build our own small eval, like the Track TD/ND eval rows?

## 6. What was built (2026-11-18)

| Part | File | Notes |
| --- | --- | --- |
| Migration | `migrations/0058_memory_facts_fts.sql` | Proven in node:sqlite (all migrations) and in `wrangler d1 migrations apply --local`. **Remote staging D1 is not yet proven.** |
| F1 recall | `worker/memoryRecall.ts` | FTS5 bm25, filtered by account, `status='active'`, not `constraint`, not expired, and project (null or equal). RRF k=60 with a vector list only if an index exists. Budget: 5 items, 1,200 characters, 400 ms. Never throws. |
| F1 wiring | `worker/memoryRag.ts` `ragContextForOracle` | Flag on: ranked lines `N. [kind] text`, with no scores (fewer stray numbers for the model). Flag off: unchanged. The Oracle chat now passes `projectId`. |
| F2 extraction | `worker/memoryExtract.ts` | Groq `openai/gpt-oss-120b`, JSON mode, 6 s timeout. The message is fenced as untrusted. Kinds are preference, profile, instruction and event. Code drops questions, numbers the user didn't type, and facts with under 60% of their words from the user. PII is sanitised. Exact-duplicate key gives `NONE`. Confidence 0.7 or more is stored; the rest goes to pending. No model → regex fallback. |
| F2 wiring | `worker/oracleChat.ts` | With the flag on, extraction runs after `done` via `scheduleWaitUntil`, so the reply isn't held up. With the flag off it is awaited exactly as before. |
| F3 | `worker/telegramBot.ts` | With the flag on, the same `ragContextForOracle` block is added to the Telegram system prompt. Recalled facts join `userTexts` for the honesty filter, as the Oracle chat already does. |
| Flags | `wrangler.jsonc` (3 places), `worker/env.ts`, `worker/preprodFlags.ts` | `MEMORY_RECALL_V2` and `MEMORY_LLM_EXTRACT`, both `"false"` and preprod-gated. |
| Tests | `tests/memoryRecall.test.ts` (14), `tests/memoryExtract.test.ts` (11), `tests/telegramMemoryRecall.test.ts` (3) | Cover trigger sync, the erase, cross-account, project, status, expiry and rule isolation, FTS injection, RRF maths, budgets, timeout, flag-off parity, grounding and number checks, dedupe, fallback, and the Telegram prompt with the flag on and off. |

Not built (deliberately):
- Near-duplicate UPDATE/DELETE decisions (only exact duplicates give `NONE`).
- The L2 scenario layer, the persona digest (F4), team/agent visibility (F5), skill extraction (F6) and memory MCP tools (F7).
- Android Ask: the files are in another session's uncommitted work.

Before turning a flag on in staging:
- Confirm migration 0058 applied on staging D1.
- Watch `memory_recall_fts_failed` logs.
- Spot-check what extraction stores, and decide how many pending rows a person reviews.
