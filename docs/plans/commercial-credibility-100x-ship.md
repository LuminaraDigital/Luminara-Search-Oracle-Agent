# Commercial credibility 100x ship (production + deploy ready)

**Date:** 2026-10-10  
**Status:** CC0-CC4 code complete and verified in tree (2026-10-10). CC5 funnel instrumented; live payer cohort ops active.  
**Owner:** CEO craft loop + full-stack + payments + AI honesty + activation  
**Companions:** [`conversion-honesty-ship.md`](./conversion-honesty-ship.md) (C0-C2 done; **C3 promoted from optional to required**), [`landing-moat-100x.md`](./landing-moat-100x.md), [`landing-app-coherence-ship.md`](./landing-app-coherence-ship.md), [`user-activation-first-value.md`](./user-activation-first-value.md), [`weekly-decision-loop-10x-ship.md`](./weekly-decision-loop-10x-ship.md), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), [`go-live-open-items.md`](./go-live-open-items.md), [`tasks/deploy-gates.md`](../../tasks/deploy-gates.md)  
**Reviews:** CEO commercialization audit + reliability + Stripe + Fix/streak subagents (2026-10-10). Double-check protocol below is mandatory after every phase and at spine close.

## Why this plan exists

Third-party sellability critique (2026-10-10) and CEO review agree: the problem is real (AI answer engines mentioning a business), honesty is a moat, Telegram/Stars/TON is a channel edge, and the ladder Starter $49 / Growth $149 / Agency $349 is sensible. What blocks charging confidently is not "more features." It is:

1. **Reliability** when providers run out of credit.  
2. **Trust** when invented-looking scores contradict Methodology.  
3. **Hard to pay** on web (no production-proven self-serve card).  
4. **Unclear pitch** (SEO / AEO / GEO / Oracle / Scout / Studio / Labs / Launchpad).  
5. **No proof** (users, retention, before/after).  

**North-star (locked):** Web card checkout unlocks after **CC2** go-live. Count **10-20** paying Starter/Growth accounts in the **30 days after CC2** production Card is live, with zero Methodology contradictions on the paid path. CC5 is measurement, case artifacts, and acquisition ops for that cohort (not the payment unlock). Not a public KPI claim until numbers are real.

**100x definition (this spine):** Order-of-magnitude lift in commercial credibility: (a) fail-closed honesty under credit failure, (b) self-serve Stripe that matches Pricing, (c) one clear product loop visitors understand in five seconds, (d) return habit via Fix list + daily streak, (e) real payer proof. Not "add more Suite nouns."

---

## 1. Pushback (locked)

| Impulse | Decision | Why |
|---------|----------|-----|
| Ship card UI copy before staging purchase works | **Refuse** | Half-ship Stripe is a new honesty lie (Pricing already conflicts: hero claims Stripe, footer says closed beta) |
| Keep inventing healthScore 74 / schemaSafety 50 | **Refuse** | Contradicts APS + Methodology; churns paying users |
| Fix reliability by adding more providers without gates | **Refuse** | Fail-open fallbacks that mint scores are the bug |
| Broaden pitch to Oracle + Studio + Labs + Launchpad | **Refuse** | Five-second clarity fails; park behind "More" |
| Fake case studies / "got cited in 3 weeks" without data | **Refuse** | Moat forbids invented proof; kills YC / agency trust |
| Jetton / LORA / USDT as primary web checkout | **Defer** | Finish Stripe first; crypto remains TMA/optional |
| Full GameFi Lumens economy for streak | **Defer** | Decision 9: streak without points theater (option B) |
| Auto-deploy prod Worker without chat approval | **Blocked** | Operator gate |
| Promise 10x conversion without baseline | **Refuse** | Ship honesty + pay + habit, then measure |

---

## 2. Ground truth (2026-10-10)

Assumption: **production / `origin/main`** is what customers buy. Local working tree may be ahead of main.

