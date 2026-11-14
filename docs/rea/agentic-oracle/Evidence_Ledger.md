# Evidence Ledger: Agentic Oracle (REA)

Every finding carries a tag: **OBSERVED** (read in source, with path), **INFERRED** (a reading of likely behaviour, with the reason), **UNKNOWN**. No evidence, no claim. Ideas only: nothing here is copied code or prompt text.

Paths are relative to each clone, kept in a `rea-refs` folder outside the repository.

## Phase 3 OBSERVE, 2026-11-06

### DeerFlow (`4a53a36`, MIT)

The repository is a 2.x harness: one lead agent with a middleware chain, optional sub-agents, skills as folders, background memory. It is not the 1.x planner/researcher/reporter graph. `H/` = `backend/packages/harness/deerflow/`.

| # | Pattern | Finding | Tag | Evidence |
|---|---|---|---|---|
| D1 | Bounded sub-agents | Lead delegates through one `task` tool. Sub-agents cannot spawn sub-agents. 3 run at once, 6 per run by default (clamp 1-50). A limit returns partial results. | OBSERVED | `H/tools/builtins/task_tool.py:756-790`, `H/subagents/config.py`, `H/config/subagents_config.py:13-17`, `H/subagents/executor.py:2065-2125` |
| D2 | Receipts | Each tool result gets a deterministic receipt (id, tool, status, output hash). Reports must cite receipt ids. Code flags unknown or missing citations as UNVERIFIED. Advisory, not a gate. | OBSERVED | `H/agents/middlewares/tool_receipt.py:1-30`, `H/subagents/report_contract.py:60-95`, `H/agents/middlewares/receipt_verification.py:1-40` |
| D3 | Acceptance criteria | Decidable criteria are checked in code. The rest are marked UNVERIFIED, never passed silently. | OBSERVED | `task_tool.py:800-830` |
| D4 | Interaction modes | interactive / autonomous / webhook / scheduled. Interactive: a clarification tool ends the turn with a structured card. Non-interactive: no clarification tool; pick the reversible option, list assumptions, return BLOCKED for irreversible work. | OBSERVED | `H/agents/interaction_policy.py:12-19`, `:92-104`, `H/agents/middlewares/clarification_middleware.py:507-555` |
| D5 | Goal loop | Objective plus continuation and no-progress counters. A separate evaluator decides satisfied or blocked. Max 8 continuations. | OBSERVED | `H/agents/goal_state.py:10-40`, `H/runtime/goal.py:43`, `:450-567` |
| D6 | Plan approval | No pre-run accept or edit of the plan. The todo list is informational. | INFERRED (absent from plan, todo and interaction code) | `H/agents/lead_agent/agent.py:359-380` |
| D7 | Research | Research is a skill with phases (survey, deep dive, diversity check, synthesis). Pluggable search and fetch providers. | OBSERVED | `skills/public/deep-research/SKILL.md`, `H/community/` |
| D8 | Citation checking | Inline citations are required by prompt only. No code checks a cited URL against fetched sources. | INFERRED (only receipt checks exist in code) | `H/agents/lead_agent/prompt.py:748-777` |
| D9 | Skills | Folder skills with categories. Prompt carries a list or names-only index; body loaded on match. `/skill-name` forces one. Agent can create and patch custom skills: validated, static plus model security scan, per-skill lock, history kept. Behind a config flag. | OBSERVED | `H/skills/types.py:10-60`, `prompt.py:935-972`, `H/tools/skill_manage_tool.py:119-250`, `H/config/app_config.py:286` |
| D10 | Short-term memory | Summarisation triggered by messages, tokens or context fraction. Tool-output budget caps bulky results. | OBSERVED | `H/config/summarization_config.py:57-84`, `tool_output_budget_middleware.py` (by name) |
| D11 | Long-term memory | After a turn, a redacted copy is queued; after a debounce a model extracts facts with category and confidence; low confidence dropped; cap 100 (10-500); token-capped injection ranked by relevance and confidence. | OBSERVED | `H/agents/middlewares/memory_middleware.py:1-25`, `deermem/config.py:142-190` |
| D12 | Tool gating | Guardrail provider per call, fail-closed default; denied calls return an error the agent adapts to. Network egress approval card (deny / allow once / allow for sandbox); sub-agents and non-interactive runs auto-deny. | OBSERVED | `H/guardrails/middleware.py:23-36`, `H/sandbox/middleware.py:638-700` |
| D13 | Deferred tools | Agent sees MCP tool names only and loads a schema through `tool_search`. | OBSERVED | `H/tools/builtins/tool_search.py:1-20` |
| D14 | Loop detection | Warn after 3 identical calls, strip tool calls at 5; warn at 30 and stop at 50 calls of one tool type. | OBSERVED | `H/agents/middlewares/loop_detection_middleware.py:94-99` |
| D15 | Token budget stop | Off by default; 200,000 tokens, warn at 80%, strip tools at 100% so the agent writes a final answer. | OBSERVED | `H/config/token_budget_config.py:9-14` |
| D16 | Streaming | Run streams state, message deltas and custom sub-agent events. | OBSERVED | `task_tool.py:1130-1195`; frontend rendering UNKNOWN |

