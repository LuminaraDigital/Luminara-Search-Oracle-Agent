# Zentry concepts: map and build order (Track ZC)

**Status:** v0.3. Two review rounds (section 7): the CEO gate went from conditional go to GO, and the citation check's corrections are applied. Waiting for the owner. No code. Nothing in it is approved by the owner.
**Date:** 2026-11-15
**Owner:** Luminara Digital (owner gate before every production step)
**Source:** the owner asked whether Luminara can build its own, much better version of what `zentry.com/whitepaper` describes. Concepts only. No Zentry name, text, design or token.
**Citations:** `origin/staging` at `63b39069` unless a line says otherwise. `docs/plans/outcome-dataset-capture.md` is untracked; its citations are from the working tree.
**Rules:** inherits section 2 of `docs/plans/zoro-concepts-implementation-plan.md`.
**Related (binding owners):** Allora `docs/plans/allora-concepts-implementation-plan.md` (fix retest), Track SW `docs/plans/founder-swarm-business-brain-additive-plan.md` section 14 (quests and badges), Trust Network `docs/plans/trust-network-additive-plan.md` (receipts, domain verification, proof feed), spec `specs/0016-agent-passport.md` (agent identity), Track OD `docs/plans/outcome-dataset-capture.md` (data layer), `docs/plans/lora-jetton-production-ship.md` (token).

---

## The answer in plain English

Zentry's public pages describe a big idea (apps, AI agents and data, tied together with a token) but show no working product, no numbers and no token details. There is nothing to out-build except a promise.

What Luminara can do better is one sentence: **we found the problem, you fixed it, we proved the fix held.** Every reward, level, badge and agent reputation then comes from that proof, not from clicks.

Most of it is already designed in four existing plans. What is missing is finishing them in the right order. The first payer-facing piece is the automatic fix retest (step 4 below). Points, badges, agents and the token come later, and none of them is what brings the first payers.

"100x" cannot be measured here, so this plan does not claim a multiple. It claims a result anyone can check.

## 0. Verdict

**Luminara does not need a new plan to beat Zentry. It needs to finish one path that is already designed.**

Every Zentry layer has an owner plan here already (section 2). Two of those plans already state the idea that makes Luminara's version better: **reward only what the server has checked**. Track SW section 14 says a quest is completed by a server-attested event, never by a tap. Allora reports an issue as gone only if the server saw it first.

The chain, built in order:

> server sees the issue → founder ships a fix → server retests → **fix held** → quest, level, badge, agent track record → consented outcome data

Today that chain breaks at its first link: the server cannot tell that a finding was fixed (section 2.2). Allora Phases 0 to 2 repair it. Everything else waits on it.

This document adds three things only:
1. the map from Zentry's layers to the owner plans (section 2);
2. one build order across those plans, tied to the growth gates (section 3);
3. three gaps no owner plan fully records yet (section 4), each proposed as an edit to its owner plan, not built here.

## 1. What Zentry actually publishes

Fetched with a web reader on 2026-11-15 while drafting; not re-checked since:

- `zentry.com/whitepaper` is a navigation page with no whitepaper body.
- `zentry.com/about` describes a three-layer stack (zAPP, zAI, zDATA), a mission statement and a list of investors. Its metrics section has no numbers, and the investor paragraph repeats nine times.
- `terminal.zentry.com` showed a maintenance placeholder.
- `radiant.gg` and `docs.zentry.com` did not resolve.
- No ZENT supply, allocation, staking or burn figures were found on any of these pages. This plan says nothing about Zentry's token, and Luminara should make no public comparison with it.

## 2. Map

### 2.1 Layer by layer

| Zentry layer | Luminara equivalent | Owner | State on staging |
|---|---|---|---|
| **Apps with game mechanics** | Missions, weekly streak, Visibility Level | spec 0009, `services/referrals/rules.ts:47-66`, `:202-214`, `:247` | Live with no flag, if migration `0012_referrals_missions.sql` is applied. Its header (`:8`) still says unapplied, while `scripts/smoke-check.mjs:26`, `:57-59` require its tables; confirm with `migrations list` |
| | Points ("Lumens"), ranks, daily check-in | Track SW hazard 9, decision 9, SW0a-10 | Built, off: `LUMENS_ENABLED` is `"false"` (`wrangler.jsonc:158`, `:306`, `:423`) |
| | Quests completed by verified events | Track SW SW9-0 to SW9-5 | Plan only |
| | Badges as signed receipts | Track SW SW9-3, TN | Plan only. Receipt types already list `fix_retested` (`services/trust/receiptTypes.ts:15`, `:69`) |
| | Hosted-scout credits, the only real reward | `worker/referrals.ts`, table `referral_rewards` | Live, no flag |
| **Agent layer** | One identity and spend ledger per credential | spec 0016 K0 (marked Done), `migrations/0019_agent_passport_k0.sql:6-10` | On staging |
| | Tool risk levels and one-time approvals | `worker/mcpGovernance.ts` | On staging |
| | MCP server with OAuth for outside agents (Grok, Claude) | `/mcp`, `/oauth/mcp/*` in `worker/index.ts` | On staging |
| | Agent passport surface, caps, signed log | spec 0016 K1 to K6, TN4 | Plan only |
| | Agent that commits and checks fixes | Agentic Oracle, PR #340 (open, draft) | Draft, flags off |
| **Data layer** | Signed receipts, domain verification | TN0 to TN2 (`worker/trustReceipts.ts`, `worker/domainVerification.ts`) | Built, off: `TRUST_RECEIPTS_ENABLED` and `DOMAIN_VERIFY_ENABLED` are `"false"` (`wrangler.jsonc:139`, `:142`, `:287`, `:290`, `:406`, `:409`) |
| | Public proof feed | TN5 | Plan only |
| | Outcome data, consent, own model | Track OD, OD0 to OD5 | Plan only. OD-1 still open |
| | Answers for outside agents ("visibility oracle") | Allora CL2-6 (`get_weekly_decision`, own data only), Track OD | Plan only. No cross-customer data may leave: the uses listed at `public/privacy.html:44` include no such use |
| **Token** | LORA, fixed supply | `contracts/jetton`, LORA plan | Not deployed (`contracts/jetton/deployments.json` is null on both networks). Checkout hard-off (`worker/tonPayment.ts:71`, `:78`). **No payout code exists, and none is planned here** |

