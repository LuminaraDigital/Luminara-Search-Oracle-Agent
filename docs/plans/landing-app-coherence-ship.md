# Landing and app coherence ship

**Date:** 2026-10-01
**Status:** L0-L6 complete locally and verified (typecheck, lint 0 errors, 1110 tests, build, browser at 1440 and 375, independent review: 7 of 8 findings fixed, 1 cosmetic left). L7 release awaits operator go. Nothing is committed.
**Companions:** [`landing-moat-100x.md`](./landing-moat-100x.md) (category and honesty locks, authoritative), [`weekly-decision-loop-10x-ship.md`](./weekly-decision-loop-10x-ship.md), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), `design.md`

## Why this plan exists

A third-party tool rewrote the marketing pages and parts of the app shell on 2026-09-30 / 10-01.
The result typechecks and passes tests, but:

1. **Production is serving uncommitted code.** The live bundle matches the local working tree, not
   `HEAD`. Nothing in git reproduces production. 65 modified and about 40 untracked files.
2. **Section headings render at 16px.** `text-[var(--text-display-s)]` is parsed by Tailwind as a
   color, so the font size never applies. 17 occurrences in 8 marketing files.
3. **The landing sells the wrong category.** The rewrite reverted the hero to generic "AI visibility
   audits", which `landing-moat-100x.md` S1 had replaced. Customer pages also address investors.
4. **The path into the app has gaps.** A guest inside the app shell sees "Log out" and no "Sign in".
   Signing in from the Probe drops the domain the visitor typed. Three landing handlers are
   disconnected (Dashboard, Create account, AI page). Every page has a different nav link set.
5. **Names differ across the boundary.** Marketing says Instant Audit / Oracle chat; the app says
   Audit / Quick scout / Ask.
6. **Pricing disagrees with the Worker.** One USD price out of three, white-label PDF shown as
   Agency-only, one-off SKUs missing, "Subscribe in app" opens a modal that says "Open in Telegram".
7. **The app shell uses a different visual system** from marketing: glass panels, gradient fills,
   raw gray/amber/orange classes, `rounded-2xl`, 8-9px uppercase labels.
8. **`qronos-landing/`** is an untracked re-skinned scheduler template with invented KPIs, fake
   testimonials, a SOC2 claim and a false price table. It is not deployed, but it fails `npm run lint`
   (399 errors) and occupies port 3000.

## Source of truth

| Topic | Source |
|-------|--------|
| Category, hero promise, forbidden claims | `landing-moat-100x.md` narrative and decision locks |
| Tiers and entitlements | `services/plans/planEntitlements.ts`, `worker/apiAccess.ts` |
| Prices | `worker/telegramBot.ts` (Stars), `worker/tonPayment.ts` (TON) |
| Core loop | Weekly Decision Loop: domain, labeled audit, one Decision Card, Prepare fix, retest |
| Tokens and type | `tokens.css`, `design.md` |

Category: cost-displacement and AI adoption without rebuild. Visibility Probe and Instant Audit are
the proof wedge. Moat claims allowed on marketing: dual surface (search plus answer engines),
evidence labels (measured / estimated / not_measured, Sample vs Live), operator loop and MCP.

## Decisions taken (defaults; operator may override)

| Decision | Choice | Reason |
|----------|--------|--------|
| Hero H1 | "AI is deciding which businesses get discovered." | The recommended fold in `landing-moat-100x.md` |
| Brand in hero | Nav plus a small eyebrow, claim is the display line | Claim was 20px under a 92px wordmark; `design.md` gate updated to match |
| Accent band | Paper-2 band with ink numerals, gold eyebrow only | Keeps the 5% accent budget; no rule change |
| Counts in band | 4 engines, 3 evidence labels, 1 next action | Product facts, not metrics |
| Investor language | Removed from customer pages | `design.md` has no investor audience |
| `qronos-landing/` | Excluded from lint now; deletion is an operator call | Untracked, so deletion is not recoverable |
| Orphaned constellation components | Left in place | Covered by tests and the bake pipeline; removal is a separate PR |

## Phases

Each phase ends with: typecheck, targeted tests, browser check at 1440 and 375, then an independent
review pass. A phase is not closed until review findings are fixed and re-checked.

### L0 - Baseline and safety
- [x] Snapshot the working tree outside the repo before any edit.
- [x] Add `qronos-landing/**` to ESLint ignores so lint reflects app code.
- [x] Record gate baseline: typecheck pass, 1110 tests pass, lint 0 app errors.

