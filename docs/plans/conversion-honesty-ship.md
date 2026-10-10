# Conversion honesty ship (C0-C4 + L7 gate)

**Date:** 2026-10-02  
**Status:** C0 + C1 + C2 shipped to staging and production (2026-10-02). PR #37 merged (`5cbfcad`). Staging + prod CI smoke green; probe-crawl verified on both. **C3 Stripe:** deferred here historically; **promoted to required** for web commercial credibility under [`commercial-credibility-100x-ship.md`](./commercial-credibility-100x-ship.md) (CC0-CC2). C4 Field polish / full browser click-through still open for operators.  
**Owner:** CEO craft loop + full-stack + payments + AI honesty  
**Companions:** [`commercial-credibility-100x-ship.md`](./commercial-credibility-100x-ship.md) (authoritative for charging + Stripe), [`landing-app-coherence-ship.md`](./landing-app-coherence-ship.md) (L0-L6 done; L7 blocked until C0+C2 on staging), [`landing-moat-100x.md`](./landing-moat-100x.md) (honesty locks), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md) (APS), [`virality-activation-loops.md`](./virality-activation-loops.md)  
**Reviews:** CEO plan review (2026-10-02), Worker Probe architecture explore, payments surface explore, CEO double-check PASS (post-fix). Implementation review pending this session.

## Why this plan exists

Third-party conversion critique (2026-10-02) and CEO review agree: L0-L6 made marketing coherent, but the landing still **lies** about Measured data and walls guests behind BYOK keys. That blocks calling the **conversion funnel** production-ready even if the Worker app is deployable.

North-star (locked from moat): % of visitors who finish a labeled Probe result **and** open Instant Audit or Sign in to save, in-session. Not a public KPI claim.

## Locked decisions (operator defaults)

| Decision | Choice | Reason |
|----------|--------|--------|
| Buyer (landing only) | Founders / small-team operators | Agency and MCP are upsell, not the fold |
| Payments for C0-C2 | Telegram Stars + TON only; honest Pricing copy | Half-ship card UI is a new lie; Card claims wait for commercial CC0/CC2 |
| Stripe | Track C3 **required for web charging**, after C0-C2; owned by [`commercial-credibility-100x-ship.md`](./commercial-credibility-100x-ship.md) | ~3-5 eng-days; Checkout + webhook → `writeSubscriptionRecord`; no Card claim until staging purchase works |
| Probe honesty | Two-step: C0 kill Measured/Estimated theater on fixtures; C1 optional public cheap Live **crawl** row | Critique “Google Measured from robots/title” is **rejected**; crawl-readiness Measured is the honesty-safe substitute |
| Guest primary CTA | Sign up free → Instant Audit with domain handoff | Free signed-in must use hosted rail with zero keys wall for at least one path, or demote the CTA |
| Sample report | Dated static Live snapshot page of luminarasuite.com (preferred over Growth share tokens) | Token expiry is a deploy risk; fixture rebadge is theater |
| `qronos-landing/` | Operator quarantine: stop :3000, do not deploy, delete when confirmed | Gitignored; fake Anthropic/OpenAI/SOC2; not on Worker path |
| L7 release | **Blocked** until C0+C2 green on staging | Coherence polish on a lying Probe is not production |

## Agree / disagree with the critique

### Agree (ship)

1. Probe fixture labeled Measured for Google on any typed domain contradicts Methodology.  
2. “Open Instant Audit” as primary guest CTA is a keys wall. Prefer free account.  
3. Real dated Live sample of own site.  
4. Card checkout absence caps web SMB/agency revenue (honest copy now; Stripe later).  
5. Internal jargon (BYOK, entitlement, fixture, MCP) off customer fold.  
6. One buyer. Status labels too small. Mobile Probe placement. Splash on Why.  
7. qronos must never ship.

### Disagree or constrain