### 2.2 Where the chain breaks today

| Link | Today | Fixed by |
|---|---|---|
| Server sees the issue | Findings are made in the browser and posted as given (`services/audit/findingBoardService.ts:172-218`) | Allora CL0-1, CL0-5, CL1-4 (server baseline at commit) |
| Same issue across two audits | Identity is a hash of the title (`services/audit/findingStableKey.ts:32-35`); a reworded title is a new finding | Allora CL0-5 (rule ids) |
| Server retests | `worker/recheckFix.ts` runs a check and stores nothing | Allora CL1-1 (`decision_checks` table), CL2-1, CL2-2 (daily retest) |
| Only the server says "fixed" | `PATCH /findings/:id` accepts any listed status from the caller (`worker/findingsService.ts:222-257`) | Allora CL2-2 outcome `cleared`; ZC-1 below |
| Reward follows a held fix | No reward is tied to any outcome; `checklist_fix` is client-marked (`services/referrals/rules.ts:60-64`) | Track SW SW9-2 |
| Reward goes to the site's owner | Domain verification exists but is off, and nothing outside audit receipts requires it | TN2 on; Track SW 14.1 "Whose site" rule |

## 3. Build order

Growth outranks new features until 28 December. Steps 1 to 4 are the spine and the only steps proposed before that date. Steps 5 to 9 are listed so the order is fixed, not because they are scheduled.

| Step | Work | Owner tasks | Gate before it starts | When |
|---|---|---|---|---|
| 1 | Findings keep their own id; evidence is not wiped | Allora CL0-1 (hotfix, ships alone) | Build and staging may start now. Production waits until CL0-0 records the promotion path GitHub enforces (Allora 2.2) | Now |
| 2 | Groundwork: limits check, fetch wrapper, flags, shared rule ids | Allora CL0-0, CL0-2 to CL0-5 | Allora owner decisions (Allora section 12; gate status in its header) | Before 3 Dec |
| 3 | Server baseline when a decision is committed | Allora CL1-0 to CL1-5 | CL0-0 result | Before 3 Dec |
| 4 | Daily retest, before and after on the card, pricing line | Allora CL2-0 to CL2-5, CL2-8 | Allora Phase 1 promoted, including its 14-day coverage read | December at the earliest |
| 5 | Domain verification on, staging first | TN2 flag flip | Owner says yes; signing key set per environment | May be pulled forward: cheap, and it lowers trust and legal risk |
| 6 | Quests and level fed by held fixes | Track SW SW9-0 to SW9-2, SW9-4, SW9-5 | SW decision 9; step 4 promoted | After 28 Dec, owner-gated |
| 7 | Badges and public proof feed | SW9-3, TN5 | P14 (TN1 receipts on); step 5 | After 28 Dec, owner-gated |
| 8 | Agent track record shown on the passport | spec 0016 K-series, with ZC-2 | Step 4 promoted; an agent path that writes decisions | After 28 Dec, owner-gated |
| 9 | Consented outcome data; outside "oracle" answers | Track OD, OD2 to OD5 | OD gates, including lawyer review and consent | After 28 Dec, owner-gated |

### 3.1 Payer link

- **19 Nov gate (150 activated, 3 payers):** nothing here moves this gate; it is four days away. Growth work comes first.
- **3 Dec gate (625, 6 payers):** steps 1 to 3 give a demo, not a product: a decision whose issue the server has seen and recorded.
- **28 Dec gate (1,000, 10 payers):** step 4 is the first thing a customer can pay for here ("Automatic fix retest at your verify date", Allora CL2-8, Starter and above). Allora's 14-day coverage read means it is unlikely to be sellable before mid-December.
- **Usable now, without the spine:** the existing on-demand re-check (`worker/recheckFix.ts:10`, `:65`, which reads the page through `services/upgrade/recheckReading.ts`) can be shown in sales demos and upgrade prompts as "we re-checked your page". It stores nothing, so it is a demo and never a basis for rewards. Each run uses the visitor's hosted quota (refunded only when the reading is not measured). Its label must say it checks page source, not AI answers.
- **If the 19 Nov or 3 Dec gate is missed,** steps 2 to 4 do not displace growth work. Step 1 still ships, because it fixes data loss.