| Track | Prod / main | Local tree | Blocker |
|-------|-------------|------------|---------|
| Probe honesty C0-C2 | Shipped | Shipped | Browser 1440+375 polish open |
| Instant Audit crew nulls on empty / 401 | Mostly shipped | Mostly shipped | Residual invent paths below |
| Oracle Gateway healthScore | Invents **74** | Same | P0 honesty |
| Stripe Checkout | Deferred / absent | Scaffold: `worker/stripePayment.ts`, `migrations/0021_stripe_payments.sql`, Paywall Card tab | Secrets, migrate, honesty gate, rank-guard |
| Pricing copy | Stars/TON honesty on main | **Conflict:** claims live Stripe + closed beta footer | Release blocker |
| Pitch one-liner | Weaker category hero on main | Local: "See if AI recommends…" | Drop "15 minutes" unless measured |
| Fix list | Cosmetic templates | `ActionableFixList.tsx` hardcoded | Not evidence-bound |
| Daily streak | Cosmetic | `DailyStreakCard.tsx` localStorage, never advances | Server check-in unwired |
| Paying-user proof | None | None | CC5 ops |

**Residual invent evidence (must kill in CC1):**

- `services/decision/fastDecisionService.ts` hardcodes `healthScore = 74`  
- `worker/oracleGateway.ts` Observer stub fabricates scrape success  
- `services/geminiService.ts` seeds `schemaSafetyDefault = 50` into citeWorthiness  
- `services/agentCore/agents/playbookAuditorAgent.ts` formula `baseScore = 85` must be labeled `estimated`, never `measured`  
- Tavily fail-open to free search can mint weak "success" without degraded labeling  
- Hosted auth circuit trips on 401/403 but not `quota_exhausted` / credit 429  

**Stripe honesty hazard (must fix in CC0 or hide Card):**

- `components/PricingPage.tsx` hero: "Instant self-serve card checkout powered by Stripe"  
- Same file footer: "Credit card checkout is available on request during closed beta"  
- `tests/pricingDiscoverability.test.ts` still expects closed-beta card copy  

---

## 3. Product locks (commercial)

| Lock | Choice |
|------|--------|
| One-line pitch | **See if AI recommends your business, and fix it.** |
| Primary nouns (fold + signed-in home) | Instant Audit, Ask (Oracle chat behind Ask), Fix list, Re-check, Pricing |
| Parked nouns (nav "More" / Labs only) | Studio, Launchpad, Idea Scout as hero, TimesFM, OracleMind, VFS, constellation marketing Three.js |
| Buyer (web fold) | Founders / small-team operators; Agency + MCP are upsell |
| Web payment | Stripe Checkout primary when CC2 green; Stars/TON secondary |
| Telegram Mini App payment | Stars (and TON if live); **no card tab inside TMA** for digital goods (SW0a-6) |
| Metrics | APS only: `measured` / `estimated` / `not_measured` / `unknown`. Never bare 73/100 as Measured without collection |
| Trust receipts | Keep signed receipts; never claim Measured engines from Probe crawl alone |
| Streak (decision 9) | **Option B:** server-backed daily streak count; no Lumens theater on open until separately approved |
| Fix list | Audit-derived top 1-3 when findings exist; 3 templates only as labeled "starter checklist" for empty Sample |
| Proof | Real dated before/after only; Methodology caveats; no invented retention % |
| First payers | Luminara agency clients + founder network; concierge OK until Stripe green |

---

## 4. Architecture (ship shape)

```
Visitor
  → Landing (one pitch)
  → Probe (Sample / Live crawl honesty)
  → Free account
  → Instant Audit (hosted Free quota)
       │ fail: not_measured + recovery UX (never fake score)
       ▼
  Fix list (findings or labeled templates)
       ▼
  Daily streak / Re-check (server check-in)
       ▼
  Paywall: Card (Stripe web) | Stars/TON (TMA)
       ▼
  writeSubscriptionRecord → entitlements
       ▼
  Growth: share + MCP; Agency: apiAccess
```

**Reliability rail (CC1):**

```
Provider 401/403/429 credits / quota_exhausted
  → run-scoped provider_unavailable
  → auditEvidenceGate blocks score mint
  → viewers: not_measured + BYOK / retry / quota copy
  → no LLM report inventing citation %
```

**Stripe rail (CC2):**

