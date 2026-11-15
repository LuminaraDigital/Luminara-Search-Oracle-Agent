# Venice concepts: what to borrow, what to skip, build order (Track VN)

**Status:** v0.3. Two review rounds (section 8): CEO gate GO WITH CONDITIONS, all conditions applied; citation corrections applied. Waiting for the owner. No code. Nothing in it is approved by the owner.
**Date:** 2026-11-15
**Owner:** Luminara Digital (owner gate before every production step)
**Source:** the owner asked whether Luminara can build its own, much better version of what `venice.ai/home` and `docs.venice.ai/overview/about-venice` describe. Concepts only. No Venice name, text, design or token mechanics.
**Citations:** `origin/staging` at `63b39069` unless a line says otherwise. Lines marked "VUT worktree" are uncommitted files in `.claude/worktrees/visibility-unit-tests` of the main checkout (last commit there `4e500b48`, two weeks old).
**Rules:** inherits section 2 of `docs/plans/zoro-concepts-implementation-plan.md`.
**Related (binding owners):** `docs/plans/e2e-visibility-agent-platform.md` W4 (engine router), the visibility unit tests spec in the VUT worktree, `docs/plans/budget-policies-and-enforcement.md` (spend), PR #304 (Lumen ledger, draft), PR #308 (privacy erase and export, open), `docs/plans/luminara-agents-everywhere.md` (Track AE, MCP), `docs/plans/lora-jetton-production-ship.md` (token), `docs/plans/zentry-concepts-map.md` (Track ZC, same kind of request).

---

## The answer in plain English

Venice resells other companies' AI models. It does not train frontier models. It routes your prompt to one of 413 listed models and wraps that in a "private and uncensored" pitch, with a crypto token for API credit. Its own pages contradict themselves on privacy, and its pricing has four spend currencies.

Luminara should not build a general AI chat app. With 13 users it cannot out-catalogue that, and it does not need to.

What Luminara can do is one sentence: **ask several major AI models the questions your customers ask, without naming you, and show who they recommend instead.** Venice's pages describe no comparison feature like this. Luminara has a reason to build one: it is the product.

Four Venice ideas are worth taking, each made honest:

1. **Privacy levels that are true.** Today a "Private" label would be false in several places, and the privacy policy describes a sync switch that does not exist (section 2.1). Fix the truth first.
2. **Many models as a measuring tool.** The model check exists but is three fixed models, one at a time, with no screen (section 2.2). Open it up and show it as a grid.
3. **A price before every paid run.** Today no paid action shows a price, and AI model calls are not metered (section 2.3).
4. **Reachable from any agent.** Already owned by Track AE. A narrow addition comes later (section 2.4).

"100x" cannot be measured, so this plan does not claim a multiple. It claims a result a customer can check: the same question, several models, one grid, every answer saved.

**You need to answer two decisions now: VN-D1 (privacy copy) and VN-D6 (commit the visibility tests work).** Section 7 has both, with a recommendation.

### Words used here

- **Model via API:** the AI model a developer calls directly. Its answers are not the same as what a person sees in the ChatGPT app or in Google's AI Overviews.
- **Zero retention:** the AI provider promises not to store prompts after answering.
- **D1:** Luminara's database. **Durable Object:** a small per-session store on Cloudflare, used here for hosted Oracle chats.
- **Hardware enclave (TEE):** a sealed processor that even the host cannot read. Not planned.
- **APP:** the Australian Privacy Principles, which the privacy policy says Luminara follows.

## 0. Verdict

**Borrow four ideas. Skip the rest. Fix privacy truth now: it is cheap, and the policy and the code disagree today.**