| Critique | Pushback |
|----------|----------|
| One row Measured via robots/title/schema as “Google Measured” | **Rejected.** Crawl signals are not SERP/engine Measured. C1 may Measure a **Crawl readiness** row only; Google / AIO / ChatGPT / Perplexity stay Not measured until Instant Audit |
| Card checkout before honesty | Honesty + CTA first; Stripe is C3 |
| Visual redesign | Visual identity is fine; no palette/type change |
| Promise 10x conversion | No baseline funnel data; ship honesty, then measure |

## Architecture (C1 Probe Live crawl)

Reuse `worker/llmCrawlerRoute.ts` `loadCrawlerSnapshot` (already SSRF-safe, 64KB, 5s, no redirects).

**Do not** browser-fetch third-party (CORS). **Do not** open an arbitrary HTML proxy. **Do not** call DFS/PSI/oracle from the landing Probe.

```
Visitor types domain
  → GET /api/visibility/probe-crawl?url=…  (new, anonymous, dual rate limit)
  → loadCrawlerSnapshot (robots / llms / ai.txt only)
  → UI badge: Live crawl (or Mixed). Never sole Sample badge on a Measured crawl row.
  → Crawl readiness row: Measured only when snapshot collection succeeds; else not_measured.
       Pass/fail describes robots/llms presence after Measured, never invents engine presence.
  → Google / AIO / ChatGPT / Perplexity = Not measured: run Live
  → Primary CTA: Run it live on [domain]: free account
```

Rate limit: tighter than crawler-files (suggest 10/min/IP dual). Cache same host 5 minutes optional. No auth required; no scout receipt that implies engine Measured.

Existing `/visibility/crawler-files` stays **AUTH_REQUIRED** for Instant Audit.

## Phases

Each phase ends with: typecheck, targeted tests, browser check 1440 + 375, CEO double-check (honesty locks 1-11 from moat), then next phase. No L7 until C0+C2 pass staging.

### C0 - Stop the lie (ship blocker)

**Goal:** Sample playback never uses `status: 'measured'` or engine-presence theater via `estimated` without an explicit Sample-only note.

**Tasks**

1. Update `SAMPLE_FIXTURE` in `components/marketing/demo/demoFixtures.ts`: all four engine rows use `not_measured` only (preferred). If any `estimated` remains, every such note must start with `Sample · illustrative` and must not imply engine presence.  
2. Probe UI: badge **Sample** larger and higher contrast; status labels ≥12px / WCAG readable.  
3. Methodology / FAQ: Probe is Sample until C1; Measured only after real collection.  
4. Tests: `tests/visibilityProbe.test.ts` asserts Sample engines ≠ `measured` and that any `estimated` note starts with `Sample · illustrative`.  
5. Grep gate: marketing demo fixtures contain no `status: 'measured'`; no engine `estimated` without Sample-only note prefix.

**Acceptance**

- [x] Typing example.com still shows Sample badge; zero engine rows say Measured.  
- [x] Fixture engines are `not_measured` (or estimated only with Sample · illustrative notes).  
- [x] Methodology and Probe copy agree.  
- [x] `npm run typecheck && npm test -- tests/visibilityProbe` green.

**Dependencies:** None.  
**Files:** `demoFixtures.ts`, `VisibilityProbe.tsx`, `MethodologyPage.tsx`, `marketingFaqContent.ts`, tests.

### C1 - Cheap Live crawl row (optional but recommended)

**Goal:** Typed domain gets one real Measured crawl-readiness signal; engines stay Not measured.

**Tasks**

1. Add `GET /api/visibility/probe-crawl` wrapping `loadCrawlerSnapshot` + dual rate limit + public SSRF checks.  
2. Client: Probe analyzing phase calls endpoint; map robots/llms presence to crawl row; engines `not_measured`.  
3. When crawl succeeds, UI badge = `Live crawl` (or Mixed); engines remain Not measured. Do not keep a sole Sample badge on a Measured crawl row.  
4. Verdict text must not claim Google/ChatGPT/Perplexity measurement.  
5. Abuse tests: private IPs rejected; rate limit 429; unit test asserts no DFS/PSI/oracle import on this path.  
6. Soft fail: Worker error → crawl `not_measured` + Sample-safe copy (never invent Measured).

