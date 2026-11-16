# Feature Map: Agentic Oracle (REA phase 4)

2026-11-06. Each feature is Luminara's own design. The "from" column names the evidence rows in `Evidence_Ledger.md` that inspired it; nothing is copied. A feature that reuses an existing Luminara part says so.

## Foundation (every job needs these)

### F1. Server agent loop in Oracle chat
- **Trigger:** a signed-in user sends a message in Oracle chat.
- **Steps:** model call with real tool definitions; run the tool calls; feed results back as tool messages; repeat until a plain answer. Iteration budget with a warning near the end and one grace call to summarise (H1). Loop guard on repeated identical calls (H2, D14). Token budget stop that removes tools so the model writes its answer (D15).
- **Data:** the turn's messages in the `OracleSession` Durable Object (exists, L10); tool results stored outside the prompt with a short digest in it (H20).
- **Output:** verdict, one action, report link (AGENTS.md invariant 4), streamed with the existing `tool` and `harness_event` frames.
- **Edge cases:** provider down (existing failover); a tool error is returned to the model, not thrown; request wall-clock limit means long jobs hand off to F4.
- **From:** H1, H2, H4, D14, D15; replaces the single Groq call at `worker/oracleChat.ts:699-780` (L10). `runToolLoop` is reference only (L9).

### F2. Tool registry with effect labels
- **Trigger:** loaded once per run.
- **Steps:** each tool declares a schema, a cost class, a result-size cap and an **effect**: `read` (search, fetch, observe, audit), `draft` (writes inside Luminara: drafts, reports, skills proposals), or `external` (publish, send, paid spend over budget). Unattended runs get only `read` and `draft` (H7, D4).
- **Data:** extends `services/tools/registry.ts` and `paidCatalogue.ts` (L1, L13). No new table.
- **Output:** the model's tool list, the approval policy and the cost estimate, from one table.
- **From:** A9, A13, H5, D12.

### F3. Approval queue (park and resume)
- **Trigger:** the model calls an `external` tool, or paid spend would pass the budget's soft line.
- **Steps:** the tool does not run. A pending approval row is written with a plain preview of what would change (A8, A14), and the run parks. Oracle chat shows an approval card: approve, edit (when editable), or reject; "approve all of this kind for this run" (A8). Approve resumes the same run; the effect is recorded in `external_effects` so a retry never repeats it (L13). Reject returns a refusal to the model, which must find another route (H7).
- **Data:** a new approvals table, or the `OracleSession` approval gate that already exists (L12). Decided in the blueprint.
- **Edge cases:** two clicks at once; approval after the row expired; the run was cancelled meanwhile.
- **From:** A8, A11, D12, H6, H7; reuses L12, L13.

### F4. Durable run engine for long jobs
- **Trigger:** a job that outlives one request (deep research, a watch mission, a multi-step fix).
- **Steps:** one Cloudflare Workflow instance per run, one step per model call or tool batch, resume by run id, cancel through the D1 row, wait-for-event for approvals.
- **Data:** Track SW's `swarm_runs` design (not built, L15), migration `0047` or later (L16), DO tag `v3-*` if a Durable Object is used.
- **From:** A1-A3, Track SW section 4.1 (spike A favours a Workflow).

### F5. Source ledger and citation check
- **Trigger:** any tool fetches a page or search result; any answer or report cites a source.
- **Steps:** record each fetched source (URL, time, content hash) against the run. Before an answer or report is shown, code checks that every cited URL is in the run's ledger; a citation not found is dropped and counted. Claims with no measured source say `not_measured` (AGENTS.md invariant 5).
- **From:** D2, D3, D8 (DeerFlow checks tool receipts but not cited URLs; this closes that gap); RLM's `ClaimLedger` (L6).

## The four jobs

### J1. Fix my visibility
- **Trigger:** "fix my visibility" (or the chat's intent router decides it).
- **Steps:** read project context (invariant 3) → audit the site → `browse_observe` competitors (read) → explain why AI answers skip the site, citing sources (F5) → draft fixes (schema, llms.txt, content) as `draft` → anything to publish becomes an approval card (F3). Stop gate: the run cannot finish until each draft has been re-checked against the page evidence (H3).
- **Wires in:** browser tools with `enforceTwoTierPolicy: true` and `writeApproved` taken from F3, not the default (L2); a larger decision budget than 200 tokens (L3).
- **Needs:** a hosted crawler (L5, UNKNOWN today).

### J2. Deep research report
- **Trigger:** "research X" or a report request.
- **Steps:** plan shown live as a todo list (D6: DeerFlow has no plan approval; we show the plan and let the user stop or edit it) → up to 3 researcher steps in parallel, each with `read` tools only and no sub-spawning (D1, H9) → RLM synthesises over the gathered corpus with a Worker model client (L6) → citations checked (F5) → `save_report` to the project.
- **Wires in:** RLM in the Worker (needs its own LLM client; regex op moved to re2js).
- **Needs:** F4 (too long for one request).

### J3. Watch missions
- **Trigger:** schedule (daily cron today; hourly needs a Workflow sleep or DO alarm, L14), or the user asks "watch X".
- **Steps:** fire-time checks (enabled, budget, owner allowed; a refused fire keeps the schedule, A5) → cheap deterministic check first (citation check, competitor page), output hashed against the last snapshot (H18) → unchanged: no model call, logged silently → changed or failed: the agent wakes with the diff and the last verdict as context (H17), writes a verdict and one action into the mission's own thread (A5); anything external waits for approval (F3). Unattended runs get no `external` tools (H7, H17).
- **Reuses:** `citation_watches` and `citation_watch_runs` (L13).

### J4. Learn and remember
- **Trigger:** a run finishes (reflection), weekly (curator).
- **Steps:** after a run, a separate low-priority step reviews a digest of it with skill and memory tools only (H11). Order: patch a skill used this run, then an umbrella skill, then propose a new one. Do not save environment failures, transient errors, one-offs or dead ends (H11). Patches apply; new skills are proposals the user approves (H12, D9). Project memory: stable facts only, declarative, grounded in a user message or tool result, total character cap per project, injection scan before write, frozen snapshot at run start (H14, H15, D11). Weekly sweep: stale at 14 days unused, archived at 30, pinned and new skills skipped, never deleted (H13).
- **Reuses:** RSI skill store with revisions, proposals and rollback; the Monday curator; `memory_facts`; Dreaming (L13). No new skill table.
- **Gate for learning:** only runs with a concrete outcome feed it (A16), for example a fix whose re-check passed.

## Wiring the three modules

| Module | State (corrected) | What wiring means |
|---|---|---|
| Browser action loop | Live for MCP; not in Oracle; policy defaults unsafe (L1, L2) | Oracle tools in F2, two-tier policy on, writes only through F3 |
| RLM runner | Live in browser audit; not in Oracle (L7) | Worker client, used by J2 |
| Grounding zoom | No caller (L8) | Vision fallback inside `browse_goal` when the DOM misses a control; needs screenshots and a vision model. Lowest value per build. |

## Suggested first slice (simplest three that make it feel agentic)

1. **F1 + F2: the Oracle tool loop** with `read` tools (live search, paid research behind the existing gates, `browse_observe`, audit). Visible today in chat.
2. **F3: the approval card**, with the first `draft`/`external` tools: save a draft fix, and publish only on approval.
3. **J3's wake gate on citation watch**: deterministic check, silent when unchanged, agent verdict only on change.

Then F4 + F5 + J2 (research with RLM), then J1 end to end (needs the hosted crawler), then J4's reflection, then zoom.