| Venice idea | Take it? | Luminara version | Where the work order lives |
|---|---|---|---|
| Privacy levels | Yes, honest | VN0 truth fixes now; VN1 a real "Private" level later | Fix PRs; VN0-3 as a PR #308 follow-up |
| Hundreds of models behind one API | As a measuring tool only | VN2 model grid | Edit to W4 of `e2e-visibility-agent-platform.md`; no separate work order |
| Credits and plans | Yes, simpler | VN3 price before run, one unit, no hidden limits | Edit to `budget-policies-and-enforcement.md` and PR #304; no separate work order |
| OpenAI-compatible API, MCP | MCP already; narrow add later | VN4 Luminara's own agents only | Edit to Track AE |
| "Uncensored" | No | | |
| Image, video, music, characters | No | | |
| Own GPUs, hardware enclaves, end-to-end encryption | Not now | | |
| Stake a token for daily API credit | No | | LORA plan rule J6 |

## 1. What Venice actually publishes

Read with a web reader on 2026-11-15: `venice.ai/home`, `docs.venice.ai/overview/about-venice`, `docs.venice.ai/pricing.md` (truncated), `docs.venice.ai/overview/vvv-diem.md`, `docs.venice.ai/models/overview.md` (truncated), `cdn.venice.ai/privacy`. Not re-checked since. `venice.ai/pricing` was not read.

- **Product:** chat, image, video, audio and music generation, characters, an OpenAI-compatible API, an MCP server, integration guides for agent frameworks.
- **Privacy:** four modes. "Anonymous" passes prompts to frontier providers, and the privacy page says that provider likely saves the prompt, while the home page says identifying metadata is stripped. "Private" relies on contracts with zero-retention providers. Enclave and end-to-end modes are on the paid plan only. Chat history is said to stay in the browser. No audit was linked.
- **Pricing:** free, then paid plans with monthly credits. API billed per token, per image, per second of video, with separate search and scrape fees, payable in dollars, crypto credits, a staked token that grants daily credit, or stablecoin per request.
- **Weak spots:** privacy claims that contradict each other, an undefined "uncensored" label, pricing that is hard to predict, frequent model retirement, no stated rate limits.

This plan makes no public comparison with Venice and uses none of its wording.

## 2. What Luminara has today

### 2.1 Privacy: where a "Private" label would be untrue

| What a user would assume | Today | Evidence |
|---|---|---|
| Chat stays on my device | Signed-in chat (from `sessionStorage`) is added to the workspace sync payload with no switch, and stored in D1 as plain JSON text | `services/sync/workspaceSyncService.ts:99-100` adds it; `:327` skips only guests; `worker/userStore.ts:598-606` writes `JSON.stringify(payload)` into `user_workspace.payload` (`migrations/0002_accounts_workspace.sql:13-16`) |
| The policy describes this | Policy and terms say sync happens if you turn it on, and that keys upload unencrypted if encryption fails. No sync switch exists in the app, and on failure the code keeps keys on the device | `services/legal/privacyCopy.ts:53`, `components/LegalPage.tsx:63`, `worker/termsPolicy.ts:65`; code at `workspaceSyncService.ts:113-127` |
| Sync is encrypted | Marketing says "encrypted workspace sync"; only the key bag is encrypted | `components/IntelligencePage.tsx:91` |
| Deleting my account deletes my chats | Hosted Oracle turns live in a Durable Object with no expiry. It has a delete handler, and no privacy or deletion code calls it | `worker/oracleSession.ts:224-237`; no reference in `worker/privacyService.ts` or `worker/accountDeletion.ts` |
| My export has my chats | Oracle session turns are not exported. PR #308 adds `memory_history` and `memory_chat_extractions`, not the Durable Object | PR #308 diff |
| Providers do not keep or train on my prompts | No zero-retention or no-training preference is sent to any provider. The OpenRouter request has no `provider` block | `services/llm/providers/OpenRouterProvider.ts:54-59`; repo search for `data_collection` and `zdr` finds nothing |
| I know which company answered | Only fallback answers are labelled. The audit found no label for the main provider | `components/MessageList.tsx:96-97`, `services/llm/fallbackAnswer.ts:75` |
| The policy lists every provider | Workers AI (relay fallback) and Typesafe are not named | `services/legal/privacyCopy.ts:36`; fallback at `worker/providerRelay.ts:373-383` |