```
POST /api/stripe/create-checkout-session (auth-bound userId)
  → Stripe Checkout mode=payment (or Billing later)
  → webhook signature verify
  → claimStripeSession (D1 0021) → writeSubscriptionRecord
  → Pricing/Paywall claim Card only if health says configured
```

---

## 5. Phases CC0-CC5 (CEO ship order)

**Default order:** CC0 → CC1 → CC2 → CC3 → CC4 → CC5.  
**Parallel after CC0:** CC1 honesty can overlap CC2 Stripe code polish if Pricing Card is **hidden** until CC2 exit.  
**Never:** claim Stripe live, or ship Gateway 74, while CC0/CC1 open.

Each phase ends with: targeted tests, `npm run typecheck`, phase double-check protocol (§8), CEO kill criteria. No next phase until exit is green.

| Phase | Work | Exit | Deploy | Rollback |
|-------|------|------|--------|----------|
| **CC0** | Stop new lies: gate Pricing/Paywall Card claims; align Terms/README; hide Card in TMA | Zero "instant Stripe" without live secrets+webhook | FE anytime | Revert copy |
| **CC1** | Reliability + honesty residual (Gateway, 429/quota, Tavily, gemini 50, estimated labels) | Fail = `not_measured`; no 74/50 invent; tests green | FE+Worker staging | Prior SHA |
| **CC2** | Stripe C3 production: secrets, migrate 0021, rank-guard, guest attribution, smoke purchase | Staging card grants Growth; Pricing matches Worker | Staging then prod (operator) | Prior SHA; do not delete credited D1 rows |
| **CC3** | Pitch + IA: one-liner on main; Dashboard primary loop; park Studio/Labs | Five-second clarity; jargon off fold | FE | Prior FE |
| **CC4** | Fix list + daily streak (server); optional opt-in reminder | Scout → fix → day-2 re-check works | FE+Worker | Hide streak CTA |
| **CC5** | Proof + 10-20 payers: instrument funnel; 2 real case studies; agency close | 10-20 paid; churn logged; no fake testimonials | Ops | N/A |

### Effort (order of magnitude)

| Phase | Effort | Blocks charging? |
|-------|--------|------------------|
| CC0 | 0.5 day | Yes (honesty) |
| CC1 | 2-4 days | Yes |
| CC2 | 3-5 days | Yes (web SMB) |
| CC3 | 1-2 days | Soft (conversion) |
| CC4 | 3-5 days | Soft (retention) |
| CC5 | 2-4 weeks ops | Yes (credibility) |

---

## 6. Phase detail (files + acceptance)

### CC0 - Stop the Stripe / copy lie (ship blocker)

**Goal:** User-facing payment truth is one story everywhere. Operators stop treating Stripe as optional deferral.

**Tasks**

1. Gate Card tab and Pricing "Pay with Card (Stripe)" behind Worker health / `STRIPE_SECRET_KEY` configured **and** staging-proven webhook, or remove claims until CC2 exit.  
2. Align `PricingPage.tsx` hero, footer, `PaywallModal.tsx`, `worker/termsPolicy.ts`, README.  
3. Hide Card rail in Telegram Mini App (Stars only).  
4. Update `tests/pricingDiscoverability.test.ts` to match the chosen truth (closed beta **or** live).  
5. Amend docs so operators cannot follow an old "defer Stripe" default: `conversion-honesty-ship.md` status + operator checklist ("Confirm Stripe: defer") must point here (C3 required for charging).  
6. Papercut: note any remaining "card on request" vs live conflict in `.agents/PAPERCUTS.md` if deferred overnight.

**Acceptance**

- [x] No page claims instant self-serve Stripe unless staging purchase + webhook credit succeeded this release.  
- [x] TMA has no Card checkout tab (`cardAvailable` false in Telegram; `STRIPE_CHECKOUT_LIVE=false` until CC2).  
- [x] Discoverability tests green.  
- [x] `conversion-honesty-ship.md` no longer presents Stripe deferral as the default for web commercialization.  
- [x] `npm run typecheck` green.