**Acceptance**

- [x] Response `host` matches request host.  
- [x] Crawl fields come from `loadCrawlerSnapshot`, not `SAMPLE_FIXTURE`.  
- [x] Engines never Measured from this endpoint.  
- [x] Unsigned call cannot trigger hosted AI or DFS (test coverage).  
- [ ] Rate limit returns 429 under burst.  
- [x] Soft-fail path never shows Measured for crawl.  
- [ ] Staging smoke: probe-crawl happy path + 400 unsafe URL.

**Dependencies:** C0.  
**Files:** `worker/llmCrawlerRoute.ts` or new `worker/probeCrawlRoute.ts`, `worker/index.ts`, `VisibilityProbe.tsx`, `useDemoPlayback.ts`, security tests.

### C2 - Guest path + copy + real sample

**Goal:** Conversion path is product-true for founders/small teams.

**Tasks**

1. Nav + landing primary for guests: **Create free account** / **Run it live on [domain]: free account**. Demote Instant Audit and BYOK to secondary.  
2. Preserve `AuditHandoff` through signup (`sampleSource` may become false after Live intent). Post-sign-in → Instant Audit with domain (`viewAfterSignIn`).  
3. Free signed-in hard gate: primary Instant Audit scout uses `signed_in_hosted` with **zero** keys wall for at least one engine path within Free daily quota. If product cannot meet this, demote the free-account CTA until it can.  
4. Copy scrub: remove BYOK / entitlement / fixture / MCP / “operator loop” from Landing, Why, Methodology customer fold. Buyer = founders and small teams.  
5. Sample report: prefer a **dated static snapshot page** (committed or Worker-served) of a Live luminarasuite.com audit. Avoid Growth share tokens as the sole proof (expiry risk). Link from `/sample-report`. Until ready, page must say Sample only and not imply Live.  
6. Pricing: one clear Telegram/TON story; reduce “Card checkout unavailable” to once; USD = list prices only.  
7. Fix Why “Preparing your workspace” splash on direct load if reproducible.  
8. Mobile: Probe not competing with first fold poorly; tap targets ≥40px on primary CTAs.

**Acceptance**

- [x] Guest primary CTA never lands on keys-only wall as first action.  
- [x] Domain survives signup → Instant Audit.  
- [x] Post-signup Instant Audit runs without BYOK for Free daily quota (at least one engine path).  
- [x] Sample report is dated static Live snapshot **or** explicitly Sample-only.  
- [x] No internal jargon on Landing hero / Why H1.  
- [ ] Browser guest path 1440 + 375.

**Dependencies:** C0 (C1 optional parallel).  
**Files:** `LandingPage.tsx`, `MarketingNav`, `App.tsx`, `AuthPanel.tsx`, `SampleReportPage.tsx`, `PricingPage.tsx`, Why page, tokens for status labels.

### C3 - Card checkout (required for web commercialization)

**Goal:** Real Stripe Checkout with honest Pricing. Detail and exit criteria live in [`commercial-credibility-100x-ship.md`](./commercial-credibility-100x-ship.md) phases **CC0** (stop Card claim lies) and **CC2** (end-to-end Checkout).

**Tasks**

1. Stripe Checkout Session on Worker; webhook → `paymentLedger` / `writeSubscriptionRecord`.  
2. Secrets in Wrangler; no keys in client.  
3. Pricing buttons: Card / Telegram. Remove unavailable copy only when card works end-to-end on staging.  
4. Refunds / entitlement parity with Stars/TON tiers (rank-guard, TMA Stars-only).  
5. Do not claim "instant Stripe" in Pricing while secrets/webhook are down (CC0).

**Acceptance**