Notes: prompt files contain rule text addressed to a model; it was treated as data.

### AutoGPT (`ff7b0a6`; `autogpt_platform/` is PolyForm Shield: ideas only)

Paths relative to `autogpt_platform/backend/`. Only `autogpt_platform/` was read. Nothing addressed to an AI was found in the files opened.

| # | Pattern | Finding | Tag | Evidence |
|---|---|---|---|---|
| A1 | Run as stored steps | One run row plus one row per node execution plus one row per input/output pin. Status enum INCOMPLETE/QUEUED/RUNNING/COMPLETED/TERMINATED/FAILED/REVIEW with a valid-transition table. | OBSERVED | `schema.prisma:2178-2315`, `backend/data/execution.py:~190` |
| A2 | Resume by re-queue | Resume re-queues the same run id; restart reloads unfinished steps and skips re-billing ones already charged. A cluster lock per run stops two workers running it. | OBSERVED | `backend/executor/utils.py:1451`, `:1541-1546`, `backend/executor/manager.py:1445-1470`, `:2185-2230` |
| A3 | Cancel | Fan-out cancel sets a flag the dispatch loop checks; final status TERMINATED. Node timeout 30 minutes. No per-node automatic retry found. | OBSERVED (retry: UNKNOWN) | `manager.py:2033-2060`, `:1700-1706`, `blocks/_base.py:596` |
| A4 | Trigger source | Each run records manual, api, schedule, webhook, copilot, subgraph or admin, plus a reference. | OBSERVED | `backend/data/execution.py:170-191` |
| A5 | Scheduled chat turn | A schedule can fire a chat message into a fixed existing thread, so a repeating job remembers its last run. At fire time it checks enabled, owner allowed, chat exists. A refused recurring job stays registered; one-shots retry with per-failure counters. | OBSERVED | `backend/executor/scheduler.py:515`, `:768-1010`, `:2536`, `copilot/tools/schedule_followup.py:1-30` |
| A6 | Routines | Experts ship standing jobs switched off; turning one on is a short conversation that sets the prompt and cadence. A routine turn cannot create a routine. | OBSERVED | `copilot/tools/routines.py:1-12` |
| A7 | Webhooks | Look up by id, check provider, verify signature (403), drop if owner unpaid, validate, start attached runs; payload masked. | OBSERVED | `backend/api/features/integrations/router.py:1338-1530` |
| A8 | Park-and-resume approval | Blocks flagged irreversible pause when safe mode is on. Existing approval (this step, or "auto-approve this node for this run") is checked first; otherwise a pending review row (payload, instructions, editable, status, wasEdited, reviewedAt) is written and the run ends in REVIEW. Deciding tolerates double clicks; when none remain pending the run resumes with the same id; reject fails the step. Blocks can declare a change preview. | OBSERVED | `blocks/_base.py:~640`, `:863-943`, `backend/blocks/helpers/review.py:80-130`, `backend/data/human_review.py:73-150`, `:781`, `schema.prisma:2358`, `manager.py:1688-1696` |
| A9 | Effect policy | Every chat tool call is classed by effect (read, workspace, shell, platform, external-judged, external). Modes ask_first / auto / unsupervised. The model can only add a question; any failure falls back to ask. | OBSERVED (from file headers; rubric not read) | `copilot/gate/policy.py:1-8`, `copilot/gate/classifier.py:1-8` |
| A10 | Pre-charge and settle | Blocks declare cost types. Estimate charged before a step, difference charged or refunded after; a positive difference may go negative since work was done. Insufficient balance fails the step and the run. | OBSERVED | `blocks/_base.py:130-215`, `backend/executor/billing.py:122`, `:326-360`, `manager.py:1480-1520` |
| A11 | Budget with soft approval line | Per-expert weekly budget pauses its schedules and posts in its thread; warning at a fraction. Below the hard stop, spend past a threshold parks new work as a review; one approval unlocks the window. The file says counters can overshoot under concurrency. | OBSERVED | `backend/api/features/experts/scheduling.py:503`, `backend/api/features/experts/spend_approval.py:1-120`, `backend/data/expert_spend.py` |
| A12 | Chat pause | Chat turns over allowance pause with a checkpoint ("keep going" or "resume at reset") instead of failing. | OBSERVED | `copilot/budget_gate.py:1-20`, `copilot/turn_pause.py:1-10`, `copilot/continuation.py:1-10` |
| A13 | Typed block registry | Each capability has typed input/output schemas, description, categories, cost, effect level, capability kind; synced to a table at start. Inputs validated before each run. | OBSERVED | `backend/data/block.py:20-70`, `blocks/_base.py:63-90`, `:1000-1050` |
| A14 | Dry run | Blocks simulated by a model grounded in their schema, with no side effects. | OBSERVED | `backend/executor/simulator.py:1-30` |
| A15 | Run summary and interest | After a run a model writes a plain activity summary and a 0-1 correctness score; each run gets an interestingness score; the daily briefing reads the top runs. | OBSERVED | `backend/executor/activity_status_generator.py`, `backend/data/model.py:1148-1154`, `backend/data/briefing_data.py:42-110` |
| A16 | Nightly learning | Per user: lease, pick changed sessions, gate on concrete outcome signals, gather bounded evidence, reviewer model, deterministic validation, publish or propose, ledger row keyed by source + revision + policy version, advance cursor. Idle accounts cost nothing. | OBSERVED | `copilot/learning/nightly.py:1-20`, `backend/data/skill_learning.py:1-12` |
| A17 | Skills | Folder with SKILL.md in the user's workspace; agent lists, loads, and stores skills. | OBSERVED | `copilot/tools/skills.py:1-30` |
| A18 | Agent from a sentence | The model decomposes the goal and fills a graph schema; a deterministic pipeline fixes, validates, previews or saves. | OBSERVED | `copilot/tools/agent_generator/pipeline.py:1-40` |