Already clean: run provenance stores a hash of request metadata (session id, message length), not the prompt (`worker/oracleChat.ts:225-233`); Sentry captures no bodies (`worker/sentry.ts:30-34`); the audits found no log line that prints a prompt.

### 2.2 Models: what the visibility check does

| Piece | Today | Evidence |
|---|---|---|
| Models asked | Three fixed OpenRouter models | `services/visibility/llmAnswerProbeService.ts:21-25` |
| Engine labels | A closed list of four | `services/visibility/engineVisibilityTypes.ts:7` |
| Labels are honest | No. `gpt-4o-mini` is labelled `chatgpt` and Gemini Flash `google_aio`. An API answer is not what the ChatGPT app or AI Overviews show a person | `llmAnswerProbeService.ts:22`, `:24` |
| Question names the business | On staging nothing prevents it, so "presence" can pass because the question said the name. The fix exists only in the VUT worktree | VUT worktree `services/visibilityTests/scorer.ts` |
| Cost known | Not read on staging. The VUT worktree asks OpenRouter for cost when `reportCost` is set | VUT worktree `services/llm/providers/OpenRouterProvider.ts:64` |
| Answer saved | First 400 characters only, so old runs cannot be regraded | `llmAnswerProbeService.ts:60` |
| Shown to anyone | Only through the paid MCP tool `get_visibility_snapshot`; no screen | `services/tools/paidCatalogue.ts:62-65` |
| Invented data | `citationScoutService` uses made-up competitor samples when none are passed. Only its test imports it | `services/visibility/citationScoutService.ts:140-149`; `tests/citationScoutService.test.ts` |

The owner plan is W4 of `e2e-visibility-agent-platform.md` (`:217-238`). Its item 3 (store a raw answer hash) and item 5 (per-engine badges) are not built.

### 2.3 Price: what a customer sees before paying

| Piece | Today | Evidence |
|---|---|---|
| Price lists | Stars, AUD card, TON, and USDT or LORA units are typed separately | `worker/telegramBot.ts:80-146`, `worker/stripePayment.ts:64-88`, `worker/tonPayment.ts:41-58` |
| Price before a paid run | None. A 0, 1 or 2 cent figure is calculated and not shown; the Oracle's paid-tool approval event has no price | `worker/resourceTank.ts:130`; `worker/oracleChat.ts:646-654` |
| Paid call cost | Flat 1 cent placeholder per hosted DataForSEO call | `worker/budgets.ts:34-37` |
| AI model cost | Not metered anywhere | Pricing audit |
| Plan copy matches code | Pricing page says "Higher daily allowance"; any active plan is unlimited | `components/PricingPage.tsx:101-105`; `worker/quotaMiddleware.ts:285-287` |
| Error copy matches code | Two messages say MCP needs Growth or Agency; every plan, free included, has MCP | `worker/apiAccess.ts:65`, `worker/mcpOAuth.ts:601`; `services/plans/planEntitlements.ts:59` |
| One unit | PR #304 adds a Lumen ledger (1 Lumen per job, does not block at zero). The budget plan rejected a parallel currency. PR #304 is a draft with merge conflicts | PR #304; `budget-policies-and-enforcement.md` |
| Budget screen | API exists; no component calls it | `worker/index.ts:1881-1884` (read), PUT handler follows |

### 2.4 Agents

MCP is live at `/api/mcp` with OAuth, API keys and plan caps, and Luminara-named packages exist for Claude Code, Codex, Cursor, Antigravity and Grok (Track AE; slices A and B are merged to staging). There is no Luminara OpenAI-shaped endpoint. The provider relay forwards bring-your-own-key calls without sign-in, by design (`worker/providerRelay.ts:403-406`), under a per-key and per-IP rate limit (`worker/index.ts:1016-1024`).

## 3. Risks

### 3.1 Legal

| Risk | Action |
|---|---|
| The privacy policy and terms describe a sync switch and a key upload that the code does not do, and leave out two providers and one store | VN0-1. The owner, and counsel if available, read the policy diff before merge. Ask counsel whether the current mismatch has any notification or misleading-conduct consequence; this plan draws no conclusion |
| The free teaser would send visitor-typed text to outside AI providers with no account | VN2-4 carries a notice line on the page and a policy entry before it goes live |