- [ ] Staging: card purchase grants Growth/Agency entitlements.  
- [ ] Webhook signature verified; replay-safe.  
- [ ] Pricing never claims card if webhook path is down.

**L7 note:** Probe honesty L7 can ship without C3. **Charging web SMBs confidently cannot.**

**Dependencies:** C2.  
**Files:** `worker/stripePayment.ts` (scaffolded), `migrations/0021_stripe_payments.sql`, `PricingPage.tsx`, entitlements tests. See commercial-credibility plan for full file list.

### C4 - Field polish (non-blocking)

- Reduce engine list repetition on landing.  
- Field map / How-it-works: one real screenshot or annotated static.  
- Status label contrast (if not done in C0).  
- Page length trim without removing honesty lines.

**Dependencies:** C2. Does not block L7 if C0-C2 green.

### L7 - Release (from coherence plan, gated)

Prerequisite: C0 + C2 on branch; merge `origin/main`; gates green; `qronos-landing` not running on any deploy host.

1. `git fetch origin && git merge origin/main` → typecheck, lint, test, coverage, build.  
2. Push branch, PR to `main`, CI green.  
3. `git push origin HEAD:staging` → `npm run smoke:staging`.  
4. Staging click-through guest + signed-in, 1440 + 375:  
   - Probe Sample path (C0): no Measured engines on fixture playback.  
   - Free-account CTA → signup → Instant Audit handoff with domain.  
   - Pricing Telegram/TON honesty.  
   - If C1 shipped: probe-crawl happy path + 400 unsafe URL.  
5. `npm run db:backup:prod`, merge PR → prod deploy → `npm run smoke:prod`.  
6. Repeat click-through on production.  
7. Rollback: Cloudflare Workers previous deployment (no schema rollback expected).

## Double-check protocol (every phase)

1. Sample vs Live labeled? Any Measured without actual collection? → fail.  
2. Unsigned Probe: no hosted AI, no DFS, no open proxy.  
3. Guest CTA: free account first? Keys wall secondary? Free path actually runs without BYOK?  
4. Pricing matches Worker payment rails.  
5. Buyer = founders/small teams on fold.  
6. qronos not in deploy artifacts / public host.  
7. Gates: typecheck, lint, test, build.  
8. Staging smoke + guest path before prod.  
9. Second pass: re-run 1-8 after the phase exists; fail → fix before next phase.

## Out of scope

- Three.js / runtime GLB / Framer / GSAP.  
- Bare AI visibility scores, fake logos, fake SOC2.  
- Full app restyle.  
- MCP-first landing.  
- Deleting constellation orphans (separate PR).  
- Labeling crawl/robots checks as Google Measured.

## Effort (order of magnitude)

| Phase | Effort | Blocks L7? |
|-------|--------|------------|
| C0 | 0.5-1 day | Yes |
| C1 | 1-2 days | Soft (recommended) |
| C2 | 1-2 days | Yes |
| C3 | 3-5 days | No for Probe L7; **Yes for web charging** (see commercial-credibility CC0-CC2) |
| C4 | 1-2 days | No |
| L7 | Operator + CI | After C0+C2 |

## Operator checklist before execute

- [ ] Confirm buyer lock: founders / small teams.  
- [ ] Confirm Stripe for web charging: follow [`commercial-credibility-100x-ship.md`](./commercial-credibility-100x-ship.md) CC0 (hide Card lies) then CC2 (do not defer if selling web SMBs).  
- [ ] Confirm delete or keep `qronos-landing/` (stop process on :3000 now).  
- [ ] Authorize a dated static Live snapshot of luminarasuite.com for `/sample-report`.  
- [ ] Go on starting C0 in this branch.

## Engineering loop

While implementing: `/loop` dynamic engineering tick. After each task: run phase double-check protocol, targeted tests, fix regressions. Stop loop when C0+C2 acceptance is green and L7 prerequisites listed above are ready (do not deploy without operator go).