Not read: the agent loop block (`blocks/orchestrator.py`), front-end run pages, the effect classifier rubric. Memory uses a temporal knowledge graph (Graphiti on FalkorDB): too heavy for Luminara.

### Hermes Agent (`84a03014`, MIT)

About 268k lines of Python, mostly edge-case hardening around small ideas. State lives in process threads and SQLite, so it has no durable pause-and-resume to copy.

| # | Pattern | Finding | Tag | Evidence |
|---|---|---|---|---|
| H1 | Iteration budget | Parent cap 500, sub-agent cap 50. A warning is injected at a set fraction. On exhaustion, exactly one grace call to summarise. | OBSERVED | `agent/iteration_budget.py:1-45`, `agent/turn_truncation.py:581-641`, `agent/turn_iteration_prep.py:48-98` |
| H2 | Loop guard | Signature counters: warn after 2 identical failures or no-progress reads; halt at 8 same-tool failures; 50 web searches and 50 sub-agents per turn. | OBSERVED | `agent/tool_guardrails.py:81-82`, `:125-129`, `:416-443` |
| H3 | Stop gates | When the model tries to finish, a gate can nudge it to keep going (for example "verify first"). The candidate answer is kept as a fallback. | OBSERVED | `agent/turn_stop_gates.py:1-12`, `agent/verification_stop.py:1-5` |
| H4 | Stable prompt prefix | System prompt stays byte-stable for a conversation. Mid-run injections go into user or tool messages. | OBSERVED | `AGENTS.md:18-23` |
| H5 | Tool registry | Declarative: schema, handler, toolset, availability check, required env, result-size cap. Toolsets per platform. Untrusted webhook sessions get a minimal safe set. | OBSERVED | `tools/registry.py:1-8`, `:223-278`, `toolsets.py:12-50` |
| H6 | Dangerous-action gate | Hard-line patterns blocked. Flagged ones go to an optional guardian model that treats the action text as untrusted, then to a human (once / session / always). Denial circuit breaker. | OBSERVED | `tools/approval.py:1-100`, `:844-875`, `tools/approval_smart.py:1-25` |
| H7 | Unattended default | Cron, single-query and webhook runs default to BLOCK with a message telling the model to find another route. The bypass switch is frozen at process start so a skill cannot flip it. | OBSERVED | `tools/approval.py:49-51`, `:641-760` |
| H8 | Interactive approval wait | The agent thread blocks until approve, deny or timeout. Not usable on Workers. | OBSERVED | `tools/approval_gateway_wait.py:1-12` |
| H9 | Sub-agent limits | Children cannot write memory, send messages, schedule, ask the user or recurse. 10 concurrent, depth limit, per-child inactivity timeout. | OBSERVED | `tools/delegate_tool_toolsets.py:14-22`, `tools/delegate_tool.py:584-602` |
| H10 | Skill format and disclosure | Folder with SKILL.md front matter. Prompt carries an index (name plus 60-character description); body loaded on demand, support files on request. Limits: name 64, body 100,000 characters, file 1 MiB. | OBSERVED | `agent/skill_utils.py:846`, `agent/prompt_builder.py:1233-1358`, `tools/skill_manager_tool.py:108-185` |
| H11 | Skill learning loop | A counter of tool iterations arms a review at 10. After the turn a forked agent replays the transcript with only skill, memory and read tools. Preference: patch a loaded skill, then an umbrella skill, then add a file, then create a class-level skill. Read-before-write enforced. Do-not-capture list: environment failures, transient errors, one-offs, unresolved dead ends. A short summary goes to the user. | OBSERVED | `agent/agent_init.py:1286-1288`, `agent/background_review.py:1-7`, `:345-530`, `:1065-1156`, `:1251-1258` |
| H12 | Skill rot control | Validation and linter; per-skill telemetry (uses, views, patches, last used, created_by, state, pinned); optional write-approval staging; append-only ledger with before/after and rollback. | OBSERVED | `tools/skill_manager_tool.py:146-190`, `tools/skill_usage.py:1-8`, `tools/write_approval.py:1-11`, `tools/skill_ledger.py:1-12` |
| H13 | Curator | Runs on idle when the last run is older than 7 days. Deterministic pass, no model: agent-created skills only; pinned skip; never archive a never-used skill under 14 days; stale at 14 days, archived (moved, not deleted) at 30; reuse reactivates. Optional model consolidation off by default, snapshot first. | OBSERVED | `agent/curator.py:1-10`, `:172-262`, `:46-49` |
| H14 | Memory stores | Two small stores with hard character caps (2,200 agent notes, 1,375 user). Frozen snapshot at session start. Over-budget add rejected with the live entries so the model consolidates. | OBSERVED | `agent/agent_init.py:1244-1250`, `tools/memory_tool.py:1-5`, `:372-400` |
| H15 | Memory rules | Memory is stable facts; procedures go to skills. Store declarative facts, not imperatives. Save only what a user message or tool result grounds; no inferred traits. Injection scan before write. Memory review armed every 10 user turns. | OBSERVED | `tools/memory_tool.py:372-398`, `agent/background_review.py:359-377`, `tools/memory_tool_store.py:29-33` |
| H16 | Session search | FTS5 search over past sessions, no model; demotes cron sessions. | OBSERVED | `tools/session_search_tool.py:1-30` |
| H17 | Cron jobs | Schedule forms; preloaded skills; `context_from` feeds the last non-silent output (8,000 characters). `next_run_at` advanced before dispatch (at most once). Inactivity watchdog 600 s. Cron agents never get messaging, clarify or cron tools. | OBSERVED | `cron/AGENTS.md`, `cron/scheduler.py:415-437`, `cron/scheduler_prompt.py:50-60` |
| H18 | Monitor and wake gate | A cheap source runs first; its output is hashed. Unchanged: no model run, silent. Changed: capped diff injected. Source failure is an alert, never "no change". Silent marker suppresses delivery. | OBSERVED | `cron/monitor.py:1-14`, `cron/scheduler.py:539-565`, `:1555-1595` |
| H19 | Delivery queue | Claimed at most once; an unknown-outcome send is never retried (lost beats duplicate). | OBSERVED | `cron/delivery_queue.py:1-8` |
| H20 | Context compression | Cheap model summarises the middle; tool output pruned first. Goal judge after each turn, fails open, turn budget backstop. | OBSERVED | `agent/context_compressor.py:1-3`, `hermes_cli/goals.py:1-8` |

