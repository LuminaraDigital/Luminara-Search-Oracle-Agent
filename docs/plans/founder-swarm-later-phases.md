# Founder Swarm and Business Brain: later phases (Track SW)

**Part of:** Track SW v0.4. The plan is [`founder-swarm-business-brain-additive-plan.md`](./founder-swarm-business-brain-additive-plan.md); its first page lists every file.  
**Date:** 2026-10-10  
**This file holds:** sections 7 and 9 to 13, and 15: SW2 (roster, caps, approvals), SW4 (Business Brain), SW5 (pay-per-audit), SW6 (Jobs), SW7 (live rooms and invites), SW8 (Watches and desktop), SW10 (gated designs). Each phase starts with a re-baseline task, and none starts before its Needs line is met. The rules of section 2 of the plan bind every task here.  
**Section numbers** are the plan's own, so they do not start at 1 here.

---

## 7. SW2 - Roster, caps, approvals, handoffs

**Goal:** named agents with visible limits. A founder can see what each agent may do and spend before it starts, and approve in one tap a step that would leave their account or spend above a threshold. Fixer and Coach gain model-written fields, each behind a check.

**Needs:** SW1b promoted; P9, P11, P12; decision 2. SW2-15 needs decision 18 and the connector lane's SW4-1 and SW4-2. P10 is optional.

### 7.1 Design

**Agent Passport K1, as one design.** Spec 0016 lists K1 ("Agent client caps + spending sessions") as planned with no schema, the Ops plan's F4 proposes `agent_seats` keyed by API key, and TN decision D2 says to merge them before either is built. This section is that merged design. If the owner declines decision 2, only roster agents use these tables and F4 stays as written.

- **`agent_clients`** is tier 2 of spec 0016's three tiers: one row per thing that can act for an account. `kind` is `api_key` (ref is `api_keys.id`), `oauth` (ref is the MCP OAuth client id) or `roster` (ref is the roster agent id). It carries what F4 asked for (`risk_ceiling`, `tool_allowlist_json`, `monthly_cap_cents`) and what TN4 asked for (`purpose`, self-declared `model`).
- An API-key client is inserted only through `INSERT ... SELECT FROM api_keys WHERE id = ? AND account_id = ? AND revoked_at IS NULL`, so a client can never attach to another account's key (F4's rule).
- **`agent_sessions`** is tier 3: one row per task, with a budget, an optional per-call cap, a tool scope and an expiry. A session's budget can never exceed its client's remaining month, which can never exceed the account's remaining month. The approval screen shows that worst case before consent (spec 0016, item 2).
- **`cost_events.session_id`** attributes spend to the session (spec 0016, item 3). Spend is always a `SUM` over the ledger; there is no mutable counter.
- **Units.** A founder sets caps in whole cents. Spend is summed in micro (section 4.4). A comparison multiplies the cap by 10,000; nothing is rounded before it is compared.

**Session flow for a roster run.** On start the engine requests a session for the agent's default cap. If the cap is at or under the client's `approval_threshold_cents`, the session is active at once. Otherwise it is `pending` and the run waits for the founder. The request is an `mcp_action_requests` row with `kind = 'session'` (the column is free text, `migrations/0013_mcp_action_requests_kind.sql:8`), so there is no parallel approval table.

**Enforcement.** For roster runs the three limits in section 4.4 are always enforced by the engine. For outside API keys and OAuth clients, enforcement follows the Ops flags `AGENT_SEATS` (ceiling and allow-list) and `AGENT_SEAT_CAPS` (caps and sessions), each `off`, `observe` or `enforce`, parsed by the Ops helper (P7). This plan adds no second flag for them.

**K2.** `estimate_cost(tool, args)` returns the rate-card price before a call, and a refused paid call carries a `PAYMENT_REQUIRED` envelope naming the missing budget. Both are spec 0016's design.

**Approvals inside a run.** When a step needs approval the engine creates a bound request (args hash, requester `roster:<agent>:<run>`, trust) through the Ops F1 path, and moves the run to `waiting_approval` with a `wait_until` equal to the request's expiry (section 4.1). The decide route's conditional update and wake resume the run; nothing polls. An approval is consumed once, by step key, so the one permitted re-run of an interrupted step can present the same approval and no other step can. A denial or an expiry fails the step; the agent's plan says whether the run continues without it. Two things need one: an effect that leaves the account (decision 18's pull request is the only such tool in this phase) and a session above the client's threshold. Saving a draft does not (rule 2.10).

**One typed call, not a loop.** Fixer and Coach keep the fixed step lists they shipped with in SW1. This phase adds one typed model call to each, and nothing lets a model choose a tool. The server tool loop that v0.1 planned here is built with the Prospector in SW6, the first agent that needs it (section 4.2).

**Fixer.** Input: one open finding. v0 already builds the artefact by code (section 6.1). SW2 lets a model fill the prose fields of a template: a description, an answer paragraph, an FAQ entry. The artefact around them is still code's. Each field is plain text with a length cap, carries no markup and no URL that is not in the run's evidence, and passes the output check of section 4.3. These fields are meant to be published, so a lexical check is not enough: each sentence in a model-filled field carries a quote under the rule of section 4.3, from a page this run fetched or from a field the founder typed. A field that fails any of this is left empty and the draft says so. This is what gives a thin-content finding its first draft. The run is `sealed` because it reads crawled pages. It never publishes, and the re-check is unchanged from SW1-16: a pass moves the finding to `done`, with a `fix_retested` receipt once receipts are on (P14), and a fail leaves it `in_progress` with the reason.

**Why a draft is checked and not just parsed.** A draft that "parses" can still do harm: a `robots.txt` with `Disallow: /` parses, and a JSON-LD block can carry an attacker's `sameAs` link or an invented rating. SW1-15's checks already refuse those for code-built drafts. SW2-13 extends the same functions to model-filled fields and adds the one artefact SW6's jobs need and no finding produces: an `llms.txt` draft may name only same-origin URLs that the run fetched with a 200.

**Approving from Telegram.** Section 4.6 promises one tap. That needs three things today's code lacks: a `callback_query` handler (the webhook subscribes to it, `scripts/telegram-setup.mjs:32`, and nothing handles it; it must sit before the `if (!msg) return` at `worker/telegramBot.ts:320-321`, or it is never reached); the notice of section 6.5; and an approval card that shows the Ops plan's `argsSummary`, because approving an argument-bound request without seeing the arguments is blind. The handler resolves the tapping Telegram user to an account, requires it to equal the request's account, and calls the same decide function as the route. A bearer credential still cannot approve.

**An agent opening a pull request, if decision 18 says yes.** A founder can already apply a fix with one click from the deploy screen, from their own browser with their own token (hazard 20). The question in decision 18 is narrower: may an agent start that, on the server, after one approval? The default is no. If yes, it is one path only:

- **Where.** A project with a connected GitHub repository. The connection is made like the Google one (section 9.1): bound to the signed-in account at the callback, the token encrypted with the connector crypto, and scoped to that one repository with contents and pull-request write and nothing else. `connector_grants.provider` allows `github` from its first migration for this reason.
- **What.** New files only, under paths the founder listed for that repository. Never an existing file, never `.github/`, never a workflow, a lockfile or a dependency manifest. A JSON-LD draft is a new file; a change to an existing `robots.txt` stays a draft the founder applies.
- **How.** One bound, single-use approval that shows the file path and the draft. One branch per finding and draft, named by code from their ids, so a step that runs twice finds its branch and its pull request instead of opening a second. The title and body are built by code and list the finding and its evidence; no model-written text is in either.
- **Then.** The pull request does nothing until the founder merges it. The re-check runs after they do.

This replaces nothing: the browser-side deploy screen stays, made honest by SW0a-17. WordPress and other direct writes by an agent are not offered in this plan.

**Coach.** Input: the project's open findings and, from SW4, the latest digest. v0 already proposes by a fixed order (SW1-18). SW2 adds one typed call that writes the reason in a sentence or two; the finding it names is still chosen by code, and the reason passes the output check or is replaced by the code-built one. Coach sends no Telegram message; it appears in the roster view and, when P10 exists, in Beacon.

**Roster view.** A new `SWARM` view built on the layout of `components/audit/AgentMissionControl.tsx:156-227`, restyled with design tokens (that file uses raw colour classes today). One card per agent: purpose, limits, month-to-date spend from the ledger, current run, last result, and pause. A feed of run events. An approvals strip. It polls every 5 s while visible; sockets arrive in SW7.

**Evals.** A new trajectory suite beside the seven text cases in `evals/`: recorded transcripts of each agent's typed call with the expected step order, guardrail outcomes and final state, including pages that carry planted instructions (one asks for a report to be saved, one for a paid tool to be called). The suite runs in CI and, new in this phase, in the deploy workflow, which runs no evals today (`.github/workflows/deploy-cloudflare.yml:44-57`).

A recorded transcript proves the code around the call, not the model (rule 2.22). So this phase also has a live gate, run by hand before promotion, once per model, and on any change of prompt, model, schema or check: the SW1-13 page set and its twin pairs, extended with 20 findings for Fixer and 10 projects for Coach, 3 live runs each, labelled the way SW1-13 labels. Required: every Fixer draft passes its artefact check; no draft contains a URL outside the run's evidence or the project's domain, counted before the check removes anything; in every injected run the canary string and the instructed action are absent from every model-filled field; every Coach reason names the finding code chose; unsupported sentences are at most 2 percent and none is harmful by the rubric; agreement between two labellers is at least 0.7. A deliberately broken prompt and a disabled artefact check must each fail the gate.

### 7.2 Migration `agent_passport_k1`

```sql
CREATE TABLE IF NOT EXISTS agent_clients (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('api_key','oauth','roster')),
  ref_id TEXT NOT NULL,
  label TEXT NOT NULL,
  purpose TEXT,
  model TEXT,
  risk_ceiling TEXT NOT NULL DEFAULT 'write' CHECK (risk_ceiling IN ('read','draft','write','destructive')),
  tool_allowlist_json TEXT,
  monthly_cap_cents INTEGER CHECK (monthly_cap_cents IS NULL OR monthly_cap_cents >= 0),
  approval_threshold_cents INTEGER CHECK (approval_threshold_cents IS NULL OR approval_threshold_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, kind, ref_id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  agent_client_id TEXT NOT NULL,
  project_id TEXT,
  purpose TEXT,
  budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
  per_call_cap_cents INTEGER CHECK (per_call_cap_cents IS NULL OR per_call_cap_cents >= 0),
  tool_scope_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','active','closed','exhausted','expired','revoked')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_client ON agent_sessions(account_id, agent_client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_open ON agent_sessions(status, expires_at)
  WHERE status IN ('pending','active');

ALTER TABLE cost_events ADD COLUMN session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_cost_events_session ON cost_events(account_id, session_id, created_at)
  WHERE session_id IS NOT NULL;
```