### L1 - Rendering defects
- [x] Replace `text-[var(--text-display*)]` with `text-[length:var(--text-display*)]` everywhere.
- [x] Remove the duplicate `components/marketing/marketingFaqContent.ts` (identical to the used
      `services/marketing/` copy, imported by nothing).
- [x] `MarketingFaq`: tokens for rule color and heading size; no double padding inside the shell.

### L2 - Landing: category, hierarchy, readability
- [x] Hero: eyebrow, display H1, one paragraph, two CTAs, honesty line, Probe on the right.
- [x] Auth-aware CTAs: signed-in visitors get "Open dashboard"; guests get "Create account".
- [x] Facts band under the hero (4 / 3 / 1).
- [x] Alternating split sections with gold mono eyebrows and paper / paper-2 surfaces.
- [x] Body copy 16-18px; no 14px light gray paragraphs.
- [x] Cost-displacement section and one Luminara Digital credit (dual-brand lock).
- [x] Replace investor-addressed copy on Landing, Why, Methodology, Sample report, Sell points.

### L3 - Landing to app continuity
- [x] One shared nav link set for every marketing page: Why, How, AI, Pricing, plus Sign in or
      Dashboard, plus the primary CTA.
- [x] One footer on every marketing page, with Methodology and Sample report links.
- [x] Guest in the app shell: "Sign in" control replaces "Log out"; logo returns home without logout.
- [x] Sign-in preserves a pending audit handoff and returns to Instant Audit, not Dashboard.
- [x] Sample report CTA does not prefill the fixture domain as if it were the visitor's.
- [x] Naming: "Instant Audit" is the label on both sides; marketing says "Ask" where the app does.

### L4 - Pricing truth
- [x] Price slot shows the price the Worker charges (Stars, with TON) for all three tiers.
- [x] Free tier row; one-off audit and crawl SKUs listed.
- [x] Blurbs generated from entitlements; white-label PDF not presented as Agency-only.
- [x] Web checkout button says what it does ("Pay in Telegram"); card note restored.

### L5 - App shell alignment
- [x] Shell header, suite menu and Dashboard use `tokens.css` surfaces, rules and radius.
- [x] No glass or gradient fills in shell chrome; one accent hue; minimum 11px labels.

### L6 - Final verification
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- [x] Click-through of every marketing CTA as guest, desktop and 375px.
- [ ] Signed-in click-through (needs a real account; do on staging, L7 step 4).
- [x] Independent review of the full diff against this plan and the honesty locks.
- [x] Update `design.md` craft gates and this checklist.

### L7 - Release

**Gate (2026-10-02):** Do not run L7 until [`conversion-honesty-ship.md`](./conversion-honesty-ship.md) phases **C0** and **C2** are green on staging. Coherence polish alone is not conversion-ready (Probe Measured-on-fixture + guest keys wall).

State on 2026-10-01:
- Committed on `feat/mcp-governance-hardening` as `a010880` (platform), `1496d3b` (marketing and app UI),
  plus the docs commit. Working tree clean. Not pushed.
- D1: `wrangler d1 migrations list --remote` reports nothing to apply on production and on staging.
  Migrations `0014`-`0017` are already live, so there is no migrate step in this release.
- `origin/main` has 9 commits this branch does not have. Merge `origin/main` into the branch and
  re-run the gates before opening the PR.
- CI deploys on push to `staging` (staging Worker) and `main` (production Worker).

Each step below needs operator go.

1. `git fetch origin && git merge origin/main`, resolve, then `npm run typecheck && npm run lint && npm test && npm run build`.
2. `git push origin feat/mcp-governance-hardening` and open the PR to `main`. CI must be green.
3. Staging: `git push origin HEAD:staging` (CI deploys), then `npm run smoke:staging`.
4. Staging click-through, guest and signed-in, desktop and 375px:
   landing CTAs, Probe to Instant Audit, Probe sign-in returns to Instant Audit with the domain,
   shell Sign in / Log out, logo returns home while staying signed in, Pricing payment panel.
5. `npm run db:backup:prod`, merge the PR (CI deploys production), then `npm run smoke:prod`.
6. Repeat step 4 on production.
7. Rollback: Cloudflare dashboard, Workers, luminara production, Deployments, roll back to the
   previous version. No schema rollback is needed.

## Out of scope
- Three.js, runtime GLB, Framer, GSAP (locked off in `landing-moat-100x.md`).
- Card checkout.
- Full app-wide restyle beyond shell chrome and Dashboard.
- Deleting `qronos-landing/` or the orphaned constellation components.