Not verified: curator consolidation prompt, smart-approval rules, redaction code, send_message gating, and whether auto-created skills are good in practice (no outcome data in the tree).

### Luminara (worktree at `5464754`)

**Correction to the owner, 2026-11-06.** In chat I said the browser action loop and the RLM runner were "built but not used". That was half wrong. My search looked for `services/browserAction` import paths and missed the relative `../browserAction` import. Re-checked by hand: the browser tools are live for MCP, and RLM is live in the browser-side audit. What is true: **Oracle chat uses neither**, and grounding zoom has no caller.

| # | Finding | Tag | Evidence |
|---|---|---|---|
| L1 | Browser tools are registered and dispatched (`BROWSER_ACTION_CATALOGUE`, `executeBrowserActionTool`) and exposed over MCP; `browse_goal` is governed as destructive (one-time approval). | OBSERVED | `services/tools/registry.ts:20-24`, `worker/mcpGovernance.ts:39-41` (exposure via the governance risk table; `worker/mcpServer.ts:660` is only the `browse_observe` plan gate) |
| L2 | The live `browse_goal` builds the loop without `enforceTwoTierPolicy` (default off) and with `writeApproved` defaulting to true, so a page could drive writes. | OBSERVED | `services/browserAction/execute.ts:~370-395`, `loop.ts:84-85` |
| L3 | Browser LLM is OpenRouter only, `max_tokens: 200`; without `OPENROUTER_API_KEY` `browse_goal` is unavailable. | OBSERVED | `services/tools/registry.ts:42-62` (`max_tokens` at `:60`), `execute.ts:344` |
| L4 | Crawler endpoints the loop needs all exist (`/session`, `/observe`, `/act`, `DELETE`, `/health`), with SSRF guard and token auth; sessions are in memory, 10-minute idle, cap 32. | OBSERVED | `crawler/server.mjs:315-980`, `crawler/sessionStore.mjs:1-13` |
| L5 | `PATCHRIGHT_URL` is in no `wrangler.jsonc` var; whether a hosted crawler exists is not known. | UNKNOWN | `worker/env.ts:266-268` |
| L6 | RLM runs a JSON op language, never `eval`; only `new RegExp` on model input (capped, unsafe-pattern check). Its only LLM client wraps the browser provider stack. | OBSERVED | `services/rlm/README.md`, `services/rlm/contextStore.ts:185-345`, `services/rlm/index.ts:29` |
| L7 | RLM is used by the browser-side audit and shown in the report. | OBSERVED | `services/geminiService.ts:94`, `:857`, `components/audit/ReportDisplay.tsx:439` |
| L8 | `runAgenticPointer` (zoom) has no caller outside tests; needs a vision client and screenshots. | OBSERVED | `services/grounding/agenticZoom.ts`, `tests/grounding.test.ts:97` |
| L9 | `runToolLoop` folds tool results into the prompt as text and discards the packed messages; browser only; hidden flag. Reference only. | OBSERVED | `services/tools/runToolLoop.ts:68-100`, `services/geminiService.ts:378-384` |
| L10 | Server Oracle exists: `POST /oracle/chat` (flag `ORACLE_SERVER_ENABLED` true in all envs), `OracleSession` Durable Object, one streaming Groq call, no tools in the payload; post-checks for unmeasured claims. | OBSERVED | `worker/index.ts:2191`, `worker/oracleChat.ts:187`, `:699-780` |
| L11 | Web reaches the server Oracle only on Agency (`apiAccess`); everyone else uses the browser path. | OBSERVED | `App.tsx:775-781` |
| L12 | Approval primitives exist: `OracleSession` `tool_approval_requested` events plus `POST /oracle/session/:id/approval`; MCP `mcp_action_requests` (30-minute TTL). No UI card for browse tools. | OBSERVED | `worker/oracleSession.ts:511-554`, `worker/mcpGovernance.ts:132-250` |
| L13 | Reusable stores: RSI skills with revisions, proposals, rollback, Monday curator (0027-0032); `memory_facts` (0008, 0016); Dreaming propose/review/rollback (0022); `agent_skills` + `run_provenance` (0010); budgets `budget_policies`/`cost_events` (0012); `external_effects` (0043); `citation_watches` (0034). | OBSERVED | `worker/rsiSkillStore.ts`, `worker/dreamingService.ts`, `worker/budgets.ts`, `worker/externalEffectsService.ts`, `worker/citationWatch.ts:437` |
| L14 | One cron only (`0 8 * * *`, account cap); jobs in `worker/scheduledJobs.ts`. | OBSERVED | `wrangler.jsonc:13`, `worker/scheduledJobs.ts` |
| L15 | Bindings: KV, D1, R2, Workers AI, 3 rate limits, DOs `ORACLE_SESSION` and `DAILY_QUOTA` (tags v1, v2), queue `AUDIT_JOBS`. No Workflow, no Browser Rendering, no `swarm_runs`. Next DO tag is `v3-*` (Track SW's `v2-swarm-run` is stale). | OBSERVED | `wrangler.jsonc` |
| L16 | Highest migration on `origin/staging` and `origin/main` is `0046`. Other refs already hold `0044` (three different files) and `0047_push_devices.sql` (`origin/feat/real-estate-agent-mode`). Duplicate prefixes 0011-0013 exist. Slice 1 therefore adds no migration. | OBSERVED (citation review, 235 remote refs scanned) | `migrations/`, commit `2babcf4` |
| L17 | Flags: string vars in all three `wrangler.jsonc` blocks, typed in `worker/env.ts`, gated dark in `worker/preprodFlags.ts`. | OBSERVED | `worker/preprodFlags.ts` |