## 4. Gaps no owner plan fully records

Each is proposed as an edit to its owner plan, in a separate docs PR, per the shared-tree rule. None is built here.

| ID | Gap | Evidence | Proposed edit |
|---|---|---|---|
| ZC-1 | When a finding has a server check, a client can still set it to `done` directly, so a held fix and a self-marked one look the same | `worker/findingsService.ts:228-256` takes any listed status from the body and writes it | Allora CL2-2: once a finding has a `decision_checks` row, a client PATCH to `done` is stored as self-reported, and only a `cleared` outcome counts for SW9 |
| ZC-2 | A decision committed by an agent could not be told apart from one committed by the person, so "fixes that held, by agent" could not be counted | `worker/weeklyDecisionService.ts:147`, `:164` writes `created_by` as `user.id` only. `0014_weekly_decision_loop.sql` is the only migration on the table and has no credential columns, while `cost_events` has them (`migrations/0019_agent_passport_k0.sql:6-10`). Today MCP only reads decisions (`worker/mcpAgents.ts:260`, `:333`), so the gap opens when an agent path writes them (PR #340 or a key-authenticated call) | Allora CL1-1 migration: add nullable `credential_kind` and `credential_id` to `weekly_decisions`, written from the calling credential, and covered by that task's export and delete list. Spec 0016 owns how a track record is shown |
| ZC-3 | The daily check-in "streak" counts every check-in ever made, so a missed day never resets it and the "7-Day" card can show "Day 9 of 7" | `worker/referrals.ts:636-645` (`COUNT(id)` of all `daily_checkin` rows); `components/retention/DailyStreakCard.tsx:93` has no cap. Dormant while `LUMENS_ENABLED` is off. Track SW 14.4 option B keeps a streak count but does not define it; SW3-3 recomputes the mission streak only | Track SW 14.4: whichever option the owner picks, a check-in streak counts consecutive UTC days |

## 5. Non-goals

- **No token rewards.** LORA pays nothing out. Points stay non-transferable with no cash value. Reopen only after lawyer review and with paying customers, as its own plan.
- **No token-gated or token-priced credits or quests.** Nothing here depends on LORA being deployed.
- **No paid quests.** Track SW 14.1 already rules out a quest completed by a payment; this plan keeps that.
- **No data sale or training** before Track OD's consent gates pass.
- **No points for activity alone.** Once step 6 ships, opening the app or tapping "done" never counts toward a level, quest or badge.
- **No Zentry name, wording, design or token mechanics,** and no comparative claims about Zentry or any competitor's token or metrics, in product, marketing or code.

## 6. Owner decisions

All of these already exist in their owner plans. This plan adds none.

| Decision | Where | Why it matters here |
|---|---|---|
| Allora decisions 1 to 5 (gate status in its header) | Allora section 12 | Unblocks steps 2 to 4, the spine |
| SW decision 9 (what happens to Lumens) | Track SW section 14.4 | Decides step 6 and ZC-3 |
| Domain verification on, staging first | TN plan | Step 5 |
| OD-1 (keep the own-model option open) | Track OD section 8 | Step 9 |

## 7. Review record

**Round 1 (2026-11-15).** Two independent reviewers read v0.1.

- **CEO gate: conditional go.** Applied: plain-English answer added above section 0, and "100x" stated as unmeasurable (2); step 1's gate corrected to Allora 2.2, where production waits on CL0-0 (1); payer link added as section 3.1 (3); steps 5 to 9 labelled, with step 5 allowed forward (4); ZC-3 narrowed to what Track SW does not cover, and marked dormant (5); ZC-2 now notes that MCP only reads decisions today and adds the export and delete line (6); non-goals gain token-gated credits, paid quests and comparative claims (7); section 1 records how and when Zentry's pages were read (8); this record (9).
- **Citation verifier.** All `file:line` citations checked against `63b39069`. Corrected: OD-1 is in Track OD section 8, not 7; `decision_checks` is created by Allora CL1-1, not CL2-1; ZC-2's bind line is `:164`; "Allora owner gate" reworded as Allora section 12 decisions plus its header. Not verified, and left as checks for whoever builds: whether `0012` is applied on remote D1; whether K0 is live in production; the auth path of `/mcp`.

**Round 2 (2026-11-15), closing check by the CEO reviewer: GO.** All nine round-1 findings confirmed fixed; new citations (`worker/recheckFix.ts:10`, `:65`; `worker/mcpAgents.ts:260`, `:333`; `components/retention/DailyStreakCard.tsx:93`) confirmed. Two minor wording points applied: section 3.1 says nothing here moves the 19 Nov gate, and the demo re-check notes that it uses quota.

**Next:** owner review. Ship as a docs-only PR to `staging`, kept as a draft until the owner says go. Do not commit it as approved.