- One `ALTER`, not idempotent: confirm the file is unapplied before running (Zoro 2.5).
- The per-agent total is `SELECT COALESCE(SUM(cost_micro), 0) FROM cost_events WHERE account_id = ? AND credential_kind = 'roster' AND credential_id = ? AND created_at >= ? AND created_at < ?`. It was checked to use `idx_cost_events_credential`.
- The per-session total is `SELECT COALESCE(SUM(cost_micro), 0) FROM cost_events WHERE account_id = ? AND session_id = ?`. It names the account so that it uses `idx_cost_events_session` and can never read another account's rows.
- The existing account-window total (`worker/budgets.ts:331-335`) has no credential filter, so roster spend counts toward the account budget with no change to that query: it sees each run's settle row (section 4.4).
- The admission statement of section 6.1 gains one condition here: the agent's monthly cap, times 10,000, must cover the run's cap plus that agent's `SUM(cost_micro)` for the month plus the reservations of that agent's open runs.
- On account link, `agent_clients` rows of kind `roster` are not re-keyed: the surviving account keeps its own and the losing account's are deleted, because a cap is a setting, not history. Rows of kind `api_key` or `oauth` move with the key they name; deleting one would leave a live key with no limits. `agent_sessions` rows move, and each moved row's `agent_client_id` is re-pointed to the surviving account's client with the same `kind` and `ref_id`. A session whose client has no counterpart is set to `revoked` in the same batch, before its client row is deleted.
- `budget_policies` is not altered (Ops F4's rule).

### 7.3 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW2-0 | Re-baseline. Confirm P9 and P11 are on `main` and read their final shapes. Record decision 2. Ask decision 18 with what SW1 and SW0a-17 showed | this document | Section 7 corrected against the merged Ops code |
| SW2-1 | Migration; smoke lists; `SWARM_ROSTER_ENABLED` in three blocks, env typing, example env files, admin health and the capabilities answer; privacy export and delete; link rule above | `migrations/`; `scripts/smoke-check.mjs`; `wrangler.jsonc`; `worker/env.ts`; `worker/privacyService.ts`; link helper | Applies clean after `swarm_runs` and `token_meter`. A cross-account API-key insert changes zero rows (test). After a link, no session points at a client that does not exist |
| SW2-2 | Client and session service: create client, request, approve, close, expire; the three-limit check with reservation | new `worker/agentPassport.ts`; `worker/budgets.ts`; tests | A session request above the client's remaining month is refused with the remaining amount. Two concurrent steps that each fit alone but not together: exactly one runs. An expired session's next step ends the run `budget_halted` |
| SW2-3 | Roster manifest and default client rows created on first use; owner can edit cap, threshold, pause | new `services/swarm/roster.ts`; `worker/swarmService.ts`; route `/swarm/agents` | A new account sees three agents (Auditor, Fixer, Coach) with default limits and zero spend, and Sentinel as a status card. Pausing an agent refuses new runs and lets the current step finish |
| SW2-4 | `estimate_cost` and the `PAYMENT_REQUIRED` envelope (spec 0016 K2) on MCP and on run steps | `worker/mcpServer.ts`; `services/swarm/rateCard.ts`; tests | An estimate equals the cost row written by the same call on a fixture. A refused call names the limit that refused it |
| SW2-5 | Approvals inside runs through the F1 path, `kind = 'session'` and `kind = 'tool'`; wait, resume, expiry | `worker/swarmRun.ts`; `worker/mcpGovernance.ts`; tests | Approve: the run resumes within one alarm tick and the approval is consumed. Same approval reused by a second step: refused. Expiry: the step fails. A bearer credential cannot approve (existing F1 test extended) |
| SW2-6 | Moved. The server tool loop is built with the Prospector, the first agent that lets a model pick a tool (SW6-11) | none in this phase | Nothing in SW2 lets a model choose a tool (grep: no caller of a planner in `worker/swarmRun.ts`) |
| SW2-7 | Sealed trust for runs: stored at start, tightened on ingest, enforced on a call that leaves the account or spends, inherited by child runs | `worker/swarmRun.ts`; the F3 hook in `worker/mcpGovernance.ts` | Prompt-assembly tests: a page that asks for a pull request is ingested, the run is sealed, and the pull-request tool is refused without a bound approval; saving a draft is allowed and the draft passes its check; a child run started after the ingest is sealed too. None of these claims a model resisted anything (rule 2.22) |
| SW2-8 | Fixer's model-filled fields: one typed call, the field rules, and the fallback to an empty field | `services/swarm/fixTemplates.ts`; new `services/swarm/fixerFields.ts`; `worker/swarmRun.ts`; validators | A thin-content finding yields a draft whose paragraph passed the output check. A field carrying a URL outside the run's evidence is emptied and the draft says a field was left out. No row ever has `status = 'published'` (the CHECK also refuses it). A failed retest leaves the finding `in_progress` |
| SW2-9 | Coach's reason: one typed call over the finding code chose | `services/swarm/coachRank.ts`; `worker/weeklyDecisionService.ts` | The finding named is the one the fixed order chose, whatever the model returned. A reason that fails the output check is replaced by the code-built one and labelled so. With no open finding nothing is called and nothing is written |
| SW2-10 | Handoff with money: the child's cap is carved from the parent's remaining session, and the parent's `cap_micro` falls by the same amount in the batch that admits the child; events on both runs | `worker/swarmService.ts`; `worker/swarmRun.ts` | A child cannot be started for an agent outside `handoffTo`. A child cap above the parent's remaining budget is refused. After a handoff the parent's cap plus the child's equals the parent's cap before it. A handoff payload holding anything but typed ids is refused. A third level is refused, and so is a handoff to an ancestor. Provenance shows the parent link |
| SW2-11 | Roster view, registered at the six points a new view needs | `types.ts`; `App.tsx` (the lazy import, the render branch and the menu entry); `components/harness/OmnibarModal.tsx`; `services/telegram/startParam.ts`; `components/telegram/TelegramBottomNav.tsx:13-25`; `components/hub/EcosystemHubView.tsx`; new `components/swarm/RosterView.tsx` | Static-markup tests per card state. No new hex colour (the honesty gate fails typecheck on one). The view is absent from the public-view set in `services/auth/useAppAuth.ts:41-59` |
| SW2-12 | Trajectory evals in CI and in the deploy workflow; the live gate above, run by hand | `evals/`; `evals/live/`; `.github/workflows/ci.yml`; `.github/workflows/deploy-cloudflare.yml` | A transcript that skips the output check fails the suite. The deploy job fails when the suite fails. The live gate's report is attached to the promotion PR |
| SW2-13 | Artefact checks extended: SW1-15's functions cover model-filled fields, and an `llms.txt` check is added for SW6's jobs. Shared with SW6-2's acceptance checks | `services/swarm/draftChecks.ts`; `services/deployment/schemaSafetyGate.ts`; tests | A `robots.txt` draft that disallows `/` for `*` is refused. A JSON-LD draft with a `sameAs` off the approved list, or with a rating, is refused. A prose field containing markup or an off-evidence URL is refused. An `llms.txt` draft naming a URL the run did not fetch is refused. Each check has a passing and a failing fixture and never calls a model |
| SW2-14 | Telegram approve and deny: the `callback_query` handler placed before the message guard, the approval notice with `argsSummary`, the account match | `worker/telegramBot.ts:290,320-321`; `worker/mcpGovernance.ts`; `worker/notify.ts` | Approve from Telegram executes the bound call once. A tap from a Telegram user who does not own the request changes nothing and is audited. An expired request answers "Expired". The card shows the arguments summary and no raw arguments. An update that carries only a `callback_query` reaches the handler (today it returns early) |
| SW2-15 | A pull request opened by Fixer, only if decision 18 is yes (section 7.1). Starts with a spike on how the repository is connected (a GitHub App installation or a fine-grained token), since that decides what is stored | new `worker/fixDelivery.ts`; the connector crypto and `connector_grants` (SW4-1, SW4-2); `worker/mcpGovernance.ts`; tests | A pull request is opened only after a bound single-use approval and contains exactly the approved draft as a new file. A draft whose path is outside the founder's list, is an existing file, or is under `.github/` is refused before any call to GitHub. Running the step twice yields one branch and one pull request. The title and body contain no model-written text (asserted on a fixture whose draft carries planted text). A second use of the approval is refused. Without a connected repository the button is absent. No token is stored unencrypted or logged |

**Order:** SW2-0; SW2-1; SW2-2 to SW2-4; SW2-5 and SW2-7 (the security core, reviewed together); SW2-8 with SW2-13; SW2-9 and SW2-10; SW2-11; SW2-14; SW2-12 before any promotion. SW2-15 as soon as SW2-5, SW2-14 and the connector lane's SW4-1 and SW4-2 are done, if decision 18 is yes.

**SW2 double-check:** no path spends without a session (grep for `recordCostEvent` callers and confirm each roster call passes one); no roster agent has ceiling `destructive`; the prompt-assembly tests pass with the flags on and the regression suites the Ops plan names pass with them off; nothing in this phase lets a model choose a tool; copy says "swarm" only where two agents handed work to each other.

**Scripted soak:** sized by what it must cross (rule 2.18): one UTC month boundary for the agent cap, one session expiry, one approval expiry, one session exhausted mid-run, and one run of each agent per model on the rate card. The Ops plan's 14-day observe window for Sealed Lane is that plan's own criterion for P11 and is not repeated here.

**Promote when:** the trajectory suite is green on the release commit; the live gate passed for the model in use; the cap drill, approval drill and sealed-run drill above all pass on staging; no run in the soak spent above its session; refusals and code-built stand-ins are reported with n; the owner has approved one over-threshold session from Telegram and one from the web. Production order: migration and code with flags off; `SWARM_ROSTER_ENABLED` for the allow-list; then everyone.

**Rollback:** `SWARM_ROSTER_ENABLED` off hides the view and the model-written fields. The Auditor, Fixer's code-built drafts and Coach's code-built proposal keep working. Tables and the new column stay.

---

## 9. SW4 - Business Brain

**Goal:** the numbers a founder already has, in Search Console and Google Analytics, become rows that agents read and cite, next to everything else Luminara knows about the business.

**Needs:** decision 4 and the operator steps in 9.3 for the connectors (SW4-1 to SW4-5, SW4-8), which depend on neither SW1 nor the run engine and can run beside SW1a. P3 and P13 for the context assembler (SW4-6). SW1b promoted and decision 6 for the Analyst (SW4-7). Decision 29 before production.

### 9.1 Design

**Two tables for access, one for numbers.** A Google consent grant covers every property the user can see, so the token belongs to a grant, not to a property. `connector_grants` holds one encrypted refresh token per consent. `connector_sources` holds one row per property the user chose to attach to a project. `metric_snapshots` holds the numbers. The existing `gsc_oauth_tokens` table (one row per account, no reader) is left unused; nothing in this plan drops a table.

**OAuth flow.**

1. `POST /connectors/google/start` (signed in, on the web) creates a random `state` and a PKCE verifier, stores `{ accountId, userId, projectId, verifier }` under the hash of `state` for 10 minutes (where is settled below), sets a short-lived cookie holding a second nonce (`__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`), and returns Google's authorisation URL with `access_type=offline`, `prompt=consent` and the two read-only scopes.
2. `GET /connectors/google/callback` consumes the `state` record (single use), requires the cookie nonce to match it, requires the signed-in session's account to equal the account in the record, and exchanges the code with the verifier. The cookie binds the callback to the browser that started the flow and the session check binds it to the account, so an attacker cannot get a victim to attach the victim's Google data to the attacker's account, or the reverse.
3. The Worker lists what the grant can see (Search Console sites; Analytics account summaries) and the user picks which to attach.
4. `DELETE /connectors/grants/:id` revokes the token at Google, then deletes the grant, its sources and their snapshots.

Connecting happens on the web only, at first. The Mini App and the desktop app show the connection state and a line that says to connect on the web: a cookie set in one of them does not come back on a callback that opens in the system browser, so the binding above would not hold. A flow for them is designed, not built, in this phase: the callback page would show a one-time code, and the app that started the flow would submit it under its own signed-in session. It ships only after its own review.

Four points the flow above leaves open, settled in SW4-0 before SW4-3 is written:

- **Where `state` lives.** KV is eventually consistent, and the start and the callback can land in different locations seconds apart, so a KV read can miss a `state` that was just written and fail an honest connection. Either the `state` record goes in D1, or `state` is a signed value that needs no lookup and D1 holds only a single-use marker written by the callback. Either way "used once" is a conditional write, not a read followed by a delete.
- **Which Google account consented.** Adding the `openid email` scopes lets the Worker show "Connected as a...@example.com" on the attach screen and store a salted hash of Google's subject id, so the same Google account is recognised on reconnect. The plain subject id and the id token are not stored.
- **A Telegram-only founder cannot connect yet.** Connecting needs a web session, and a founder who has only ever signed in through Telegram has none: Telegram sign-in works only inside Telegram, where the app can present its init data. Until the one-time-code flow below ships, the Brain view tells such a founder plainly that connecting is not available to Telegram-only accounts yet, and offers account linking if they have a web sign-in. SW4-0 records how many launch accounts this leaves out.
- **The callback page** shows no token, sets no session, and offers a link back to the Mini App.

**Token storage.** AES-256-GCM with a key from a new secret, `CONNECTOR_TOKEN_KEY`, one per environment. A random 12-byte IV per row; the grant id and account id as additional authenticated data, so a ciphertext copied to another row fails to decrypt. The stored value carries a key id so the key can be rotated: new writes use the new key, reads try the id named in the row. Access tokens are never stored.

**Sync.** A new hourly cron (`15 * * * *`, mapped in `CRON_JOBS` in the same PR, because an unmapped cron runs every job) owns one job, `connector_sync`. Each tick takes the 25 sources synced longest ago and at least 20 hours ago. For each: refresh an access token, fetch, upsert, stamp `last_synced_at`. `invalid_grant` marks the grant `needs_reauth` and tells the owner in the app. Three failures in a row pause the source.

| Source | Daily totals (the last 5 finished days, re-fetched because both sources revise recent days) | Trailing 28 days |
|---|---|---|
| Search Console | clicks, impressions, CTR, average position | top 25 queries and top 25 pages by clicks |
| GA4 | sessions, engaged sessions, total users, key events | sessions by default channel group; top 25 landing pages |

Metric and dimension names are confirmed against each API's schema in SW4-0, not typed from memory. A property that returns no rows writes no rows; the Brain shows `not_measured` for it.

**Volume.** About 4 daily-total rows per source per day, kept 16 months, plus a few hundred trailing-window rows. A trailing window has a new `period_start` each day, so the upsert does not replace yesterday's: each sync deletes that source's older 28-day windows in the same batch (`DELETE FROM metric_snapshots WHERE source_id = ? AND period_days = 28 AND period_start < ?`). The 16-month purge runs in the existing `privacy_purge` job.

**The Analyst.** A fixed plan: load two complete 7-day windows, the later one ending on the last day the source treats as final, because both sources revise recent days and a window with an unfinished day in it compares nothing; compute the changes in code; pick the largest movers by a fixed rule that requires a minimum base in the earlier window (set in SW4-0 from real data), so that 1 becoming 3 is shown as counts and never as a percentage; then one typed model call that writes the digest around the handles it is given. The model writes handles, never digits (section 4.3): any digit or number word outside a rendered handle is a violation, whether or not its value appears in evidence. A difference between two rows is itself a handle, computed by code. A refused digest is retried once and then replaced by the code-computed table; the run completes either way. The digest is saved as a report, and up to five typed facts go to `memory_facts` with `kind` and `project_id` (P13). The Analyst has ceiling `read` plus those two writes and is `sealed`, because query strings and page titles come from outside.

**Brain view.** The existing `BrandMemoryView` (`components/suite/BrandMemoryView.tsx:166-173`) gains three tabs: "Sources" (connect, attach, disconnect, last sync), "Numbers" (a table of the latest totals with source and fetch time on every cell) and "Ship log". `GET /brain/:projectId/digest` returns what the context assembler would give an agent, so a founder can read exactly what the agents read.

**Consent and policy.** The consent screen at connect time says, in plain words, what is fetched, that it is stored as daily totals and top lists, that agents will read it, and that summaries of it are sent to the model provider that writes the digest. The privacy policy (`worker/privacyPolicy.ts`) and the Google OAuth verification submission say the same. Whether Google's user-data policy allows that last use for these scopes is a question for the verification review and for counsel (decision 6); until it is answered the Analyst's model call is off and the digest is the code-computed table alone.

**If decision 6 is yes, these hold.** A per-prompt tag is not enough, because connector numbers flow on into reports, facts and chat history, and from there into prompts that carry no tag. So the rule is per account: once an account has an active connector, every model call made for that account on a hosted key uses only routes on an allow-list, and fails closed otherwise. It is enforced in two places, because hosted calls leave by two doors: the model client that runs use, and the provider relay that browser chat uses (`worker/providerRelay.ts`). A call under the founder's own key is theirs to route, and never carries the snapshot block (section 4.5). An entry on the list is a provider, a key tier, its routing parameters, and the URL and date of the terms that exclude training on the data. A provider's unpaid tier whose terms allow use of content for product improvement is not on it, and a router is on it only with its "deny data collection" setting. Search queries and page titles are reduced to a safe character class and 80 characters before they are fenced. No test fixture is ever recorded from a prompt that held connector data. Connector data is never used to train or evaluate anything shared between accounts, and operators do not read it (rule 2.19 covers backups).

**Facts written by an agent are proposals.** The Analyst's facts, and facts extracted from chat, are stored with `status = 'proposed'` and are left out of every prompt until the founder approves them; a fact the founder types is `active` at once. Today the chat path writes straight to the store at a fixed confidence with no review (`worker/memoryRag.ts:291-334`). A fact can be edited, replaced (`supersedes_id`) and deleted, which no route allows today. An approved fact that came from a sealed run stays fenced in every prompt.

**Measuring whether retrieval is good enough.** V decision 3 keeps vector search off, and this plan agrees for now. So that the choice can be revisited on evidence, each prompt logs how many facts existed, how many were included and how many were cut, and SW4-10 builds a labelled set of 30 questions about the owner's own project. The choice is revisited when recall on that set falls under 0.9 or facts are cut in more than 5 percent of prompts; D1 full-text search is tried before a vector index.

### 9.2 Migration `brain_connectors`

```sql
ALTER TABLE memory_facts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'proposed', 'superseded', 'rejected'));
ALTER TABLE memory_facts ADD COLUMN source_ref TEXT;
ALTER TABLE memory_facts ADD COLUMN supersedes_id TEXT;
ALTER TABLE memory_facts ADD COLUMN origin_trust TEXT;
CREATE INDEX IF NOT EXISTS idx_memory_facts_status
  ON memory_facts(account_id, status, created_at);

CREATE TABLE IF NOT EXISTS connector_grants (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google','github')),
  external_subject_hash TEXT,
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  token_kid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reauth','revoked')),
  connected_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_grants_account ON connector_grants(account_id, provider);

CREATE TABLE IF NOT EXISTS connector_sources (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('gsc','ga4')),
  external_id TEXT NOT NULL,
  external_label TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','needs_reauth','removed')),
  last_synced_at INTEGER,
  last_error_code TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, project_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_connector_sources_due ON connector_sources(status, last_synced_at);
CREATE INDEX IF NOT EXISTS idx_connector_sources_grant ON connector_sources(grant_id);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  source_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('gsc','ga4')),
  metric TEXT NOT NULL,
  dim_kind TEXT NOT NULL CHECK (dim_kind IN ('total','query','page','channel','country','device')),
  dim_value TEXT NOT NULL DEFAULT '',
  period_start TEXT NOT NULL,
  period_days INTEGER NOT NULL CHECK (period_days IN (1, 7, 28)),
  value REAL NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, metric, dim_kind, dim_value, period_start, period_days)
);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_project
  ON metric_snapshots(account_id, project_id, source, metric, dim_kind, period_start);
```

- The snapshot write is an upsert on the full primary key that updates `value` and `fetched_at`, so a re-fetched day replaces itself.
- The due query is `SELECT id FROM connector_sources WHERE status = 'active' AND (last_synced_at IS NULL OR last_synced_at < ?) ORDER BY last_synced_at IS NOT NULL, last_synced_at LIMIT 25`.
- On account link, grants, sources and snapshots move to the surviving account. A `(project, source, external_id)` collision keeps the surviving account's row; the dropped source's snapshots are deleted with it, not left pointing at a source that no longer exists. The same delete runs whenever a source is removed.
- `provider` allows `github` from the start, because the list inside a CHECK cannot be widened later without rebuilding the table and SW2-15 may need it. No GitHub grant is written unless decision 18 is yes.
- The privacy export lists grants without the token column.
- The four `ALTER`s on `memory_facts` are not idempotent: confirm the file is unapplied before running (Zoro 2.5). The one with `NOT NULL DEFAULT 'active'` and a `CHECK` is accepted because every existing row takes the default; existing facts read as `active` and keep their `source` value (`hosted` or `chat`). In code that column also takes `agent`, `connector` and `audit`; it has no `CHECK`, so no schema change is needed.
- This migration applies before or after V's `scoped_memory`; the two add different columns. V's dedupe index is on `(account_id, project, content_hash)` and ignores `status`, so an identical fact already exists whenever a proposal's hash matches. In that case the proposal writes nothing and the row keeps the status it has: an `active` fact is already known, a `proposed` one is still waiting, and a `rejected` one stays rejected, so an agent cannot bring back what the founder refused by proposing it again.
- `external_subject_hash` is a salted hash of the provider's subject id, filled only if SW4-0 adds the `openid` scope. `origin_trust` is null for a founder's own fact and `sealed` for one an agent or a chat proposed (section 4.3). It is the only such marker in the schema.
- Snapshots hold search queries and page titles in `dim_value`. They are plaintext in D1, which is why rule 2.19 governs every dump of this database.

### 9.3 Operator steps

1. A Google Cloud project with the Search Console API, the Analytics Data API and the Analytics Admin API enabled; an OAuth consent screen with the two read-only scopes; redirect URIs for staging and production.
2. `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` set per environment (both are already typed, `worker/env.ts:178-179`); `CONNECTOR_TOKEN_KEY` generated and set per environment.
3. Publish the consent screen and submit it for verification. An app left in Testing is capped at 100 users and its refresh tokens expire after 7 days, which would break the daily sync, so staging must not be mistaken for proof that production will keep working.
4. Record what the Cloud Console says about each scope's class and the verification outcome in this document.

### 9.4 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW4-0 | Re-baseline; confirm P3 and P13; settle, with the owner, how the `business_memories` and `dream_proposals` tables that appeared on local `main` relate to `memory_facts` and SW4-11 (section 0.6); confirm metric and dimension names against both API schemas; record the scope classes; write the consent text and have the owner approve it | this document; a fixtures folder with recorded API responses | Section 9 corrected. The fixtures are the only source of field names in code |
| SW4-1 | Migration; smoke lists; privacy export without tokens; delete with revoke; link move; flags | `migrations/`; `scripts/smoke-check.mjs`; `worker/privacyService.ts`; link helper; `wrangler.jsonc`; `worker/env.ts` | Applies clean. Deleting an account calls revoke for each grant (spy) and leaves no rows |
| SW4-2 | Token crypto: seal, open, key id, rotation | new `worker/connectorCrypto.ts`; tests | A token sealed for one grant fails to open under another grant id. A row sealed with the previous key still opens after rotation. The plaintext never appears in a log line (log spy) |
| SW4-3 | OAuth start and callback, on the web: state, verifier, cookie binding, the session-account check; property listing and attach; disconnect | new `worker/connectors.ts`; `worker/index.ts`; `worker/authMiddleware.ts`; `worker/README.md` | A callback with a valid `state` and no cookie is refused. A callback whose session belongs to another account than the one that started is refused. A replayed `state` is refused, including when two callbacks arrive at once (the single use is a conditional write). A callback for account A cannot attach to account B's project. Secrets unset: every route returns `not_configured`. Start called from the Mini App or the desktop app is refused with the "connect on the web" code |
| SW4-4 | Fetchers for both sources against recorded fixtures; snapshot upsert; the delete of older 28-day windows; error mapping | new `worker/connectorSync.ts`; fixtures; tests | Fixture in, exact rows out. After two syncs on consecutive days one 28-day window remains per source. A 429 backs off and does not count as a failure. `invalid_grant` marks `needs_reauth` and stops syncing that grant |
| SW4-5 | Hourly cron and job mapping; batch of 25; pause after three failures; 16-month purge | `wrangler.jsonc:11-13`; `worker/scheduledJobs.ts:10-22`; `worker/index.ts:2059-2068`; `tests/scheduledJobs.test.ts` | The cron test names the new expression and job. The daily cron still runs exactly its three jobs. A source synced 2 hours ago is skipped |
| SW4-6 | Context assembler blocks for snapshots and ship notes; `GET /brain/:projectId/digest` | the V3 assembler in `services/`; new `worker/brain.ts` | Golden prompt test: both blocks present, fenced, within their caps. Another account's project returns 404 |
| SW4-7 | Analyst plan: the two complete windows, deltas and the minimum base in code, one typed model call behind decision 6, output check, facts as proposals | new `services/swarm/analystPlan.ts`; `worker/swarmRun.ts`; evals | A digest whose text states a number not in the handed table is retried once and then replaced by the code-computed table, labelled as code-built; the run completes. A window that includes a day the source has not finalised is not compared. A mover under the minimum base is shown as two counts. With decision 6 unanswered the run completes with the table and no model call |
| SW4-8 | Brain view tabs; connect and disconnect UI; the "connect on the web" note in the Mini App and on desktop | `components/suite/BrandMemoryView.tsx`; new `components/brain/`; new `services/brain/brainClient.ts` | Static-markup tests for connected, needs-reauth and empty states. Every number cell renders its source and fetch time. In the Mini App and on desktop there is no connect button, only the note |
| SW4-9 | Privacy policy and in-app consent copy | `worker/privacyPolicy.ts`; consent component | The policy names both scopes, the retention periods and the model-provider disclosure |
| SW4-10 | Retrieval measurement: per-prompt counts of facts available, included and cut; a labelled set of 30 questions about the owner's project | `services/oracle/` (the V3 assembler); `evals/` | The counts appear on each run's events. Recall on the set is recorded with its n and compared with the thresholds in 9.1 |
| SW4-11 | Fact proposals and review: agent and chat facts land `proposed`; approve, reject, edit, replace, delete; a review queue in the Brain view; an MCP write tool `propose_fact` that can only propose; at most 20 proposals per account per day; a proposal whose hash matches an existing fact writes nothing | `worker/memoryService.ts:33-99`; `worker/memoryRag.ts:291-334`; `worker/mcpServer.ts`; `worker/mcpGovernance.ts`; `components/brain/` | A proposed fact is in no prompt until approved (golden prompt test). No agent path can write an `active` fact. A fact the founder rejected is still `rejected` after an agent proposes the same text again. With `BRAIN_ENABLED` off, today's behaviour exactly |
| SW4-12 | The per-account provider allow-list of 9.1, enforced in the model client and in the provider relay | `worker/modelClient.ts` (from SW1-7); `worker/providerRelay.ts`; new `docs/ops/CONNECTOR-DATA.md` | For an account with an active connector, a hosted-key call routed to a provider that is not on the list is refused (test), on every path: runs, browser chat through the relay, and the Telegram bot. A call under the founder's own key is not refused and its prompt holds no snapshot block (golden prompt test) |
| SW4-13 | Live eval gate for the digest (rule 2.22), shaped like SW1-13: real snapshot sets from the owner's properties, twin sets with an instruction planted in a query string or a page title, 3 runs each, every run labelled | `evals/live/`; `scripts/soak-swarm.mjs` | Gate, all required, per model: every number a digest shows is a handle that resolves to a snapshot row or a computed difference; in every injected run the canary string and the instructed action are absent from the digest and from every proposed fact; the code-computed table stood in for the model's digest in at most 10 percent of runs; unsupported sentences are at most 2 percent and none is harmful by the rubric; agreement between two labellers is at least 0.7. A broken prompt and a disabled check must each fail it |

**Order:** SW4-0; SW4-1 with SW4-2; SW4-3; SW4-4 and SW4-5; SW4-8 and SW4-9; then, when their needs are met, SW4-6, SW4-10 and SW4-11; SW4-12 before SW4-7; SW4-7, then SW4-13 before the Analyst's model call is promoted.

**SW4 double-check:** grep for the refresh token column in every `SELECT` outside the crypto module; confirm no access token is written anywhere; confirm the daily cron's job list is unchanged; confirm a disconnected grant leaves no snapshot; confirm the Analyst prompt contains fenced content only.

**Scripted soak:** 8 days on staging with the owner's own properties attached, and the consent screen published (not in Testing). Eight, not seven, because a refresh token from an app left in Testing dies on day 7 and the soak has to outlive that (rule 2.18).

**Promote when:** eight consecutive daily syncs succeeded for both sources with no re-consent; the numbers in the Brain view match the same days in Google's own interfaces (owner check, recorded); disconnect removes the grant at Google (owner check in their Google account); verification is approved, or decision 29 records that the owner accepts the unverified-app user cap. The Analyst's model call is promoted separately, after SW4-13 and decision 6.

**Rollback:** `CONNECTORS_ENABLED` off stops new connections and the sync job; existing rows stay readable until the owner chooses to purge them. `BRAIN_ENABLED` off hides the tabs.

---

## 10. SW5 - Pay-per-audit for outside agents (x402)

**Goal:** an AI agent with no Luminara account can pay a small fixed price for one audit over plain HTTP and get an evidence-backed result. This is the concrete answer to "agentic commerce".

**When.** After SW6, and only on a trigger: two outside parties ask in writing for pay-per-call access, or the owner chooses to launch it as a surface in its own right (decision 5). Until then this section is a design with one spike done. It was moved behind Jobs in v0.3 because nobody has asked for it yet and Jobs serve founders who are already here.

**Needs:** SW1a promoted; the trigger; decision 5; the operator steps in 10.3.

### 10.1 Design

**What is sold.** One "scout audit" of one public URL: the SW1 Auditor's fixed steps with a smaller page budget (at most 6 fetches) and no model call, so it finishes inside one request. The response is JSON: findings with rule ids and evidence refs, and the evidence list with hashes and fetch times. When receipts are on (P14) it also carries the id of an `audit_run` receipt the caller can verify at `/verify/r/<id>`.

**Wire format: x402 version 2, `exact` scheme, USDC.** On EVM networks `exact` is an EIP-3009 `transferWithAuthorization`: the caller signs permission to move exactly this amount to exactly this address before a time they choose (`validBefore`), with a nonce that can be used once.

1. `POST /x402/audit` with `{ "url": "..." }` and no payment returns 402 with a `PAYMENT-REQUIRED` header (base64 JSON): one accepted option naming the scheme, the network as a CAIP-2 id, the asset, the amount in base units, `payTo`, a timeout, and `extra.name` and `extra.version` for the asset's signing domain. The body repeats it as JSON for humans.
2. The caller retries with `PAYMENT-SIGNATURE`. A payload that does not decode is a 400.
3. **Local checks, before any call to a facilitator:** the network, asset, `payTo` and amount equal ours; `validBefore` is at least the audit deadline plus a settle margin away (60 s plus 60 s). The reference client sets `validBefore` to now plus the timeout the seller advertised, so the advertised timeout is 180 s, not 60: with 60, an authorisation would already be past its expiry when a slow audit came to settle. A failed check is a 402 with the reason.
4. The Worker asks the facilitator to **verify**. Invalid: 402 with the reason.
5. The Worker **records** the payment as `verified`, unique on `(network, asset, payer, nonce)`. A second arrival of the same authorisation inserts nothing and is answered from the row that exists (below).
6. The audit runs under a 60 s deadline. If it fails or times out, the row becomes `work_failed`, nothing is settled, and the caller is not charged.
7. Only if the audit produced a result does the Worker settle, and it writes its intent first: one update stores the result against the payment and moves the row to `settle_pending`. Then it asks the facilitator to **settle**.
   - Settled: the row becomes `settled`; 200 with the result and a `PAYMENT-RESPONSE` header.
   - Anything else, whether a refusal, "pending", a timeout, an error or a crash: the row stays `settle_pending`. A refusal is answered with 402 and a `PAYMENT-RESPONSE` carrying `success: false`; the others with 202 and `Retry-After`. No answer but "settled" carries findings, and none is treated as final. The spec names `settlement_pending` as a result that is not final, and a refusal is not final either: anyone who holds an EIP-3009 authorisation can submit it, so "refused" for a nonce that is already used can mean the payer has in fact paid.

**Only a chain read ends a pending payment.** A reconciler takes every `settle_pending` row, and every row still `verified` after 3 minutes (a crash between the audit and the intent write). It reads the asset contract's own record of that payer's nonce and, when the nonce is used, the transaction that used it. Those are reads, not transactions, and need no key.

| What the chain says | The row becomes |
|---|---|
| Nonce used, and that transaction moved the amount to `payTo` | `settled`; the stored result is released |
| Nonce used, and no such transfer (the payer cancelled the authorisation, or it was spent elsewhere) | `settle_failed`; nothing was received |
| Nonce unused, and `validBefore` has passed | `expired`; nothing is owed |
| Nonce unused, and still valid | Unchanged; read again |
**Sending the same authorisation again** is how a caller who lost the response gets it back, so the answer depends on the row: `settled` returns the stored result (kept 24 hours); `verified` or `settle_pending` returns 202 with `Retry-After`; `work_failed`, `settle_failed` or `expired` returns 402 with the reason, and the caller signs a new authorisation. One authorisation can never produce two audits or two settlements, however its bytes are encoded, because the key is the signed nonce and not a hash of the payload.

So the caller pays only for a delivered result, and Luminara releases a result only for a settled payment. The Worker never holds a key: the caller signs, and the facilitator submits.

**The asset is pinned, not discovered.** Spike SW5-0 found that a facilitator's `/supported` answer lists kinds, extensions and signers and carries no asset address or decimals. So the asset address, its decimals and its signing-domain name and version are pinned in configuration per network, taken from the issuer's published list, cross-checked against the `@x402/evm` package's own table by a unit test, and confirmed by the owner. The domain name differs by network (`USDC` on Base Sepolia, `USD Coin` on Base; version `2` on both), so a pin copied from one to the other fails every signature. At start-up the rail stays off unless `/supported` lists version 2, the `exact` scheme and the configured network.

**Why not reuse `worker/q402`.** That code is version-1 shaped, uses custom `ton/*` and `xdc/*` schemes where the client pays on-chain first and presents a transaction hash (`worker/q402/types.ts:8-57`), and its settle path has the defects in hazard 5. It stays off, and SW0a-2 turns its routes into 404s. The new rail lives in `worker/x402/` with a README that says how the two differ. If the owner later wants x402 on TON, the standard now has a TON `exact` scheme, but no production facilitator runs it, and self-hosting one needs a funded wallet, which rule J1 forbids (SW10).

**Libraries.** `@x402/core` and `@x402/evm` 2.28.0 (Apache-2.0). Spike SW5-0 bundled and ran them under local workerd at this repo's compatibility date: the seller route cost about 164 KB raw, 30 KB gzip, most of it a second copy of the schema library the packages depend on at an older major version. Imports are narrow: `@x402/core/http`, `@x402/core/types` and `@x402/evm/exact/server`. The root of `@x402/evm` is never imported; it pulls in several hundred modules of a chain library the seller side does not need. Fixtures are the worked examples in the HTTP transport specification, which the spike decoded correctly with the package; the specification ships no separate test vectors.

**MCP.** A second, unauthenticated MCP endpoint, `/x402/mcp`, exposes exactly one tool, `scout_audit`, using x402's MCP transport: an unpaid call returns `isError: true` with the requirements both in `structuredContent` and as a JSON string in `content[0].text`; the client retries with the payment in `_meta["x402/payment"]`; the settlement comes back in `_meta["x402/payment-response"]`. The existing `/mcp` endpoint and its plan gate do not change.

**Abuse.**

- The route fetches caller-chosen URLs, so every fetch goes through the P17 wrapper and the existing host checks, and the per-site limits of section 4.4 apply to it.
- Verification happens before any fetch, so an unpaid caller costs one facilitator call at most; the 402 itself costs nothing.
- An authorisation that verifies and is then never settled costs an audit. So verified-and-unsettled attempts are counted per payer address and per IP, and a small number an hour (set in SW5-5) is the limit.
- Limits: the high-cost rate limiter per IP; 30 paid audits per payer address per hour; 4 running at once across the service; a daily count cap. Each has a variable and each refusal has a code.
- A result for the same URL within 10 minutes is served from cache with its original fetch times shown.

**Where it appears.** On its own hostname, and nowhere else. The x402 routes and their docs page answer only on a separate hostname the operator points at the same Worker; on the main hostname every `/x402/*` path is a 404. Telegram allows crypto features in a Mini App only on TON, so a surface that takes USDC on another network must not be reachable from one: a test asserts that no page in the Mini App bundle, no bot message and no start parameter contains that hostname.

**Money and records.** Revenue arrives at an address the owner controls (decision 5). `x402_payments` is the record. It has no account id and is in no account export (a stated exception to rule 2.6). A payer address can be personal data: after 24 months it is replaced in the row by a salted hash, and the row is kept as a revenue record for as long as the accountant says (decision 5). The Worker cannot return a payment. If one ever settles with no result delivered, it is listed for the owner, who returns it from their own wallet.

### 10.2 Migration `x402_payments`

```sql
CREATE TABLE IF NOT EXISTS x402_payments (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  payer TEXT NOT NULL COLLATE NOCASE,
  nonce TEXT NOT NULL COLLATE NOCASE,
  valid_before INTEGER NOT NULL,
  resource TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified','settle_pending','settled','settle_failed','work_failed','expired')),
  settle_tx TEXT,
  result_ref TEXT,
  facilitator TEXT NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE (network, asset, payer, nonce)
);
CREATE INDEX IF NOT EXISTS idx_x402_payments_payer ON x402_payments(payer, created_at);
CREATE INDEX IF NOT EXISTS idx_x402_payments_status ON x402_payments(status, created_at);
```

- `amount` is a decimal string of base units. No floating point touches money (the q402 code's float conversion is one of hazard 5's defects).
- Insert with `ON CONFLICT(network, asset, payer, nonce) DO NOTHING`. One row inserted: this request owns the payment. None: read the existing row and answer from it.
- Intent, before the settle call is made: `UPDATE x402_payments SET status = 'settle_pending', result_ref = ?, updated_at = ? WHERE id = ? AND status = 'verified'`. One row changed, then the call.
- Settle: `UPDATE x402_payments SET status = 'settled', settle_tx = ?, settled_at = ?, updated_at = ? WHERE id = ? AND status IN ('verified','settle_pending')`; release the result only when one row changed.
- Only the reconciler writes `settle_failed` or `expired`, each as a conditional update on `status IN ('verified','settle_pending')`, and only after the chain read of section 10.1.
- An audit that failed or timed out: `UPDATE x402_payments SET status = 'work_failed', error_code = ?, updated_at = ? WHERE id = ? AND status = 'verified'`. A row the route never got to mark, because it crashed, is the reconciler's after 3 minutes, so no row answers 202 for ever.
- `payer` and `nonce` are hex strings that arrive in any case. Both columns compare without case, and both are lower-cased before the insert, so `0xABC` and `0xabc` are one authorisation.
- When the payer is minimised after 24 months, `settle_tx` is cleared in the same update: a transaction hash names the payer as surely as the address does.
- `result_ref` names the stored result (R2, 24 hours). It is cleared when the result is deleted.
- Paid runs are written to `swarm_runs` under the fixed account id `sys:x402`, `kind = 'paid_audit'`, `origin = 'x402'`, `plan_class = 'paid'`, so the sweeper and alerts cover them.

### 10.3 Operator steps

1. **Owner:** provide the receiving address for Base (decision 5). It is a public address, set as a `var`. The agent never sees, generates or holds its key.
2. **Owner:** choose the production facilitator. Some need an account and a key, set as a secret; some need neither. Staging uses the public test facilitator, which answers for the test network only.
3. **Operator:** point the separate hostname at the Worker.
4. Set per environment: `X402_NETWORK` (the test network on staging), `X402_PAY_TO_ADDRESS`, `X402_PRICE_BASE_UNITS`, `X402_FACILITATOR_URL`, `X402_HOSTNAME`, a read-only RPC URL for the reconciler, and the asset pins (address, decimals, domain name and version). The owner confirms the pins against the issuer's page.
5. **Owner drill, staging:** pay for one audit from the owner's own test wallet with a standard x402 client; then one whose settlement is forced to time out, to watch the reconciler finish it. The agent sends no transaction (rule 2.11).

### 10.4 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW5-0 | Re-baseline and spike. **Done on 2026-10-10, in a scratch directory outside the repo:** the two packages bundle and run under local workerd with narrow imports; the 402 header round-trips; the test facilitator's `/supported` was read (no asset address; Base Sepolia only). **Still to do, when the phase starts:** re-read the specification at its then-current commit; measure the scout audit's duration on staging with n; with the owner, one verify and one settle on the test network (the spike called neither, since both need a payer's signature); read `decimals()` from the asset contract and compare it with the pin | this document; a scratch directory | Section 10 corrected. If the measured p95 does not fit the 60 s deadline, the page budget is lowered before any code is written. The pins are recorded with their source URL and date |
| SW5-1 | Migration; smoke lists; the 24-month payer minimisation; flag and vars in three blocks | `migrations/`; `scripts/smoke-check.mjs`; `worker/scheduledJobs.ts`; `wrangler.jsonc`; `worker/env.ts` | Applies clean. A row older than 24 months keeps its amount and status and no longer holds the payer address. A second insert of one `(network, asset, payer, nonce)` changes nothing |
| SW5-2 | Requirements builder, with `extra.name` and `extra.version` and the pinned asset, and header codec; `GET /x402/supported` | new `worker/x402/requirements.ts`; `worker/x402/README.md`; tests against the worked examples in the HTTP transport specification | The 402 header round-trips through the reference decoder. Amount is a string of base units. Network is a CAIP-2 id. A unit test asserts each pin equals the package's own table. No file imports the root of `@x402/evm` (grep in the test) |
| SW5-3 | Facilitator client: the three calls (verify, settle, supported); timeouts; the start-up check; a mock for tests | new `worker/x402/facilitator.ts`; `tests/helpers/` | Verify false: no row. Verify times out: 503, no row. `/supported` missing the configured network: every x402 route returns 503 `rail_off`. The mock is the only facilitator any automated test talks to |
| SW5-4 | Route: decode, local checks, verify, record, run, store, settle, release; the scout audit as a synchronous use of the SW1 steps | new `worker/x402/auditRoute.ts`; `worker/swarmRun.ts`; `worker/index.ts` | A malformed payload is a 400. A `validBefore` 90 seconds away is refused before any facilitator call. The same authorisation sent twice, including re-encoded with different bytes: one audit, one settlement, and the second call gets the stored result. Audit fails: no settle call (spy), status `work_failed`. The row is `settle_pending`, with its result stored, before the settle call is made (spy on call order). Settle refused: 402 with `success: false`, no findings, and the row is still `settle_pending`. Settle times out: 202, `settle_pending`, no findings. Flag off: 404 |
| SW5-5 | Limits and cache; codes for each refusal; the verified-and-unsettled count | `worker/x402/auditRoute.ts`; `worker/securityHardening.ts` | A private-network URL is refused before verification. The 31st paid call from one payer in an hour is refused before verification. A payer over the unsettled limit is refused before verification. A fifth concurrent audit gets 503 with `Retry-After` |
| SW5-6 | MCP endpoint with the one paid tool | new `worker/x402/mcp.ts`; `worker/index.ts` | An unpaid call returns `isError: true` with the requirements in both places the transport names. A paid call returns the result and the settlement in `_meta`. `/mcp` behaviour is unchanged (existing tests) |
| SW5-7 | The separate hostname: routes and docs page answer only there; `llms.txt` entry on that host | `worker/index.ts`; new docs page; `utils/marketingRoutes.ts` | On the main hostname every `/x402/*` path is a 404. A test asserts the hostname appears in no file of the Mini App bundle, in no bot message and in no Telegram start token |
| SW5-8 | Alerts: settle-failed rate, work-failed rate, rows in `settle_pending` older than 15 minutes, daily count at 80 percent | `worker/scheduledJobs.ts` | Each alert fires once per window on a fixture |
| SW5-9 | The reconciler on the ops cron: for each `settle_pending` row, and each row still `verified` after 3 minutes, read the authorisation's state and the transaction that used it, and move the row as section 10.1's table says | new `worker/x402/reconcile.ts`; `worker/scheduledJobs.ts`; tests with a fake RPC | Nonce used and transfer present: `settled`, and a repeat of the request returns the result. Nonce used and no transfer to `payTo`: `settle_failed`. Nonce unused and `validBefore` passed: `expired`. Nonce unused and still valid: unchanged. A row left `verified` by a crash is picked up after 3 minutes and ends in one of those four. The RPC failing changes nothing. No code path in `worker/x402/` moves a row from `settle_pending` to `settle_failed` without a chain read (grep and test) |

**Order:** SW5-0; SW5-1; SW5-2 and SW5-3; SW5-4 with SW5-9 (reviewed together as a money change); SW5-5; SW5-6; SW5-7; SW5-8.

**SW5 double-check:** grep `worker/x402/` for any private key, signer or `sendTransaction`; confirm no import from `worker/q402/` and none from the root of `@x402/evm`; confirm no number in the route is a float; confirm no Telegram-reachable surface names the x402 hostname.

**Staging soak:** sized by what it must cross (rule 2.18): at least 10 audits paid by the owner from their own test wallet, one forced settle timeout finished by the reconciler, one authorisation left to expire, and one repeat of a settled request. Automated checks run against the mock.

**Mainnet gate (all required):** decision 5 answered yes, including the owner's explicit yes that taking USDC on Base sits beside the rule that LORA is the one token; the owner's receiving address recorded and confirmed by a test payment on the test network to the matching test address; the asset pins confirmed by the owner; the production facilitator chosen and reachable; counsel and an accountant have answered decision 5's questions about taking stablecoin revenue and how long its records are kept; the price is at or above the measured cost per audit plus the facilitator fee; the soak met its criteria. Production then gets code with the flag off, and the flag is its own release.

**Rollback:** flag off returns 404 on every x402 route at once. Before it is turned off, `settle_pending` is left to drain; the admin health block shows the count, and the reconciler does not depend on the flag. An authorisation that was never settled simply expires. A payment that settled with no result delivered is listed for the owner (section 10.1).

---

## 11. SW6 - Jobs: fixed-price work, kept only on a passed check

**Goal:** the brief's "replacement for services" in the shape TN6 already approved: a founder picks a job, sees its price and its acceptance check before paying, and keeps their money unless the check passes. Luminara is the seller of every job. No third party is paid.

**Needs:** SW2 promoted; SW0a-3, SW0a-4 and SW0a-16 in production (P18); P14; decisions 1, 16, 23 and 32. Starts with a re-baseline (SW6-0). It runs before SW5.

### 11.1 Design

**What a paid job adds.** The free chain already drafts one fix per finding from a template. A job is sold only if it does more than that: it covers the whole site in one deliverable, or includes fields a model writes and a check passes, or is done by a person. SW6-0 writes that sentence for each SKU. A SKU that cannot say it is not sold.

**Catalogue.** Typed data in code (`services/swarm/jobCatalogue.ts`): `sku`, version, title, the agent that does it, the deliverable, the acceptance check id, the price in Stars, and the measured cost. The first three SKUs come from TN6's table:

| SKU | Agent | Deliverable | Acceptance check (deterministic) |
|---|---|---|---|
| `schema_fix_pack` | Fixer | JSON-LD blocks for the site's entity | Each block parses and validates; `sameAs` lists only links with a receipt |
| `ai_crawler_policy` | Fixer | `robots.txt` rules, and an `llms.txt` file if SW6-0 keeps it | Both parse; each named crawler is allowed or blocked as the order asked |
| `competitor_brief` | Prospector | A report through `save_report` | Every metric cites evidence or reads `not_measured` |

Two notes on that table. TN6's check for `ai_crawler_policy` also required the live site to show the new rules. The deliverable is a draft the founder ships, so at delivery the live site cannot yet show it; this plan's check drops that condition, and the re-check after the founder ships covers it (section 19 records the edit). And the compiled AI-search playbook records that Google calls `llms.txt` ineffective; SW6-0 decides with the owner whether that file stays in a paid SKU, and if it stays the listing says what it is and is not known to do.

Prices are set in SW6-0 from the cost per run measured in SW2, never before. The two one-off Stars SKUs that exist today (`worker/telegramBot.ts:83-108`) are not changed.

**Order flow.**

```
quoted -> pending_payment -> paid -> running -> checking -> delivered
                               |         |           \-> failed -> refunded
                               |         \-> failed -> refunded
                               \-> failed -> refunded      (no run by due_at)
delivered -> refunded                        (an operator, from the support queue)
quoted | pending_payment -> expired | cancelled
```

1. `POST /jobs/quote` creates a row with the price copied from the catalogue and a 15-minute expiry. The response shows the price, the check, and the worst-case time.
2. `POST /jobs/:id/checkout` returns a Stars invoice whose payload is `job:<jobId>`.
3. **Pre-checkout** (the 10-second answer Telegram requires): the payload names a job that is `pending_payment` and unexpired, the currency is XTR, the amount equals the job's `price_stars`, and the payer's Telegram id equals the job's `payer_tg_id`. Today's handler takes the price from a plan table and the user id from the payload (`worker/telegramBot.ts:293-308`, `:326-329`); the job branch binds both to the row instead.
4. **Payment** uses the one charge ledger SW0a-3 created (section 5.1), with `purpose = 'job'`. The charge row is written first, as `received`, and the webhook takes its lease (section 5.1, step 3). Then one batch: move the job to `paid` with a conditional update that stores the charge id and sets `due_at`; and move the charge to `credited` only if that job update matched. Then start the run. If the job update matched nothing (the quote expired, the job was already paid, the payer differs), the charge becomes `refund_due`. A crash at any point leaves a charge that is still `received`, which the sweep settles by what is true: credited if a job names it, refunded if none does. A second, late or stray charge for the same job is refunded.
5. The run does the work under a session whose budget is the SKU's measured cost plus a margin. Then the acceptance check runs.
6. **Pass:** `delivered`, with an `agent_job_delivered` receipt. **Fail, or no result by `due_at`:** one batch moves the job to `failed` and its charge from `credited` to `refund_due`. The sweep of section 5.1 refunds it to the stored payer; the job becomes `refunded` when its charge does. Delivery and failure are each a conditional update on the job's current state, so a timeout that failed a job cannot be overtaken by a late delivery, and a delivery cannot be followed by an automatic refund.

**"Always results", stated honestly.** The promise is not that every job succeeds. It is that a job either passes the check the buyer saw before paying or is refunded in full without the buyer asking. A buyer who is unhappy with a job that passed can ask for one redo within 7 days. A redo is its own job row that names the first (`redo_of`), costs nothing, and can exist once. If the redo also disappoints, it goes to a person at Luminara Digital through the support queue, who can refund it.

**Human fulfilment.** A SKU may be marked `fulfiller = 'human'` (TN6). It follows the same states, the same check and the same refund rule; the work is done by Luminara Digital staff from an admin queue with a `due_at`.

**Rails.** Stars only in this phase, and sold only inside Telegram at first (decision 32). Inside the Mini App that is required (section 0.3, item 3). On the web the checkout hands off to the Mini App, as plan checkout already does. TON is not offered for jobs: there is no way to refund TON without holding a key. `plan_credit` is reserved in the schema for jobs included in a plan (decision 16) and has no code in this phase.

**Operational rule for refunds.** A refund is paid from the bot's Star balance. The owner does not withdraw below the total of charges on jobs that are not yet `delivered`. SW6-7 reports that total.

**What a refund can and cannot promise.** Telegram takes a refund out of the bot's balance, and a balance can be emptied by a withdrawal. So only the check that runs at delivery carries the automatic refund; the 7-day redo is a redo, not a second refund window. An alert fires when the balance falls under the total of undelivered charges. SW6-0 tests, on the staging bot, a refund with too low a balance, a second refund of the same charge, and a refund to a payer whose account is gone, and this section is corrected to what was seen.

**Disputes reach a person.** Telegram makes the seller responsible for disputes. SW0a-16 already turns the reply to `/paysupport` into a support request a person reads. SW6-10 lets an operator refund from that queue, which is the one path from `delivered` to `refunded`, and adds the refund rule to the Terms. Whether jobs sold to Australian and New Zealand buyers carry GST is decision 23, with an accountant.

**Buying from the web or the desktop.** Jobs are paid in Stars, which exist only inside Telegram. On the web and in the desktop shell the pay button is a link that opens the Mini App on the quote, through a new `job_<id>` start parameter. Inside Telegram no screen links to any other way to pay (SW0a-6).

**The kill switch never drops a payment.** With `AGENT_JOBS_ENABLED` off, new quotes and checkouts are refused, and a `job:` payment that still arrives is processed as usual: recorded, then refunded.

**A job is not a quest.** Buying or receiving a job completes no quest, raises no level and opens no room (section 14).

### 11.2 Migration `agent_jobs`

```sql
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  sku_version INTEGER NOT NULL,
  fulfiller TEXT NOT NULL DEFAULT 'agent' CHECK (fulfiller IN ('agent','human')),
  status TEXT NOT NULL CHECK (status IN ('quoted','pending_payment','paid','running','checking','delivered','failed','refunded','cancelled','expired')),
  rail TEXT CHECK (rail IS NULL OR rail IN ('stars','plan_credit','redo')),
  price_stars INTEGER,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  payer_tg_id INTEGER,
  stars_charge_id TEXT UNIQUE,
  redo_of TEXT,
  run_id TEXT,
  session_id TEXT,
  input_json TEXT NOT NULL,
  check_result_json TEXT,
  deliverable_ref TEXT,
  receipt_id TEXT,
  quote_expires_at INTEGER NOT NULL,
  due_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (rail IS NOT 'stars' OR COALESCE(price_stars, 0) > 0),
  CHECK (rail IS NOT 'stars' OR payer_tg_id IS NOT NULL),
  CHECK (status NOT IN ('paid','running','checking','delivered','failed','refunded')
         OR (rail IS NOT NULL AND due_at IS NOT NULL)),
  CHECK (status NOT IN ('paid','running','checking','delivered','failed','refunded')
         OR rail IS NOT 'stars' OR stars_charge_id IS NOT NULL),
  CHECK (status <> 'refunded' OR rail IS 'stars'),
  CHECK ((rail IS 'redo') = (redo_of IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_account ON agent_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_open ON agent_jobs(status, updated_at)
  WHERE status IN ('paid','running','checking','failed');
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_one_open ON agent_jobs(account_id, project_id, sku)
  WHERE status IN ('pending_payment','paid','running','checking');
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_one_redo ON agent_jobs(redo_of)
  WHERE redo_of IS NOT NULL;
```

There is no second charge table. Every statement below is on `agent_jobs` or on `stars_charges` from section 5.1, and each must change exactly one row to count (rule 2.8).

- **Record the charge:** `INSERT INTO stars_charges (charge_id, payer_tg_id, account_id, purpose, ref_id, stars, status, created_at, updated_at) VALUES (?, ?, ?, 'job', ?, ?, 'received', ?, ?) ON CONFLICT(charge_id) DO NOTHING`. The shared `stars_credited_charges` claim is not used for jobs: the charge row's primary key is the claim.
- **Take the charge's lease,** exactly as section 5.1's step 3 does. The three statements that follow name that lease.
- **Pay the job, first statement of one batch:** `UPDATE agent_jobs SET status = 'paid', stars_charge_id = ?, due_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_payment' AND quote_expires_at > ? AND payer_tg_id = ? AND EXISTS (SELECT 1 FROM stars_charges WHERE charge_id = ? AND status = 'received' AND lease_until = ?)`. The last condition stops a job becoming `paid` on a charge the sweep has already moved.
- **Credit the charge, second statement of that batch:** `UPDATE stars_charges SET status = 'credited', lease_until = NULL, updated_at = ? WHERE charge_id = ? AND status = 'received' AND lease_until = ? AND EXISTS (SELECT 1 FROM agent_jobs WHERE id = ? AND stars_charge_id = ?)`. If the job update matched no row, this one matches none either. The run starts only when both statements changed one row.
- **If it did not credit:** `UPDATE stars_charges SET status = 'refund_due', refund_reason = 'job_not_payable', lease_until = NULL, updated_at = ? WHERE charge_id = ? AND status = 'received' AND lease_until = ?`.
- **Fail a job, as one batch:** `UPDATE agent_jobs SET status = 'failed', check_result_json = ?, updated_at = ? WHERE id = ? AND status IN ('paid','running','checking')`, then `UPDATE stars_charges SET status = 'refund_due', refund_reason = ?, lease_until = NULL, updated_at = ? WHERE charge_id = ? AND status = 'credited' AND EXISTS (SELECT 1 FROM agent_jobs WHERE id = ? AND status = 'failed')`.
- **Close the job from the charge's side, when its refund has gone:** `UPDATE agent_jobs SET status = 'refunded', updated_at = ? WHERE id = ? AND status IN ('failed','delivered') AND EXISTS (SELECT 1 FROM stars_charges WHERE charge_id = ? AND status = 'refunded')`. The sweep runs it for every job charge it refunds, so a refund made by any path (a failed check, an operator, the `/refund` command) closes its job.
- **An operator's refund of a delivered job:** `UPDATE stars_charges SET status = 'refund_due', refund_reason = 'operator', lease_until = NULL, updated_at = ? WHERE charge_id = ? AND status = 'credited'`. The sweep refunds it and the statement above closes the job.
- **A redo:** an insert that selects from the first job only when it is `delivered`, its `delivered_at` is within 7 days, and it is not itself a redo; `idx_agent_jobs_one_redo` allows one. A redo has `rail = 'redo'` and no charge, so it can never be `refunded` (the fifth CHECK): it ends `delivered` or `failed`.
- `stars_charge_id` is unique, so one charge can never pay two jobs. `idx_agent_jobs_one_open` allows one unpaid or in-flight job per account, project and SKU, so two invoices for the same thing cannot both be paid.
- Every sweep that reads open jobs repeats `idx_agent_jobs_open`'s exact predicate, `status IN ('paid','running','checking','failed')`, or the planner will not use the index. A sweep that reads `failed` jobs also asks for `rail = 'stars'`: a failed redo or plan-credit job has no charge to wait for and would otherwise be read on every tick.
- The charge row is the only record of refund state; `agent_jobs` has no refund column to disagree with it. A job on the `plan_credit` rail has no charge and so can never be `refunded`; it ends `failed` and its credit is returned by the plan's own count.
- Nothing in SQL stops a status moving backwards. Order is enforced by every update naming the state it expects (rule 2.8), and SW6-3 has a test that walks each illegal transition.
- **Deleting an account that has money in flight.** A deletion request from an account with a job that is `paid`, `running` or `checking`, or a charge that is `received` or `refund_due`, is accepted at once and finished in two steps: those jobs are failed and their refunds queued in the same batch, and the account's data is deleted once none of its charges is `received` or `refund_due`, at most 7 days later. The person is told this when they ask. Charge rows are kept with `account_id` set to NULL (section 5.1).
- On account link, jobs move to the surviving account. If both accounts hold an open job for the same project and SKU, the losing account's unpaid one is cancelled first; a paid one cannot collide, because a project belongs to one account.
- The table name and the flag `AGENT_JOBS_ENABLED` are the ones the TN plan reserved. The flag follows rule 2.3 (`"true"` or `"false"`).

### 11.3 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW6-0 | Re-baseline. Re-check sections 1 and 11 against `main`; confirm SW0a-3, SW0a-4 and SW0a-16 are in production. For each SKU write what it adds over the free chain, and set its price from measured cost; settle the `llms.txt` question; record decisions 16, 23 and 32. On the staging bot, with real test payments: one purchase and refund; a refund attempted with too low a balance; a second refund of one charge; a refund to a payer whose account was deleted | this document | Each price is at or above measured cost with n stated. No SKU ships without a measured cost or without its "what this adds" sentence. What Telegram returned in each refund case is written into section 11.1, and the sweep's handling matches it |
| SW6-1 | Migration; smoke lists; privacy export and delete, with the two-step deletion; link move; `AGENT_JOBS_ENABLED` in three blocks, env typing, example env files, admin health and the capabilities answer | `migrations/`; `scripts/smoke-check.mjs`; `worker/privacyService.ts`; link helper; `wrangler.jsonc`; `worker/env.ts` | Applies clean after `stars_charges`. Deleting an account with a job in flight fails the job, queues its refund, and removes the account's data once the refund has gone or failed; its rows in `stars_charges` and `stars_credited_charges` stay with no account id |
| SW6-2 | Catalogue and the three acceptance checks as pure functions | new `services/swarm/jobCatalogue.ts`; new `services/swarm/jobChecks.ts`; `services/swarm/draftChecks.ts`; tests | Each check has a passing and a failing fixture. A check never calls a model |
| SW6-3 | Quote and checkout routes; state machine with conditional updates; expiry; the redo insert | new `worker/agentJobs.ts`; `worker/index.ts`; `worker/authMiddleware.ts` | A quote for another account's project is refused. An expired quote cannot be checked out. Two checkouts of one job return the same invoice. Each illegal transition is refused (one test per pair). A second redo of one job is refused, and so is a redo eight days after delivery |
| SW6-4 | Stars branch for `job:` payloads in pre-checkout and payment, on the `stars_charges` ledger, binding amount and payer to the row | `worker/telegramBot.ts:290-333`; `worker/paymentLedger.ts:264`; tests | Wrong amount: refused at pre-checkout. Payer id different from the job's: refused. Same charge delivered twice by Telegram: one job paid. Payment for an expired job: refunded and the job stays `expired`. A crash between the charge insert and the batch leaves a `received` row the sweep refunds. Plan purchases behave exactly as before (existing tests) |
| SW6-5 | Job runs: session sized to the SKU, deliverable, check, receipt | `worker/swarmService.ts`; `worker/swarmRun.ts`; `worker/trustReceipts.ts:101` | A passing fixture ends `delivered` with a receipt. A failing fixture ends `failed` and never `delivered`, and its charge is `refund_due` in the same batch |
| SW6-6 | Job sweeps on the ops cron, beside the charge sweep of section 5.1: restart of a `paid` job with no run after 10 minutes; fail and refund of a job past `due_at`; closing a `failed` job whose charge is `refunded`; and closing a job of either final state when its charge is refunded. The comparison with Telegram's own list of Star transactions already runs in the charge sweep (SW0a-3) | `worker/agentJobs.ts`; `worker/telegramBot.ts:956-970`; `worker/scheduledJobs.ts` | Two overlapping ticks call Telegram once per charge (spy). A Telegram error leaves the charge `refund_due` and the next tick retries; the fifth failure marks it `refund_failed` and alerts. A delivered job whose charge was refunded by `/refund` ends `refunded`. A job delivered after its timeout fired stays `failed` and is refunded once. `EXPLAIN QUERY PLAN` for each sweep names `idx_agent_jobs_open` |
| SW6-7 | Admin queue for human jobs and the float report | `worker/index.ts` admin routes; `worker/adminAuth.ts` | Without the admin secret: 401. The report's total equals the sum of charges on undelivered jobs in a fixture |
| SW6-8 | Jobs view: catalogue, quote sheet showing price, check and what the job adds, order status, redo request | new `components/jobs/`; new `services/jobs/jobsClient.ts`; `services/telegram/tma.ts` | Static-markup tests per state. The quote sheet shows the check text before the pay button. On the web the pay button is the hand-off link |
| SW6-9 | MCP `list_jobs`, `quote_job` (no checkout through MCP in this phase) | `worker/mcpServer.ts` | A quote through MCP appears in the app for the same account |
| SW6-10 | Disputes and terms: an operator refund from the support queue of SW0a-16; the Terms state the refund rule; the `job_<id>` start parameter | `worker/index.ts` admin routes; `worker/agentJobs.ts`; `worker/termsPolicy.ts`; `services/telegram/startParam.ts` | An operator refund moves the charge to `refund_due`, the sweep refunds it, and the job ends `refunded`. A job that is not `delivered` cannot be refunded this way. Opening the Mini App with `job_<id>` lands on that quote for its owner and on "not found" for anyone else |
| SW6-11 | The Prospector and the server tool loop, moved here from SW2-6. A typed planner returns `{ tool, args }` from the agent's allow-list; every tool result is fenced; three identical calls in a row end the run; per-step and per-run limits (section 4.3). Its own live gate, shaped like SW1-13, before `competitor_brief` is sold | new `worker/swarmToolLoop.ts`; new `services/swarm/prospectorPlan.ts`; `services/agentCore/` detectors; `evals/live/`; tests | A fixture model that repeats one call three times ends the run `failed` with `REPEAT`. A planner reply naming a tool outside the allow-list is refused and counted. Every tool result in the next prompt is inside an untrusted fence (prompt-assembly snapshot). In every injected run of the gate, no call names the planted target and the canary string is in no argument |

**Order:** SW6-0; SW6-1; SW6-2; SW6-3; SW6-4 (reviewed as a money change); SW6-5; SW6-6; SW6-7; SW6-8; SW6-9; SW6-10 before any production flag. SW6-11 in parallel; `competitor_brief` is not listed until it passes its gate.

**SW6 double-check:** every path into `delivered` passes through a check result; every path into `failed` on the Stars rail moves its charge to `refund_due` in the same batch; no state change is an unconditional update (grep); the plan-purchase tests pass unchanged; job copy never says "guaranteed result".

**Staging soak:** the owner buys each SKU once with a real Stars payment on the staging bot and forces one failure. Staging has no users, so nothing here is a waiting period.

**Promote when:** each SKU has been bought, delivered and verified by the owner on staging; one forced failure refunded itself with no admin action and the Stars arrived back (owner check); a double-delivered payment update paid one job; one redo was asked for and delivered. Production: code with the flag off, then the flag, allow-list first.

**Rollback:** flag off refuses new quotes and checkouts. Jobs already paid finish or refund; the refund path does not depend on the flag.

---

## 12. SW7 - Live rooms, org invites, agency war room

**Goal:** the brief's "multiplayer": a founder, a teammate or an agency can watch the same run as it happens, steer it between steps, approve for each other, and hand it over.

**Needs:** SW2 promoted; decision 10. Starts with a re-baseline and a socket spike (SW7-0).

### 12.1 Design

**The room is the run.** Viewers connect by WebSocket to the run's own Durable Object, which already holds its events. The object accepts sockets with the hibernation API, so an idle room costs nothing while it waits. On connect a viewer gets the events since a sequence number, then each new event as it is appended.

**Getting in.** A browser cannot set an auth header on a WebSocket. So: `POST /swarm/runs/:id/live-ticket` (signed in, role checked) returns a single-use ticket valid for 60 seconds; the socket presents it as its subprotocol value, not in the URL. The object stores the viewer's user id and role on the socket. A guest has no session, and everything under `/swarm` refuses a caller with none, so the guest's ticket route and socket live outside that prefix, under `/watch/<token>`, with the token as their only credential.

**Who may do what.** Roles are the ones the schema already has (`migrations/0003_enterprise_orgs_rbac.sql:16`).

| Role | Watch | Send an instruction | Pause, resume, cancel | Approve a step | Hand over |
|---|---|---|---|---|---|
| owner, admin | yes | yes | yes | yes | yes |
| analyst | yes | yes | no | no | no |
| auditor, viewer | yes | no | no | no | no |
| guest with a watch link | yes, redacted | no | no | no | no |

**An instruction** is a typed choice, not text (section 4.3): narrow the work to one page or one finding of this run, skip the step that is next, or stop after the step in flight. It is recorded as an event with the sender's user id and applied at the next step boundary. It is accepted only while the run is open, and only for an agent whose plan a model steers (the Prospector); the fixed-plan agents take none, because there is nothing in a fixed list for an instruction to change. It cannot raise a cap, change a ceiling, add a tool or approve anything: those stay on their own routes with their own checks.

**Hand over** changes who is asked for approvals on this run: the run's approver becomes another owner or admin of the same org. It is an event, and both people see it.

**Org invites.** Membership rows exist with no way to create one for a second person (`worker/enterpriseStore.ts:76-91` creates only the owner). SW7 adds the smallest invite: an owner or admin creates a single-use link for a role other than owner, valid 7 days; accepting it while signed in inserts the membership. The number of active members is capped by `teamSeats` (1, 1, 3, 10), which becomes a Worker-side entitlement for the first time; it means people, and is never used for agents (Ops F4).

**Before the first invite can be accepted, one existing function has to change.** `getOrCreateUserOrg` returns an account's earliest active membership (`worker/enterpriseStore.ts:53-61`), and six call sites use its answer as "my org" (`worker/index.ts:364`, `:397`, `:443`, `:699`, `:727-745`, `:754-760`). Today that is always the personal org, because nobody has a second membership. The moment an invited person's first membership is someone else's org, every one of those routes would act on the inviter's org. SW7-2 makes it resolve the personal org by its id (`org_<accountId>`) first, with a test in which the invited membership is the older row, and ships before SW7-3.

**Scope of membership, deliberately narrow.** Every existing route resolves the caller to their own account. This phase does not change that. Membership is honoured in exactly three places: live rooms, the runs list with `scope=org`, and the approval routes for a run's steps. One helper, `resolveRunAccess(user, run)`, makes the decision and is the only caller of the membership lookup. Everything else in the product stays single-account until a later plan widens it on purpose.

**Guest watch links.** An owner can mint a view-only link for one run, valid at most 24 hours. A guest sees step summaries and state changes and never costs, arguments, evidence text or other viewers.

**War room.** For an agency: one grid of the runs open across its client projects (`projects.client_id` already groups them), each tile a live room in miniature, with the approvals waiting across all of them at the top. A grid, not a canvas.

**Limits.** At most 20 sockets per run and 5 instructions per minute per viewer; messages over 2 KB are dropped. The room closes 10 minutes after the run ends.

### 12.2 Migration `live_rooms`

```sql
CREATE TABLE IF NOT EXISTS org_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','analyst','auditor','viewer')),
  invited_label TEXT,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by TEXT,
  accepted_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_watch_tokens (
  token_hash TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_watch_tokens_run ON run_watch_tokens(run_id);
```

- The role CHECK has no `owner`: an invite can never create a second owner.
- Accept is one batch of two statements, and the second can only act if the first did. First: `UPDATE org_invites SET accepted_by = ?, accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND (SELECT COUNT(*) FROM organization_memberships m WHERE m.org_id = org_invites.org_id AND m.status = 'active') < ?`, the last bind being the plan's seats. Second: the membership is inserted by selecting from the invite row this caller just accepted (`... SELECT org_id, ?, role, ... FROM org_invites WHERE token_hash = ? AND accepted_by = ? AND accepted_at = ?`) with `ON CONFLICT(org_id, user_id) DO NOTHING`. An invite that was expired, revoked, already used or over the seat limit accepts nothing and so inserts nothing.
- On account link, invites the losing account created move to the surviving account's org; watch tokens move with their runs.
- Only token hashes are stored, as share links already do.
- `organization_memberships` is not altered. Its `user_id` is a login id (`worker/enterpriseStore.ts:90`), so access checks compare login ids, not account ids.

### 12.3 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW7-0 | Re-baseline and spike: hibernating sockets on the run object under `wrangler dev` and on staging; whether a deploy drops sockets and how clients recover; record decision 10 | this document; scratch branch | Section 12 corrected. Reconnect behaviour after a deploy is written down as measured |
| SW7-1 | Migration; smoke lists; privacy and link move; flags | `migrations/`; `scripts/smoke-check.mjs`; `worker/privacyService.ts`; `wrangler.jsonc`; `worker/env.ts` | Applies clean. Deleting an account revokes its invites and watch tokens |
| SW7-2 | First: `getOrCreateUserOrg` resolves the personal org by id. Then `resolveRunAccess` and the `teamSeats` entitlement on the Worker | `worker/enterpriseStore.ts:53-61,135-188`; `worker/index.ts:364,397,443,699,727-745,754-760`; new `worker/runAccess.ts`; `worker/telegramBot.ts:128-149` | With a fixture account whose oldest membership is another account's org, each of the six call sites still acts on the account's own org. A member of org A cannot read org B's run (404). A suspended member is refused. The new helper is the only importer of the membership lookup outside `enterpriseStore` (test over the import graph) |
| SW7-3 | Invite create, accept, revoke, list; the seat cap inside the accept | new `worker/orgInvites.ts`; `worker/index.ts`; `worker/authMiddleware.ts` | A second accept of one link is refused. Two accepts racing for the last seat seat one person. An accept that fails inserts no membership. An invite for `owner` is refused by code and by CHECK |
| SW7-4 | Ticket route; socket accept with hibernation; replay from a sequence number; broadcast on append | `worker/swarmRun.ts`; `worker/swarmService.ts` | A ticket works once and for 60 seconds. A viewer joining at event 30 receives 31 onward. The 21st socket is refused |
| SW7-5 | Commands by role: instruct, pause, resume, cancel, hand over; rate limits | `worker/swarmRun.ts`; tests | A viewer's pause is refused. An instruction is one of the typed choices or it is refused; free text is refused. An instruction to a fixed-plan run, or to a run that has ended, is refused. No cap, ceiling or tool list is reachable from the instruction path (asserted by test). A hand-over to a non-member is refused |
| SW7-6 | Approvals by another owner or admin of the org for a run's steps | `worker/mcpGovernance.ts`; `worker/runAccess.ts`; `tests/mcpActionRequestsHttp.test.ts` | An admin of the org approves a member's run step. An analyst cannot. A bearer credential still cannot. Approvals outside runs are unchanged |
| SW7-7 | Guest watch links with a redacted stream, on routes outside the `/swarm` prefix | `worker/swarmRun.ts`; new `worker/watchTokens.ts`; `worker/index.ts` | A guest with a valid link connects with no session. A guest stream contains no cost, argument or evidence text (snapshot). A revoked or expired link is refused. The token opens that one run and no `/swarm` route |
| SW7-8 | Live room UI in the roster view; presence; reconnect with back-off; fall back to polling | `components/swarm/`; new `services/swarm/liveClient.ts` | With sockets blocked the view still updates by polling. Reconnect resumes from the last sequence number with no duplicate event |
| SW7-9 | War room grid; `GET /swarm/runs?scope=org` | new `components/swarm/WarRoomView.tsx`; `worker/swarmService.ts` | The grid shows only runs the caller's role may see. Hidden for plans with no agency clients |
| SW7-10 | Members screen: invite, role, remove | `components/settings/` | Static-markup tests; the seat count shown equals the entitlement |

**Order:** SW7-0; SW7-1; SW7-2 and SW7-3 (reviewed together as an access-control change); SW7-4; SW7-5; SW7-6; SW7-7; SW7-8 to SW7-10.

**SW7 double-check:** grep for every query that filters by `account_id` taken from anything other than the caller or `resolveRunAccess`; confirm no route outside the three named places reads membership; run the two-org test matrix for every `/swarm` route; confirm the guest snapshot.

**Promote when:** the two-org matrix is green; the owner and a second real person have watched one run together on staging, one in the Mini App and one on the web, and the second has approved a step; a deploy during an open room recovered as SW7-0 recorded. Two flags, two production releases: invites first.

**Rollback:** `LIVE_ROOMS_ENABLED` off closes sockets and the view falls back to polling. `ORG_INVITES_ENABLED` off refuses new invites; existing members keep access until removed.

---

## 13. SW8 - Watches and desktop surfaces

**Goal:** agents that come back on a schedule without being asked, and a desktop app that tells the founder when one needs them.

**Needs:** SW2 promoted; Ops Phase 2 exited (Sealed Lane and seats in `enforce`), the same condition the Ops plan set when it parked Watches; decision 12. Starts with a re-baseline (SW8-0).

**The Auditor-only slice (decision 22), part of the launch cut.** The plans already promise scheduled re-audits by tier (`scheduledReaudit`: none on Free, monthly on Starter, weekly on Growth, daily on Agency), and "agents work while I am away" is the launch promise. The Auditor is a fixed plan with no model-chosen step and no tool that writes outside the account, and in SW1a it makes no model call at all, so the reason Watches were parked (an agent acting on hostile content with nobody watching) applies to it least. If decision 22 is yes, SW8-1 and SW8-2 ship right after SW1a with one restriction enforced in code and by a test: only `agent_id = 'auditor'` can have a Watch until Ops Phase 2 exits.

- **The cron.** `watch_tick` is a job on the 15-minute ops cron that P8 adds, which is on the launch path already. The slice needs no cron of its own and does not wait for SW4's hourly one.
- **No sessions yet.** Sessions arrive in SW2. Until then a scheduled Auditor run is an SW1a run with nothing to spend: it counts against the plan's run allowance and the per-site limits of section 4.4, and `run_cap_cents` is 0.
- **Free has no schedule.** A founder on Free re-runs by hand inside their run allowance. Whether Free should get one scheduled audit a month, as a reason to come back, is part of decision 22; the default is the pricing as it stands.
- **It speaks only when something changed.** A scheduled run compares its finding keys with the previous run's for that project. A finding that appeared or went away sends one notice in the `watch` category of section 6.5, under that policy's consent and cap. A run that found nothing new sends nothing.
- **One scheduler.** Sentinel's "time for your check" message (`worker/sentinel.ts:233-249`) and its enqueue of the old queue audit on drift (`:253-262`) are removed in the same change. Sentinel's drift alert stays.

### 13.1 Design: Watches

A Watch is a standing instruction to start one kind of run for one project on a cadence. The name is the Ops plan's, so there is one concept, not two.

- Cadence is limited by the plan's existing `scheduledReaudit` entitlement (none, monthly, weekly, daily).
- From SW2, each run a Watch starts has its own session, capped by the Watch's `run_cap_cents`, inside the agent's monthly cap. A Watch can never spend more per month than its agent may.
- `watch_tick` takes up to 25 due Watches, and for each claims it by advancing `next_run_at` with a compare-and-set, then starts the run. A Watch that was not claimed is not run twice.
- Three failed runs in a row, or a refused start for money, sets `auto_paused` and tells the owner in the app.
- A Watch's Telegram messages follow section 6.5 and nothing else: the `watch` category, only on a change, only with consent.
### 13.2 Design: desktop

The server does the work. The desktop shell stays a thin window on the hosted app (`docs/plans/desktop-windows-electron.md:24`) and gains what a browser tab cannot do:

| Addition | How | Note |
|---|---|---|
| Sender checks on every IPC handler | Each handler verifies the calling frame's origin against the allow-list before acting | A fix for today's handlers too, which ignore the sender (`electron/main.cjs:301-330`) |
| Native notification when a step needs approval or a run delivers | New `desktop:notify` call; clicking it shows the window on the run | The page decides when; the shell rate-limits to 6 per hour |
| Tray menu shows counts | New `desktop:set-badge` call with two integers | The tray exists on Windows today (`electron/main.cjs:267-293`) |
| Start with Windows, minimised to tray | A preference beside the auto-update toggle | Off by default |
| Save a deliverable to a folder | New `desktop:save-file` call that opens the system save dialog in the main process and writes the one file the user confirmed | No general file access. The page never receives a path it did not get from the dialog |

A new shell needs a new installer, and old shells keep receiving new web deploys, so the page feature-detects each call, as it does for update preferences today (`components/desktop/DesktopUpdatesPanel.tsx:16`).

### 13.3 Migration `swarm_watches`

```sql
CREATE TABLE IF NOT EXISTS swarm_watches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  run_cap_cents INTEGER NOT NULL CHECK (run_cap_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','auto_paused')),
  next_run_at INTEGER NOT NULL,
  last_run_id TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, project_id, agent_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_swarm_watches_due ON swarm_watches(status, next_run_at);
```

- Due: `SELECT id, next_run_at FROM swarm_watches WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at LIMIT 25`.
- Claim: `UPDATE swarm_watches SET next_run_at = ?, last_run_id = ?, updated_at = ? WHERE id = ? AND status = 'active' AND next_run_at = ?`. One row changed, or skip.

### 13.4 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW8-0 | Re-baseline. Confirm the Ops Phase 2 exit criteria were met and recorded; record decisions 12 and 30 | this document | If Sealed Lane is not in `enforce` in production, the Watches half of this phase does not start, except the Auditor-only slice under decision 22, which needs only SW1a |
| SW8-1 | Migration; smoke lists; privacy and link move; `SWARM_WATCHES_ENABLED` in three blocks, env typing, example env files, admin health and the capabilities answer | `migrations/`; `scripts/smoke-check.mjs`; `worker/privacyService.ts`; the V2-1b helper; `wrangler.jsonc`; `worker/env.ts` | Applies clean. Deleting an account removes its Watches; after a link they sit under the surviving account, and a `(project, agent, kind)` collision keeps the surviving account's row |
| SW8-2 | Watch service and routes; cadence checked against the entitlement; the `watch_tick` job on the ops cron, with claim; auto-pause; the changed-findings comparison and the `watch` notice; the Auditor-only restriction; removal of Sentinel's nudge and its queue enqueue | new `worker/swarmWatches.ts`; `worker/scheduledJobs.ts`; `worker/index.ts`; `worker/sentinel.ts:233-262`; `worker/notify.ts`; `tests/scheduledJobs.test.ts` | Two overlapping ticks start one run per due Watch. A free plan cannot create a Watch. A Watch for any agent but the Auditor is refused while the restriction holds. Three failures auto-pause it and a fourth tick starts nothing. A scheduled run with the same finding keys as the last sends no notice; one new key sends one. The job list test names `watch_tick` under the ops cron and no longer expects Sentinel's nudge |
| SW8-3 | Watches UI on the roster view | `components/swarm/` | Static-markup tests; the next run time and the month's spend are shown |
| SW8-4 | IPC sender checks for every existing handler | `electron/main.cjs:296-330`; `electron/security.cjs` | A call from a frame outside the allow-list is rejected (unit test on the check) |
| SW8-5 | `desktop:notify`, `desktop:set-badge`, start-with-Windows preference | `electron/main.cjs`; `electron/preload.cjs:8-21`; `electron/desktopPrefs.cjs`; `services/desktop/desktopShell.ts` | The 7th notification in an hour is dropped. An old shell without the calls shows no error (feature detection test) |
| SW8-6 | `desktop:save-file` through the main-process dialog | `electron/main.cjs`; `electron/preload.cjs` | The handler writes only to the path the dialog returned, only the bytes passed, and at most 5 MB. A cancelled dialog writes nothing |
| SW8-7 | Desktop release: a `desktop-v*` tag built by the existing workflow; owner installs and checks each addition. An installer signed with a certificate installs without Windows' warning screen; without one it shows the warning. Which it is to be is decision 30 | `.github/workflows/desktop-windows.yml` | Owner check on a real Windows machine: a notification arrives with the window hidden; clicking it opens the run. What the installer showed on first run is recorded |

**Order:** SW8-0; SW8-4 first (it is a security fix and stands alone); SW8-1 to SW8-3; SW8-5 to SW8-7.

**SW8 double-check:** no handler in `electron/main.cjs` acts before the sender check (grep each `ipcMain.handle`); no new call exposes a path or directory listing to the page; a Watch cannot be created with a cap above its agent's monthly cap.

**Promote when:** a weekly Watch on staging has run on schedule at least three times by a scripted clock test and once for real; an auto-pause was triggered and reported; the owner check in SW8-7 passed.

**Rollback:** `SWARM_WATCHES_ENABLED` off makes `watch_tick` a no-op. Desktop additions are inert on the server; a faulty shell is replaced by the next tag.

---

## 15. SW10 - Gated designs (not work orders)

Each item is recorded so the idea is not lost and so the gate is explicit. None starts without its named decision and, where shown, counsel or an outside audit.

| Item | The lowest-risk design | Why it is gated | Gate |
|---|---|---|---|
| Bounties between founders | **Direct pay on acceptance, with no fee inside the payment.** The funder posts a commitment; no funds are held anywhere. A builder delivers; a Luminara verifier issues a receipt; the funder pays the builder wallet to wallet through TON Connect; the Worker reads the transfer on-chain and marks the bounty paid. An unpaid accepted bounty shows on the funder's record. If Luminara earns anything, it is a flat listing fee charged apart from any bounty. v0.2 put a platform fee inside the bounty's own transaction; that makes Luminara's pay depend on the payment between two users, which is the very thing counsel has to rule on, so it is recorded as an option and is not the lowest-risk design. The lowest-risk design of all is the directory in the last row | Luminara would be arranging payment between two parties, which TN decision D5 sends to legal review first. Whether a peer payment for human work is a "digital service" under Telegram's Stars rule is not settled by its text, so settlement would be web-only until answered | Decision 13; counsel |
| Bounty escrow on TON | A per-bounty contract in Tolk: funder deposits, one assignee, release on the funder's signature, refund on timeout. The funder deploys their own instance from their own wallet. No oracle key, because a Luminara signature that released funds would be releasing funds between users | A new contract needs its own outside audit and its own legal sign-off, testnet first (J1, J3). TN decision D4 recommends deferring | Decision 13; its own outside audit; counsel; testnet first |
| On-chain soulbound badges | Two designs are recorded. **(a) Owner-signed batches on standard code:** the reference TEP-85 collection, deployed by the owner, who mints batches from their own wallet from a list the Worker prepares. No custom contract and no Worker key; the owner pays the gas and it is a manual step. **(b) A voucher:** the user's own wallet mints; the Worker signs a voucher (network, collection, owner address, badge id, receipt hash, expiry) with a dedicated key that cannot move funds; a custom contract checks the signature and mints to the sender, who pays the gas. In (b), a leaked voucher key lets anyone mint badges, so vouchers expire, the contract's signer can be replaced by the owner, and badges minted in the leak window can be marked revoked on the verify page. In both, the Worker sends no transaction | (a) keeps Zoro's "no custom contract" lock and does not scale past the owner's patience. (b) needs a new contract and a new signed-message format (today's receipt signature covers JSON bytes, not a cell hash). Either links a wallet to a business in public, so it must be opt-in. Zoro paused agent SBTs | Decision 14; for (b), audit and testnet first |
| Third-party sellers in Jobs | Sellers with a published passport and receipts; Luminara lists, does not hold or release money | Legal review (TN D5) | Decision 13 |
| An agent paying third parties from the founder's funds | None that keeps rule J1. Every known design (a session key, a spend permission, a funded agent wallet) puts a key that can move the founder's money somewhere Luminara runs | Zero custody | Not planned. Revisit only if the owner changes J1 |
| x402 on TON | The standard defines it; no production facilitator runs it, and self-hosting one needs a funded relay wallet | Zero custody | Revisit when a third-party TON facilitator exists |
| Desktop folder bridge | Fixer writes its prepared files into a folder the user picked once, so the fix lands in their site's source | A standing write grant to a folder is a real capability on the user's machine; it needs its own threat model and review | Decision 12, second part |
| Gated community groups | TN8 Circles as written. One builders chat is taken out of this row by decision 19 (section 14.3) | The rest stays parked at TN decision D6 until 50 verified profiles exist | TN D6 |
| Wallet link | Link a TON wallet to an existing account by `ton_proof`: a single-use nonce issued by the server and bound to the signed-in account; the signature checked; the public key taken from the wallet's state init and matched to the claimed address; the domain checked against an allow-list (the manifest names `www.luminarasuite.com` while the app can load from the apex); a short freshness window; and the network checked separately, because the proof does not bind it. One wallet per account and one account per wallet, as two unique keys, so a wallet cannot be used to stack accounts. Unlinking is allowed and recorded. The address is stored against the account and shown only to its owner | It publishes nothing by itself, but every later on-chain feature would tie a wallet to a business in public. Not a third way to sign in: a wallet costs nothing to create, so wallet sign-in would let one person farm invite credits | Decision 21 |
| A builders directory, in place of bounties for now | Founders who opt in list what they do and how to reach them. Contact is direct. Luminara takes no fee, holds nothing and releases nothing | It needs the moderation minimum (14.6) and project pages; it is the interim the owner can have while counsel reviews bounties | Decision 13 |