### 3.2 Vendor terms and zero retention

None of these has been checked. Each is a precondition for the task named.

| Vendor or use | Check | Blocks |
|---|---|---|
| OpenRouter | Commercial use on our account; which roster models support no-data-collection and zero-retention routing | VN0-2, VN1-2, VN2-1. If a model has no such route, its answers are labelled "not private", never silently rerouted or dropped |
| Anthropic, xAI, OpenAI, Google, Perplexity (via OpenRouter or direct) | Rules on automated querying, and on storing and showing answers to customers in a grid | VN2-1, VN2-3 |
| Perplexity citations | Rules on storing its citation list | VN2-1 |
| Reselling raw model output | Each vendor's resale terms | VN4 (passthrough is a non-goal) |

### 3.3 Spend and abuse

- AI model cost is not metered today. Caps use the cost OpenRouter reports per call (VN2-0), recorded by VN3-2, which is pulled forward ahead of the grid. VN2-2 and VN2-4 depend on both.
- VN2-2 runs several models per question. It needs a per-user daily run cap by plan, and the grid is for paid plans only.
- The teaser runs without sign-in; its controls are listed in VN2-4.

### 3.4 Brand

Marketing says "AI models via API", never "ChatGPT says" or "Google says", because the check never queries the consumer apps (VN-1). Each public claim about the grid is checked against what it measured before it is published.

## 4. Build order

Growth outranks new features until 28 December. VN0, VN2-5 and VN3-1 are fix PRs, not features, and may ship now. Everything else waits for 28 December, or is gated as stated.

### VN0: privacy truth (fix PRs, staging first)

| Task | Work | Gate |
|---|---|---|
| VN0-1 | Make policy, terms and marketing match the code: signed-in chat syncs to our database; correct the key-upload sentence; name Workers AI and Typesafe; mention the Oracle session store; say only keys are encrypted | **Blocked until the owner answers VN-D1.** Owner (and counsel if available) reads the diff before merge |
| VN0-2 | Send OpenRouter's no-data-collection preference on every OpenRouter call, and zero retention where the model supports it. Where no allowed route exists, label the answer, do not reroute | Section 3.2 OpenRouter check done first; test that each roster model still resolves |
| VN0-3 | Erase and export the Oracle session store with the account | After PR #308 merges, or as an edit to it; extend its `tests/privacyCoverage.test.ts` |
| VN0-4 | Show which provider and model produced each answer, including after failover | None |

### VN1: a real "Private" level (after 28 Dec, owner-gated)

| Task | Work | Gate |
|---|---|---|
| VN1-1 | Per-chat "Don't save this chat": no server sync, no fact extraction into `memory_facts` (`worker/oracleChat.ts:798`), session store cleared at the end | VN0 done |
| VN1-2 | "Private" level: only providers whose zero-retention terms are confirmed in writing, no failover to others, label names them | VN-D2 |
| VN1-3 | Move bring-your-own keys out of plain `localStorage` (`services/configService.ts:70-75`) | Security review |

### VN2: the model grid (edit to W4; no separate work order)

Proposed as additions to W4 of `e2e-visibility-agent-platform.md`. Listed here only so the order is fixed.