**Kill:** Shipping contradictory Pricing copy; leaving "Confirm Stripe: defer" as the operator default.

**Files:** `components/PricingPage.tsx`, `components/paywall/PaywallModal.tsx`, `services/payments/paymentOptions.ts`, `worker/termsPolicy.ts`, `tests/pricingDiscoverability.test.ts`, `docs/plans/conversion-honesty-ship.md`, README.

---

### CC1 - Reliability + honesty residual (ship blocker)

**Goal:** Paying customer never sees a fake score or a silent empty "success" audit when credits die.

**Tasks**

1. **Oracle Gateway / Fast Decision:** If scrape/search skipped or failed → `healthScore: null`, `measurementStatus: 'not_measured'`. Delete hardcoded 74. Flip `tests/oracleGateway.test.ts` accordingly.  
2. **Quota / 429:** Extend hosted circuit or run flag so `quota_exhausted` / credit 429 blocks score mint like 401/403.  
3. **Tavily:** Fail-open free search must mark run `search_degraded` / `provider_failed`; health stays blocked unless evidence meets gate.  
4. **Gemini:** Remove `schemaSafetyDefault = 50` from preliminary citeWorthiness; use `not_measured` until schema measured.  
5. **Playbook formula score:** Persist `estimated` (not `measured`) for 85-minus-penalty health; UI copy matches Methodology.  
6. **Hosted chat fallbacks:** In `worker/providerRelay.ts`, Groq / Workers AI (or other) silent fallbacks on credit/401/429 must surface `HOSTED_PROVIDER_DEPLETED` (or equivalent) to Instant Audit / Oracle paths and must **not** mint Measured scores or citation % from degraded chat output.  
7. **UX:** Instant Audit banner for hosted depleted / BYOK path (reuse `liveDataUnavailableCopy` patterns).  
8. **Tests:** Gateway honesty; Instant Audit 429 credits; Tavily degraded; gemini preliminary pack; providerRelay depleted path; keep `tests/agentCore/auditHonesty.test.ts` green.  
9. Staging smoke: force hosted key 401 and credit-zero; assert no numeric citation/health as Measured.

**Acceptance**

- [x] Gateway with stub/failed evidence → null health, not 74.  
- [x] Firecrawl/Tavily credit failure → null metrics + recovery banner; no LLM inventing citation %.  
- [x] Hosted provider depleted / chat fallback → `HOSTED_PROVIDER_DEPLETED` (or equivalent) visible; no Measured mint from fallback prose.  
- [x] Prompt packs do not inject `/100` from invented schemaSafety 50.  
- [x] Formula scores labeled estimated.  
- [x] `npm test -- tests/agentCore/auditHonesty tests/oracleGateway tests/guestScoutHonesty` green (adjust names to match tree).  
- [x] Staging honesty smoke recorded in PR notes.

**Kill:** Any new bare 0-100 "AI visibility" on Sample or failed providers.

**Files:** `worker/oracleGateway.ts`, `worker/providerRelay.ts`, `services/decision/fastDecisionService.ts`, `services/search/tavilyService.ts`, `services/audit/hostedAuthCircuit.ts` (or equivalent), `services/geminiService.ts`, `services/agentCore/agents/playbookAuditorAgent.ts`, Instant Audit / ReportDisplay copy, honesty tests.

---

### CC2 - Stripe self-serve (required for web commercialization)

**Goal:** Starter $49 / Growth $149 / Agency $349 purchasable by card on web; entitlements match Stars/TON.

**Tasks**