| Task | Work | Gate |
|---|---|---|
| VN2-0 | Review and land the VUT worktree: unnamed questions, cost reporting, saved evidence. Renumber its spec (staging has `specs/0031-named-agents-over-mcp.md`) and migration (PR #304 also uses 0044); take numbers at PR time | **VN-D6.** Its own blocker stands: both evidence buckets must exist before merge |
| VN2-1 | Open model list: a config list (model id, plain label, provider, cost cap) instead of the closed union. Label by model ("GPT-4o mini via API"). Add a Claude model, a Grok model, one open model; read Perplexity's citation list | VN2-0; section 3.2 checks |
| VN2-2 | Run the list in parallel per question with one cost cap per run and a per-user daily run cap by plan; save full answers, cost, response time and refusals | VN2-1, VN3-2 |
| VN2-3 | Grid screen, paid plans only: question by model, cells "named", "linked", "missing", plus the sources models cited instead (already computed at `services/visibility/engineVisibilityRouter.ts:55-126`) | VN2-2. Delivers W4 items 3 and 5 |
| VN2-4 | Free teaser (details below) | See below |
| VN2-5 | Delete or fix `citationScoutService` so it never returns invented samples | Fix PR, may ship now |

**VN2-4, free teaser.** Not on the 3 December path. Minimal cut: one fixed unnamed question per business category, two or three models, using the existing check plus the VUT unnamed-question fix, under the free tools spec (`specs/0028-free-tools.md`). Controls before it goes live:
- a flag, off by default;
- a bot challenge, plus per-IP and per-day limits;
- results cached by normalised question, so repeat visitors cost nothing;
- a spend counter, fed by the cost OpenRouter reports per call (VN2-0), that turns the teaser off at the cap;
- only models whose reported cost is known;
- a notice line on the page and a policy entry (section 3.1).

Build it only if VN2-0 lands by 22 November; otherwise it moves to the 28 December path.

### VN3: price before every paid run (edit to the budget plan; no separate work order)

After 28 December, except VN3-1 (a fix PR) and VN3-2 (pulled forward, because the grid needs it).

| Task | Work | Gate |
|---|---|---|
| VN3-1 | Remove copy that hides limits: "Higher daily allowance" when it is unlimited, the two stale MCP messages, and state the Agency cap of 200 hosted paid calls a day (`worker/mcpLimits.ts:19`) | Fix PR with the pricing copy; may ship now |
| VN3-2 | Meter AI model calls from OpenRouter's reported cost into `cost_events`. **Pulled forward: lands with or right after VN2-0, before the grid** | VN2-0 |
| VN3-3 | Pick one spend unit | VN-D3 |
| VN3-4 | Show the price on every paid approval (Oracle, MCP, grid); refuse when it would pass the budget | VN3-2, VN3-3 |
| VN3-5 | Budget screen on the existing API | VN3-3 |

### VN4: OpenAI-shaped endpoint (edit to Track AE; after 28 Dec)

Expose only Luminara's own agents as "models" (the auditor, fixer and coach already on MCP, `worker/mcpAgents.ts:24-46`), on Agency API keys, metered by VN3. No passthrough of outside models.

### 4.1 Payer link

- **19 Nov gate (150 activated, 3 payers):** nothing here moves it.
- **3 Dec gate (625, 6 payers):** nothing here is on the path. The teaser is possible only if VN2-0 lands by 22 November.
- **28 Dec gate (1,000, 10 payers):** the grid (VN2-3) is what an agency would pay for: "show my client which AI models recommend them". Paid plans only.
- **VN0 moves no gate.** It ships because the policy and the code disagree.

## 5. Gaps no owner plan records

| ID | Gap | Evidence | Proposed home |
|---|---|---|---|
| VN-1 | Model labels name consumer products the check never queried | `llmAnswerProbeService.ts:22`, `:24` | W4 item 6 (copy honesty) and VN2-1 |
| VN-2 | Policy and terms describe sync and key upload the code does not do | Section 2.1 | VN0-1 |
| VN-3 | Oracle session store survives account deletion and is not exported | `worker/oracleSession.ts:224-237` | PR #308 follow-up |
| VN-4 | A dormant service invents competitor data, against product invariant 5 | `citationScoutService.ts:140-149` | VN2-5 |
| VN-5 | No provider is asked not to keep or train on prompts | `OpenRouterProvider.ts:54-59` | VN0-2 |
| VN-6 | The VUT worktree's spec and migration numbers are taken on staging and in PR #304 | Section 4, VN2-0 | VN2-0 |

## 6. Non-goals

- **No general chat or model marketplace.** The model list exists to measure, not to resell.
- **No "uncensored" positioning.**
- **No image, video, music or character generation.**
- **No own GPUs.**
- **No enclave or end-to-end modes** until a paying customer asks.
- **No token for API credit, no staking, no yield.** LORA rule J6 bans "yielding" wording; Track ZC rules out token rewards.
- **No passthrough of outside models** under the Luminara name.
- **No Venice name, wording, design or comparative claims** in product, marketing or code.

## 7. Owner decisions

Three are needed before 28 December. The other three can wait.

| ID | Decision | Recommended | Needed |
|---|---|---|---|
| VN-D1 | Signed-in chat sync: change the policy to match the code, or add a switch to match the policy | **Change the copy now**; add "Don't save this chat" in VN1-1 | Now (blocks VN0-1) |
| VN-D6 | May the VUT worktree be committed and reviewed | **Yes**; it is the base for VN2 | Now (blocks VN2) |
| VN-D4 | Teaser spend cap | **AUD 5 a day and 100 runs, stops itself.** A starting figure, not a measured cost: the real cost per run comes from VN2-0's cost reporting | Only if the teaser is built |
| VN-D2 | Which providers may carry a "Private" label | **Only those with zero-retention terms confirmed in writing** | After 28 Dec |
| VN-D3 | One spend unit: Lumen or billed cents | **Decide with the budget plan** | After 28 Dec |
| VN-D5 | Keep the bring-your-own-key relay open without sign-in | **Keep**, as Settings promises; revisit if abuse shows up | After 28 Dec |

## 8. Review record

**Round 1 (2026-11-15).** Two independent reviewers read v0.1.

- **CEO gate: GO WITH CONDITIONS.** Applied: teaser taken off the 3 December path, with a minimal cut and a 22 November cutoff (1); teaser controls listed, and VN-D4 given a number (2); legal risks added as section 3.1, VN0-1 marked blocked on VN-D1, counsel review step added (3); vendor terms and zero-retention table added as section 3.2 (4); brand line on "via API" wording (5); VN2-5 and VN3-1 marked as fix PRs (6); VN2 and VN3 changed to edits of their owner plans with no separate work order (7); decisions split into now and after 28 December, with bold recommendations (8); per-user run cap and paid-only grid (9); short glossary (10); competitor sentence softened (11).
- **Citation verifier.** Every `file:line` in sections 2 to 5 checked against `63b39069`. Corrected: Oracle session delete handler is `:224-237`; provenance hashes request metadata, not the prompt (`oracleChat.ts:225-233`); approval event is `:646-654`; MCP agents are `:24-46`; budget read route is `:1881-1884`; the 200-call cap is Agency only; the VUT cost flag is conditional on `reportCost`; chat is read from `sessionStorage`; `LegalPage.tsx:63` and `termsPolicy.ts:65` added as evidence; "8 conflicting files" in PR #304 dropped (a recount found 4). Claims the verifier could not confirm were then checked by hand: D1 storage format (`worker/userStore.ts:598-606`), `citationScoutService` imported only by its test, no component calls the budget API, free plan has MCP (`planEntitlements.ts:59`), relay rate limit (`worker/index.ts:1016-1024`). Left as inference and worded so: no label for the main provider after failover; no prompt in logs.

**Round 2 (2026-11-15), closing check by the CEO reviewer: GO WITH CONDITIONS, conditions applied.** All eleven round-1 findings confirmed fixed; new citations (`worker/userStore.ts:598-606`, `migrations/0002_accounts_workspace.sql:13-16`, `components/LegalPage.tsx:63`, `worker/termsPolicy.ts:65`, `services/plans/planEntitlements.ts:59`, `worker/index.ts:1016-1024`, `worker/mcpAgents.ts:24-46`) confirmed. Applied: VN3-2 pulled forward ahead of the grid, and the teaser's spend counter reads VN2-0's reported cost, so the 28 December path no longer depends on post-28 December work (1); a line under the answer names the two decisions needed now (2).

**Next:** owner review. Ship as a docs-only draft PR to `staging`. Do not commit it as approved.