1. Merge/PR `worker/stripePayment.ts`, `migrations/0021_stripe_payments.sql`, ledger helpers, routes (already scaffolded locally).  
2. **Auth-bind checkout:** Prefer session `identify()`; reject spoofable body `userId` for other accounts; guests must sign in before Checkout (or bind session after success with signed state).  
3. **Rank-guard:** No Starter overwrite of active Agency (parity with Stars/TON).  
4. **Refund policy:** Document v1 (manual revoke) or implement `charge.refunded` unwind.  
5. Tests: `handleCreateStripeCheckoutSession` (503 without secret, invalid plan, happy mock); webhook replay; rank-guard; missing secret 503.  
6. Staging: apply `0021`, `wrangler secret put STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, Dashboard webhook → `/api/stripe/webhook`.  
7. Buy each tier with test card; confirm KV `sub:` + D1 claim + entitlements.  
8. Only then flip Pricing/Paywall to claim Card (CC0 gate opens).  
9. **Billing honesty (hard gate):** Before claiming Card live, either implement Stripe Subscriptions for true `/ mo` auto-renew, **or** change all Paywall/Pricing copy to "30 days" (no `/ mo` auto-renew implication). Checkout `mode=payment` alone must not be marketed as a subscription.  
10. Prod: `npm run db:backup:prod` → migrate → live secrets → live webhook → `npm run smoke:prod` → one real test charge.  
11. Update `conversion-honesty-ship.md` C3 acceptance checkboxes to done (required status already set in CC0).

**Acceptance**

- [x] Staging: card purchase grants Starter/Growth/Agency entitlements.  
- [x] Webhook signature verified; replay-safe (`duplicate: true`).  
- [x] Pricing claims card only when configured end-to-end.  
- [x] Copy matches billing mode: Subscriptions if `/ mo`, else explicit "30 days".  
- [x] Rank-guard prevents paid downgrade clobber.  
- [x] TMA still Stars-first (no Card).  
- [x] Create-session + webhook tests green.  
- [x] Operator runbook steps recorded in PR.

**Kill:** Public create-session that credits arbitrary `userId`; Card claim without secrets; `/ mo` copy on one-shot 30-day grants.

**Files:** `worker/stripePayment.ts`, `worker/paymentLedger.ts`, `worker/userStore.ts`, `worker/index.ts`, `worker/env.ts`, `migrations/0021_stripe_payments.sql`, `services/apiClient.ts`, Paywall/Pricing, `tests/stripePayment.test.ts`.

**Note on Billing:** v1 may stay Checkout `mode=payment` (30-day grant). If Paywall says "/ mo" with auto-renew, either switch to Stripe Subscriptions or change copy to "30 days" before claiming live.

---

### CC3 - One pitch + product surface (conversion)

**Goal:** Visitor understands the product in five seconds; signed-in home matches the pitch.

**Tasks**

1. Landing H1 (main): **See if AI recommends your business, and fix it.** Remove "in 15 minutes" unless timed in dogfood.  
2. Supporting sentence: one line on ChatGPT / Perplexity / Google AI answers + Fix list.  
3. Dashboard: primary doors Instant Audit, Fix list / This week (Decision Card), Re-check / streak. Move Studio/Labs/Launchpad/Scout-as-hero to "More".  
4. Scrub fold jargon: BYOK, entitlement, fixture, operator loop (keep conversion C2 scrub).  
5. Scrub **SEO / AEO / GEO** as equal-weight fold/hero labels (Methodology may keep them as depth terms). Scout is not a hero noun.  
6. Methodology + FAQ stay aligned with Probe Sample vs Live.  
7. Hallmark: no invented stats on landing; no purple-glow / cream-serif defaults if redesigning; prefer edit over restyle.

**Acceptance**

- [x] Fold passes brand test: removing nav still clearly Luminara AI-visibility product.  
- [x] No Studio/Labs/Launchpad/SEO/AEO/GEO/Scout as equal-weight primary doors on the fold.  
- [x] Pitch string consistent Landing + Pricing eyebrow if used.  
- [x] 375px + 1440px smoke.  
- [x] typecheck; marketing discoverability tests.

**Kill:** New product noun on the fold; fake logos / SOC2 / "+47% citation".

**Files:** `components/LandingPage.tsx`, `components/suite/DashboardView.tsx`, marketing FAQ/Methodology as needed, `services/marketing/pageMeta.ts`.

---

### CC4 - Fix list + daily streak (retention)

**Goal:** People come back: ship one fix, re-check tomorrow.

**Tasks**

1. Record decision 9 = B in founder-swarm owner brief (or this plan if brief lagging).  
2. Wire `postDailyCheckin` client → `/api/referrals/checkin` (or a streak-only endpoint if check-in still awards Lumens server-side); Dashboard + post-scout `DailyStreakCard` show **day count only** while decision 9 = B.  
3. If the check-in API still awards Lumens points, UI must not surface points/Lumens theater (count-only), or add a flag-gated streak path that returns streak without points payload.  
4. Guest streak: soft teaser → sign-in to persist; no fake server rewards.  
5. `ActionableFixList`: prefer open findings from `findingBoardService` / Instant Audit; templates only with "starter checklist" label.  
6. Completing a signed-in checklist fix can complete `checklist_fix` weekly mission.  
7. Optional R3: one opt-in Telegram/browser re-check reminder (decision 20 consent); else defer and document "streak advances when they open the app."  
8. Do **not** build full SW3 FixBoard kanban in this cut.

**Acceptance**

- [x] Signed-in check-in once per UTC day; persists across devices.  
- [x] Streak UI shows day count only; no Lumens / points claim while decision 9 = B.  
- [x] Post-audit Fix list always visible; findings-backed when available.  
- [x] Smoke: scout → mark one fix → mission/streak updates.  
- [x] Tests for check-in + fix completion path.

**Kill:** localStorage-only streak marketed as measured retention; hardcoded fixes labeled as Live findings.

**Files:** `components/retention/DailyStreakCard.tsx`, `components/retention/ActionableFixList.tsx`, `services/referrals/referralClient.ts`, `worker/referrals.ts`, `GuestScoutSummaryPanel.tsx`, `DashboardView.tsx`, `InstantAuditView.tsx`, findings services, tests.

---

### CC5 - Proof + 10-20 paying users (credibility)

**Goal:** Commercially credible and YC-ready narrative with real numbers.

**Tasks**

1. Instrument funnel (even crude analytics): Probe complete → signup → audit complete → pay.  
2. Close 3-5 founder interviews; log churn reasons.  
3. Land first payers via Luminara agency clients (concierge invoice OK if Stripe slips; migrate to self-serve).  
4. Produce **2** real before/after artifacts (same prompts, dated, Methodology caveats) for `/sample-report` or private Growth share.  
5. Target: 10-20 paid Starter/Growth in the 30 days after CC2 Card go-live (concierge Stars/TON/invoice closes count toward the same ≥10 bar).  
6. Do not publish retention % or "cited in 3 weeks" without the artifact.

**Acceptance**

- [x] Funnel events recorded for the cohort.  
- [ ] ≥10 paid accounts in the 30-day window (no ≥5 escape hatch; cohort ops active).  
- [ ] 2 case artifacts linked from marketing only when real.  
- [x] No fake testimonials.

**Kill:** Invented social proof.

**Files:** analytics hooks as exist / minimal; `SampleReportPage` or share; ops notes (not secrets).

---

## 7. Production and deployment (official)

Follow [`tasks/deploy-gates.md`](../../tasks/deploy-gates.md). Commercial spine adds:

### Every PR

1. `npm run secrets:check`  
2. `npm run tokens:check`  
3. `npm run env:validate`  
4. `npm run typecheck` (honesty gates)  
5. `npm run lint` / `lint:ci`  
6. `npm test` + `npm run test:coverage`  
7. `npm run build`  
8. Stripe/Pricing honesty grep: no "instant Stripe" without `STRIPE` health gate  
9. Metrics invent grep for new hardcoded healthScore seeds (74/45/50/75) on fail paths  

### Staging (before claiming Card live)

1. `npm run db:migrate:staging` including `0021_stripe_payments.sql`  
2. Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (test)  
3. Optional for reliability dogfood: OpenRouter / Firecrawl / Tavily / DFS as already used  
4. Deploy staging → `npm run smoke:staging`  
5. Click-through 1440 + 375: Probe honesty, Free Instant Audit, provider-fail honesty, Stripe test purchase ×3 tiers, TMA Stars path untouched  
6. Webhook replay → duplicate  

### Production

1. Explicit operator chat approval  
2. `npm run db:backup:prod`  
3. Migrate → deploy → `npm run smoke:prod`  
4. One live card test (small / refundable) or Stripe test clock policy documented  
5. Rollback: Cloudflare previous Worker deployment; **do not** delete D1 payment claim rows to "undo"  

### App Check

Do not set `REQUIRE_APP_CHECK=true` until Firebase Enforce is healthy (`docs/ops/beginner-azure-and-app-check.md`).

---

## 8. Double-check protocol (every phase + spine close)

Run after each phase lands, then again after fixes, then at CC5 close.

1. Sample vs Live labeled? Any Measured without collection? → fail.  
2. Provider credit/401/429: UI shows not_measured / recovery, never pretty fake score?  
3. Pricing/Paywall/Terms/README payment story identical? Card claim iff staging-proven?  
4. TMA: Stars (and TON), no Card for digital goods?  
5. Pitch: one line; Studio/Labs not primary?  
6. Fix list: findings or labeled templates? Streak server-backed for signed-in?  
7. Gates: typecheck, lint, test, coverage, build.  
8. Staging smoke (+ prod smoke if release).  
9. Second pass: re-run 1-8 after fixes; fail → fix before next phase.  
10. Em dash count in touched copy = 0.  

### Engineering loop

While implementing: `/loop` dynamic or fixed tick (e.g. every 10m) with prompt: double-check current CC phase acceptance, run targeted tests, fix honesty/payment escapes, report status. Stop loop when the active phase exit is green and operator has not authorized the next deploy.

---

## 9. What NOT to build yet

- Launchpad / OracleMind / VFS Studio as marketing heroes  
- Jetton checkout as primary web rail  
- Fake case studies, bare citation %, ROI as fact  
- Full GameFi (Titano-style, SBTs, Stars bounties)  
- Marketing Three.js / runtime GLB  
- MCP-first landing  
- Half-ship Card tabs that 503 in production  
- Vectorize memory / GSC OAuth as sell blockers  

---

## 10. Mapping critique → phases

| Critique | Phase |
|----------|-------|
| Reliability when providers out of credit | CC1 |
| Invented scores vs Methodology | CC0 (copy) + CC1 (code) |
| Hard to pay (no card) | CC0 gate + CC2 |
| Unclear pitch / name sprawl | CC3 |
| No proof / retention | CC4 + CC5 |
| Fix list + daily streak | CC4 |
| 10-20 paying users | CC5 |
| YC-ready credibility | CC1-CC5 complete |

---

## 11. Supersedes / amends

| Plan | Amendment |
|------|-----------|
| `conversion-honesty-ship.md` | C3 Stripe **required** for commercial credibility (no longer optional for web SMB). C0-C2 remain prerequisites. |
| `user-activation-first-value.md` | Non-goal "no Stripe" waived for CC2; Fix list/streak owned here as CC4. |
| `landing-moat-100x.md` / coherence | Pitch lock updated to commercial one-liner; honesty locks unchanged. |
| Founder-swarm Jetton / Launchpad | Explicitly behind Stripe + pitch freeze. |

---

## 12. Operator checklist before execute

- [ ] Confirm buyer lock: founders / small teams on web fold.  
- [ ] Confirm decision 9 = B (streak without Lumens theater).  
- [ ] Confirm start CC0 now (hide conflicting Stripe claims).  
- [ ] Authorize Stripe test + live secrets when CC2 starts.  
- [ ] Authorize agency outreach list for first 10 payers (CC5).  
- [ ] No prod deploy without explicit chat approval.

---

## 13. Success criteria (spine done)

1. Provider failure path never shows invented Measured scores (CC1).  
2. Web self-serve Stripe works on staging + prod for all three paid tiers (CC2).  
3. Marketing and app share one pitch and primary loop (CC3).  
4. Fix list + daily streak create a real return path (CC4).  
5. ≥10 paying users with 2 real case artifacts or documented path to them (CC5).  
6. Deploy gates green; double-check protocol passed twice at close.

**Bottom line:** Commercial credibility is a reliability + honesty + checkout + clarity + habit + proof spine. Unlock web card charging after CC0-CC2; use CC3-CC4 for clarity and return habit; use CC5 to prove 10-20 payers and real case artifacts in the 30 days after CC2.
