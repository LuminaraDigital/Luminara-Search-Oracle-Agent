# Weekly Decision Loop 10x Ship (production + deploy ready)

**Date:** 2026-09-29  
**Status:** Product + staging + **prod** live. Staging smoke green; prod Worker `eea83918` + D1 `0011`-`0013` applied; `smoke:prod` green (health `requireAuth:true`, findings 401). Branch `feat/mcp-governance-hardening` still needs CI/merge to `main`.  
**Owner:** CEO + full-stack + AI/ML product + graphics/perf + deploy operator  
**Companions:** [`investor-marketable-10x-ship.md`](./investor-marketable-10x-ship.md) (M0-M8), [`suite-10x-production-ship.md`](./suite-10x-production-ship.md) (Track P + V), [`paperclip-pattern-production-ship.md`](./paperclip-pattern-production-ship.md), [`landing-moat-100x.md`](./landing-moat-100x.md), [`e2e-visibility-agent-platform.md`](./e2e-visibility-agent-platform.md) (W2-W4), [`user-activation-first-value.md`](./user-activation-first-value.md), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md)  
**Pattern library (outside repo):** sibling `paperclipai/paperclip` @ `53aad90b9` (never vendored; Luminara brand only)

## Overview

10x the strategic rethink into a **shippable, production- and deployment-ready** program. Three parallel tracks, one north-star:

> Paste domain → labeled Sample / Live Instant Audit → **one Weekly Decision Card** → Prepare fix → Retest same prompts → optional share / MCP ticket → thin Stack Audit proof of category.

**Category (locked):** cost-displacement + AI adoption without rebuild. Visibility Probe / Instant Audit is the **proof wedge**, not the company subtitle.

**10x definition (this plan):** Order-of-magnitude lift in (1) time-to-one-shippable-decision, (2) evidence honesty (mention vs recommend vs cite vs accuracy), (3) correction absorption proof, (4) operator-safe paperclip governance live, (5) perceived Field HD via Blender plates + Canvas (not marketing WebGL). Not a public conversion KPI. Not "add Three everywhere."

---

## A. Pushback (locked)

| Impulse | Decision | Why |
|---|---|---|
| Rebrand Suite as "AI Visibility-to-Revenue OS" | **Refuse as category** | Competes with Peec/Ahrefs/Squarespace; abandons cost-displacement moat |
| Ship Three.js + runtime GLB on landing for HD | **Refuse** | Plates+idle ~31-48 KB soft; `three`+archive GLB ~264-281 KB fails soft ≤120 / hard >200 |
| Load `design/constellation/visibility-field.glb` at marketing runtime | **Kill forever** | Authoring/archive only |
| R3F / drei / Framer / GSAP on marketing critical path | **Refuse** | Weight + motion-slop |
| Ship Recommendation Quality Score (RQS) as a number | **Refuse** | APS bans bare score theater; keep dimensions as evidence chips |
| Dollar / ROI uplift as fact on landing or Sample | **Forbidden** | Moat + APS; optional deep-app scenario calculator with user inputs only, labeled |
| Fork paperclip brand / packages into Suite | **Refuse** | Patterns only |
| Auto-publish Execute mode by default | **Refuse** | Default **Prepare**; Execute = Agency/Digital + approval |
| Mega-PR mixing Worker gov + craft plates + WDL schema | **Split** | Three branch families |

**What "10x HD interactive Three/Blender" means here:** Cycles/Eevee beauty stills as **layered WebP depth mattes** + Canvas2D/SVG honesty-bound interaction that feels physical. Optional vanilla Three **only** on Instant Audit Live after **written CEO override** (layout nodes from `constellationLayout.ts`, no GLB, ≤120 KB soft / >200 fail).

---

## B. Product spine: Weekly Decision Loop (Track W)

### North-star UX

Home (signed-in, post-audit) opens on a **Weekly Decision Card**, not five score tiles:

> **This week:** clarify service-area pages and correct listing X.  
> **Why:** engines A/B repeated outdated description on 11/14 non-branded prompts.  
> **Evidence:** exact answer excerpts + sources.  
> **Prepare:** suggested wording + directory checklist.  
> **Verify:** retest these 12 prompts in 14 days.

### Emotional core: "AI said this to your next customer"

Per prompt row: engine, full safe excerpt, present / recommended / absent, position, competitors named, sources cited, accuracy vs Business DNA, suggested correction. Default prompt library is **mostly non-branded** (market: ~85%+ of appearances are non-branded).

### Signal separation (no blended mystery score)

| Signal | UI | Honesty |
|---|---|---|
| Presence | per engine | `measured` / `estimated` / `not_measured` |
| Recommendation | mentioned vs recommended | never invent |
| Citation | owned vs third-party URLs | empty = unknown |
| Accuracy | vs Business DNA facts | flag only when DNA present |
| Confidence | high/med/low from repeats | show N of M tests |

### Reputation Firewall (brand safety)

Alerts when AI states wrong price, location, service, founder, audience, or recommends competitor for core offer. Attach a one-page **sales / front-desk brief**.

### Thin Stack Audit (category proof)

Manual inventory of overlapping SEO/analytics/reporting/AI tools → qualitative consolidation next steps. No guaranteed dollar savings. Deep DFY = Luminara Digital once.

### Prepare (not Execute) assets

Homepage positioning, FAQ, GBP copy, directory corrections, comparison outline, schema suggestions, internal links, review templates, outreach drafts, LinkedIn/YouTube ideas, Reddit-safe education, developer tickets. User approves before any publish integration.

---

## C. Track W phases (WDL0-WDL8)

Prefer **edit** over create. Reuse `audit_findings`, `visibility_snapshots`, `ShipActionGate`, Instant Audit, share, MCP.

| Phase | Work | Exit | Deploy |
|---|---|---|---|
| **WDL0** | Spec lock: types for DecisionCard, PromptProbe, AccuracyIssue, Confidence; map ShipActionGate → Decision Card | Spec in this doc + types PR; zero em dash; no RQS numeral | FE anytime |
| **WDL1** | Non-branded buyer prompt generator from Business DNA / industry / locale / services | Unit tests; guest Sample uses fixture prompts; Live uses DNA when linked | FE |
| **WDL2** | Exact-answer capture + mention/recommend/cite parse in visibility hybrid (W4) | Per-engine cards; never invent; `not_measured` labeled | FE+Worker when Live |
| **WDL3** | Findings pipeline (e2e **W2**): persist crew findings to `audit_findings`; HTTP board; status/owner/due; evidence drawer | API + UI; Growth share can include finding ids | Worker+FE; schema in 0005 |
| **WDL4** | **Weekly Decision Card UI** as post-audit home; promote one finding; executive / expert toggle; "fastest win" filter | Smoke: audit → card → commit. **Sample path:** session Card without D1 is a valid exit. Durable multi-device Card needs WDL3 | FE |
| **WDL5** | Prepare assets generator (LLM) attached to finding; MCP tool `create_dev_ticket_from_finding` / Cursor snippet | Assets reviewable; no auto-publish | FE+MCP Growth+ |
| **WDL6** | Correction absorption: snapshot → mark done → scheduled retest same prompt set → before/after | Confidence chips; Sentinel cadence optional | Worker cron + FE |
| **WDL7** | Reputation Firewall + sales brief export; accuracy vs DNA | Alert list; shareable brief PDF/markdown | FE+Worker |
| **WDL8** | Thin Stack Audit workspace + Boardroom monthly report (agency); optional economics calculator (user inputs, labeled scenario) | Packaging matches APS; Digital credit once | FE |

**WDL depends:** Live multi-engine measurement honesty (e2e W4 / go-live G1). Sample path must stay labeled and valuable without Live keys.

### Data model (extend, do not fork)

Existing (0005): `audit_runs`, `audit_findings`, `visibility_snapshots`, `shared_reports`.

**Add in migration `0014_weekly_decision_loop.sql` when Decision Card must survive reload across devices.** Double-check 2026-09-29: no `0014_*` file exists yet (budget tables are `0012`/`0013`); prefer **0014** for WDL. Do not invent a phantom budget 0014.

| Table | Purpose | Phase 1? |
|---|---|---|
| (reuse) `audit_findings` + richer `evidence_json` | Findings board + answer capture ids | **Yes (prefer)** |
| `weekly_decisions` | Persisted ShipActionGate across devices | Yes if multi-device; else session OK for Sample |
| `ai_answer_captures` | Non-branded prompts; mention/recommend/cite; DNA accuracy | Yes if not stuffed into evidence_json |
| `prepared_assets` | draft/ready/exported only (**never** published) | Phase 1.5 |
| `reputation_alerts` | severity, reason, ack | Phase 2 (WDL7) |
| `thin_stack_inventory` | Manual items_json | Phase 2 (WDL8) |

Until 0014 ships, Decision Card may stay client-derived from Instant Audit + `shipCommitmentService` (sessionStorage). `/api/findings` + D1 upsert + Decision Card + Sample AI-said fixtures are **in tree** (2026-09-29).

### API sketch

| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH | `/api/findings` (+ bulk) | W2; **landed** (`worker/findingsService.ts`); auth + stable_key upsert |
| GET/POST/PATCH | `/api/weekly-decisions` | one active decision per domain/project |
| POST/GET | `/api/ai-answers` | capture batch + history |
| POST/GET/PATCH | `/api/prepared-assets` | drafts only; reject publish |
| GET | `/api/reputation/alerts` | list + ack |
| GET/PUT | `/api/thin-stack` | manual inventory |
| Existing | `/api/share/reports` | before/after |

MCP (Growth+): `list_findings`, `get_finding`, `update_finding_status`, `get_weekly_decision`, `create_dev_ticket_from_finding` (optional `mcp_action_requests` if write risk). Paid visibility still needs `get_project_context` first.

### UI surfaces

| Surface | Action |
|---|---|
| `ShipActionGate.tsx` | Evolve into / feed Weekly Decision Card |
| `InstantAuditView.tsx` / `ReportDisplay.tsx` | Post-audit route to card |
| `components/suite/DashboardView.tsx` | Card as L1 home after first audit |
| New `components/audit/WeeklyDecisionCard.tsx` | Prefer thin new file if gate stays for unlock UX |
| New `components/audit/AiSaidThisPanel.tsx` | Exact answer emotional core |
| Marketing Probe / Field | Twin metaphor; no score numerals |

### Landing (moat-aligned)

Keep category hero (tool sprawl / adopt without rebuild). Below fold: "What AI said" + one weekly action storyboard. CTAs: **Run sample scout** / **Open Instant Audit**. No $ ROI. No bare visibility score. Digital once.

---

## D. Track P - Paperclip patterns → live (10x platform)

Source: sibling `paperclipai/paperclip` patterns only (`log-redaction`, MCP governance, forbidden tokens, license vault ideas, budget policies). Specs `0009`-`0013` + budget enforcement largely coded. **Next free migration number for WDL is `0014_weekly_decision_loop.sql`.**

| Phase | Work | Exit | Status |
|---|---|---|---|
| **P0** | secrets/tokens hygiene | check scripts 0 | Done (ongoing) |
| **P1** | D1 migrate preflight in `scripts/smoke-check.mjs` | Smoke fails if required tables missing for SHA | **Done in tree** |
| **P2 / M1** | Staging Worker SHA with gov+budgets; `requireAuth` on; smoke:staging; requireApproval E2E | Live quarantine → approve (HTTP preferred) → execute | **Blocked:** operator `deploy:staging` |
| **P3** | Lock 0013 open questions (TTL, raiser, DFS attribution, BYOK zero-cents, soft channel) | Docs written lock | Open |
| **P4 / M2** | Soft budgets dogfood; alerts visible; hard_stop off | `BUDGET_ENFORCEMENT=soft`; invoice delta OK | **Blocked** on M1 live |
| **P5 / M3** | HTTP approve/deny for `mcp_action_requests` | Authz + audit + tests | **Code done;** claim ops-ready only after M1 uses HTTP not SQL |
| **P6** | Hard stops | After invoice golden set + operator yes | Explicit later |
| **P7** | License vault rotation verify | Staging then prod | Rotation window |

**10x vs original paperclip plan:** migrate-in-smoke (**landed**); approval API (**in tree**); still open: automated governance smoke drill; human-visible soft alerts beyond audit + `/budgets/self`; invoice golden set before hard stop.

**Deploy rule:** CI `deploy-cloudflare.yml` does **not** migrate. Always `npm run db:migrate:staging` (or prod) **before** Worker SHA that needs new tables.

---

## E. Track V - Blender HD + Canvas 10x (Three gated)

**Payload honesty** (`scripts/constellation/budget-report.json`): hero+idle **31110** (soft ≤48 KB / hard ≤72). V-HD2 hero+nodes **51870**. Stage with sample plate ~**65500**; Probe underlay can push ~**76 KB**. Do not call the full HD stage a "~31 KB soft path." Archive GLB **681476** authoring only. `three` absent from package.json; refuse marketing add. Historical three+GLB ~264-281 KB remains the kill reason if reintroduced.

| Phase | Work | Exit | In tree? |
|---|---|---|---|
| **V-HD1** | Bake lighting ladder | bake:check; hero+idle soft/hard | Partial (plates committed) |
| **V-HD2** | Dual-layer hero+nodes parallax | Far+near in `VisibilityFieldHero` | **Dual-layer landed**; sample `<img>` still always mounted (opacity ~0.08 unlit) |
| **V-HD3** | Canvas hover depth; SVG light parallax; capability gates | ~60 fps; reduced-motion skip | Partial (SVG parallax missing) |
| **V-HD4** | Honesty pulse + tests | Never pulse `not_measured` as scored | **Not landed** |
| **V-HD5 / M8** | Probe = Field twin; **dedupe plate fan-out** | One layout; no triple plate load on landing | Open |
| **V-HD6** | Instant Audit Live Three after **written CEO override** | Layout nodes; no GLB; ≤120 soft / >200 fail | CEO-gated; do not scaffold early |

**Stage budget:** soft/hard for **hero+nodes+sample** (FieldHero always mounts three `<img>`s today: ~65500 bytes of assets). Do **not** budget V-HD2 as dual-only.  

**Sample mount (open):** `loading="lazy"` is not enough. Gate sample `<img>` on `resultsLit` (unmount when false). Until then, do not claim "lazy sample" as done.

**Landing plate fan-out (open):** (1) FieldHero plates + (2) Probe `ConstellationPlate` via `VisibilityConstellation` + (3) below-fold `LandingPage` `VisibilityConstellation` sample. V-HD5 must dedupe **all three**, not only Probe vs FieldHero.

**CI:** `npm run constellation:bake:check`; vitest constellation/Probe. Cheap hygiene: fail `from 'three'` under marketing/`LandingPage` (not in workflows yet; not today's kill).

**Kill:** Runtime GLB; R3F; score numerals; four per-engine focus plates; Blender required for CI `build`; FieldHero engine chip strip.

---

## F. Investor activation spine (do not drop)

From [`investor-marketable-10x-ship.md`](./investor-marketable-10x-ship.md). Remains mandatory for "investor-marketable":

| Phase | Theme |
|---|---|
| M4 | Probe → Instant Audit handoff + Sample labels |
| M5 | Share password header + OG + CTA |
| M6 | Post-save MCP mint + Cursor snippet |
| M7 | Packaging truth (Free insight; Growth share+MCP; Agency apiAccess) |

WDL3-WDL5 should **compose** on M4-M6, not replace them. Sample Decision Card may ship session-only; durable multi-device Card needs WDL3.

---

## G. Parallel sequencing

```
Craft FE:     V-HD3 → V-HD4 → V-HD5 → (optional V-HD6)   # V-HD2 dual-layer largely landed
Product FE:   WDL0 → WDL3 (findings) → WDL4 (Decision Card) → WDL1/WDL5
Product API:  WDL2 ∥ WDL3 → WDL6 → WDL7 → WDL8
Platform:     P2/M1 → P3 → P4/M2 → P6   (P1+P5 code landed; live blocked on deploy)
Activation:   M4 → M5 → M6 → M7   (FE in tree; prove on staging)
```

| Rule | Detail |
|---|---|
| Branch split | Craft = marketing/constellation; Platform = worker/migrations/smoke; Product = audit/findings/decision; VAL = share/mint separate |
| No hard wait | Craft does not wait for budgets; WDL Sample path does not wait for staging Worker |
| Soft couple | Packaging claims = APS; Decision Card Live metrics only when measured; probes without DFS stay `estimated` / `not_measured` |
| If Worker blocked | Ship FE activation M4-M7 + client Decision Card first; never claim gov live without M1 |
| Prod Worker | Explicit operator approval in chat only |

---

## H. Production ready vs deployment ready

| Label | Meaning |
|---|---|
| **Production-ready (code)** | WDL3 findings + WDL4 Card (session OK) + M4-M7 + V-HD2 landed + bake:check; typecheck/lint/test/build; no marketing Three. Do **not** claim V-HD3-5 complete until SVG parallax + pulse tests + Probe dedupe land |
| **Deployment-ready (staging)** | P2/M1: Worker live; requireAuth; smoke:staging; share OG; soft budgets dogfood; findings API green |
| **Deployment-ready (prod)** | Explicit operator approval; smoke:prod; named rollback SHA; no hard budget until P6 invoice gate |
| **Investor-marketable** | M4+M5+M6+M7 green on staging; Weekly Decision Card demoable on Sample |

### Quality gates (every PR)

```bash
npm run secrets:check
npm run tokens:check
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run constellation:bake:check
npm run build
```

### Rollback

| Layer | Action |
|---|---|
| Marketing FE | Prior SHA; leave plates |
| Decision Card FE | Hide Card CTA / fall back to ShipActionGate (no separate feature-flag required for Sample) |
| Governance Worker | Prior SHA; keep `mcp_action_requests` (no DROP) |
| Budget | `BUDGET_ENFORCEMENT=off` / hard_stop 0; keep `cost_events` |
| Three experiment | Remove chunk; Instant Audit → Canvas |

### Stop conditions

- Do not claim budget production-ready until M1 live + P4 soft dogfood green, soft alerts visible, invoices reconciled, operator approves hard stop.  
- Do not claim visual 10x until bake:check in CI + zero marketing Three/runtime GLB.  
- Do not start V-HD6 without written CEO override after V-HD5.  
- Do not ship RQS or $ uplift as fact.  
- Do not auto-deploy prod.

---

## I. Immediate execute queue (when operator says go)

**CEO revised order (3 steps):**

1. **Product:** `/api/findings` + D1 upsert via `findingStableKey` + Decision Card home + Sample AI-said fixtures (**landed in tree**). SessionStorage OK. Never insert Oracle `ValidatorFinding` into `audit_findings`. `0014` only if multi-device. Next: staging prove.  
2. **Investor prove:** M4-M7 on staging FE (Sample labels, share OG curl, MCP mint). Enums stay `estimated` / `not_measured` until Live keys.  
3. **Gov claim only:** `deploy:staging` → `requireAuth` → `smoke:staging` → one HTTP approve drill. Else skip. Touch V-HD3 / stage-budget / **sample mount gate** / **triple plate dedupe** only if Sample→IA feels flat or payloads blow soft stage budget.

Never mix Worker + craft + WDL schema in one PR.

**Demoted:** full 5-table `0014` day one; Reputation; Thin Stack; Boardroom; economics; Instant Audit Three; Telegram soft-alert UI (after M1+P4); re-litigate V-HD2.

---

## J. Missed gaps (after double-check pass)

| Gap | Severity | Track | Keep? |
|---|---|---|---|
| Staging Worker SHA / live `requireAuth` | Critical | P | Config true in wrangler; **live** needs `deploy:staging` |
| Findings HTTP/UI + Decision Card | Critical | W | **Landed** (session + Sample fixtures); staging prove pending |
| ShipActionGate session-only | Major | W | Session OK for Sample/investor; multi-device later |
| Probe product path lacks mention/recommend/cite split | Critical | W | Keep |
| Live DFS Mentions not claimed without keys | Critical | W | Keep |
| Soft-alert beyond `/budgets/self` | Major | P | **Demote** off Product go (after M1+P4) |
| Automated requireApproval smoke drill | Major | P | **Demote** off Product go (gov-only) |
| CI `three` marketing guard | Minor | V | Hygiene only; no dep today |
| Stage plate / sample mount / triple dedupe | Major | V | **Demote** off Product Critical (craft §I step 3) |
| P3 lock / CI migrate runbook / invoice before hard stop | Major | P | **Demote** off Product go (platform later) |
| M4-M7 staging FE prove (OG curl, mint) | Major | Activation | After Product, before investor-marketable claim |
| Phase 1 Card labeled Sample AI-said fixtures | Critical | W | **Landed** |
| Do **not** map Oracle `ValidatorFinding` / chat validators into `audit_findings` | Critical | W | **Landed** (`isCrewAuditFinding` kill-wire) |
| Marketing three / V-HD2 "implement" | - | V | **Demote:** dual-layer landed |
| Agency Boardroom / economics in Phase 1 | Later | W | **Demote** |
| Thin Stack / Reputation in Phase 1 MVP | - | W | **Demote** to WDL7/8 |
| Phantom "budget 0014 collision" | - | W | **Deleted:** 0014 is free |
| Soft "~31 KB" as full HD stage claim | - | V | **Deleted:** hero+idle only |

---

## K. Operator asks (approve to unlock)

1. Confirm Track V: plates + Canvas (not marketing Three).  
2. Confirm product spine: Weekly Decision Loop (not RQS / Control Room scores).  
3. Next: **findings HTTP + Decision Card** (default), or **staging Worker** only if claiming live gov?  
4. No prod deploy / migrate without chat approval.

---

## L. Specialist loop

Existing local loop `AGENT_LOOP_TICK_wdl-10x` every 10m (re-armed 2026-09-29: Product-first unlock strings). On tick: merge specialist deltas only; no code without `go Product` or `go staging Worker`; no marketing Three/RQS/$ROI.

### Specialist merge notes (2026-09-29)

- **CEO final** ([CEO](d3965e2f-f085-41e8-a679-bdd4c7e2164b)): Product go **yes**; fixture AI-said on Card; forbid Oracle ValidatorFinding→`audit_findings`; demote soft-alert / CI three / craft plates / gov smoke / P3 off Product path.  
- **Full-stack audit** ([full-stack](3f0f2e87-403c-43c9-bcf9-88c1a4cec2df)): ten claims true; sample always mounted; landing plate fan-out **triple**.  
- **Craft double-check** ([craft](a43f76ab-79a7-4e4c-a2b3-aab496f4d88c)): hero+idle 31 KB ≠ full stage; V-HD6 CEO-gated.  
- **Platform verify** ([platform](74314eb7-57d0-4d5e-814f-f6e94c87bf04)): migrations `0010`-`0013`; `/api/mcp-action-requests*`.  
- **Migration lock:** **`0014_weekly_decision_loop.sql`**.

---

## M. Phase 1 MVP acceptance (shrunk after double-check)

**In:**

1. Findings path: `findingStableKey` helper exists today; Phase 1 exit requires **HTTP + D1 upsert** into `audit_findings` by `stableKey` (or labeled local fallback). Helper alone is not done. **Source:** crew/Instant Audit findings only. **Forbidden:** Oracle chat `ValidatorFinding` / agentOutputValidators rows as board findings.  
2. Commit one ship action → home Decision Card (action, evidence chips, verify date). SessionStorage OK for Sample. **Why panel:** labeled Sample “AI said” fixture prompts/excerpts **or** SEO-finding-only copy; never blank Why waiting on Live WDL1/W2.  
3. Display answer honesty without inventing cite KPIs when `not_measured` / `estimated`.  
4. Free share/MCP still 403; Growth paths unchanged.

**Out of Phase 1:** Reputation Firewall, Thin Stack, Boardroom, economics calculator, auto-publish, Instant Audit Three, five-table day-one migration.

---

## N. Double-check pass (2026-09-29)

### Gate (run before every new add; run twice)

1. Raises Sample → Instant Audit → Decision Card → share/MCP, live gov, or craft honesty?  
2. Conflicts with refuse locks (marketing Three/GLB, RQS, $ROI, paperclip fork, mega-PR)?  
3. Already covered under M/P/V/WDL?  
Fail any → discard. Re-run 1-3 on the draft before merge.

### Verified vs tree (this pass)

| Claim | Result | Evidence |
|---|---|---|
| `/api/findings` missing | **False** (landed) | `worker/findingsService.ts` + Instant Audit / Dashboard Card |
| `findingStableKey.ts` exists | True (+ D1 upsert wired) | helper + bulk ON CONFLICT |
| ShipActionGate session-local | True (sessionStorage, tab-scoped) | `shipCommitmentService` |
| Dual-layer hero landed | True | `VisibilityFieldHero.tsx` far/near parallax |
| No `from 'three'` in TS/TSX | True | repo grep empty |
| P1 smoke D1 preflight | True | `scripts/smoke-check.mjs` |
| M3 approve HTTP | True | `/api/mcp-action-requests/.../approve|deny` (Worker path without `/api` prefix) |
| Migration `0014_*` SQL exists | False | disk tops at 0013; budget spec `0014` is docs-only |
| Budget D1 needs file 0014 | False | budgets are 0012+0013 |

### 10x improvements that passed the gate

1. **Findings before Card** (WDL3/WDL4 swap): durable Decide needs W2 HTTP.  
2. **Shrink Phase 1 acceptance** to four checks; defer Firewall/Stack/Boardroom.  
3. **Prefer enrich `audit_findings.evidence_json`** over five tables day one.  
4. **Stop re-planning V-HD2**; craft spend on Probe twin + Canvas honesty (V-HD3/4/5).  
5. **Use free `0014` for WDL** when multi-device persistence is required.  
6. **Stage payload honesty** + gate sample on `resultsLit` + **triple** plate dedupe (FieldHero + Probe + below-fold map).  
7. **Prove M4-M7 on staging FE** before claiming investor-marketable (CEO).

### Explicitly not added (failed gate or refuse)

- Marketing Three / runtime GLB / RQS / $ROI theater  
- Control Room five-score dashboard  
- Day-one Reputation + Thin Stack + economics  
- New craft frameworks (R3F/Framer/GSAP)  
- Early `VisibilityFieldThree` scaffold without CEO write  
- Soft "~31 KB" as claim for full MarketingStage HD path

---

## O. Second double-check pass (2026-09-29, re-run)

### Gate (run twice before any add)

Same as §N. This pass: **zero new product features added.** Only honesty / queue / status fixes.

### Re-verified this pass

| Claim | Result |
|---|---|
| Migrations on disk | `0010`-`0013` only; next free **0014** |
| `three` in package.json | **Absent** |
| `/api/findings` | **Landed** (GET/bulk/PATCH + smoke 401 probe) |
| MarketingStage | FieldHero always mounts hero+nodes+sample; Probe + below-fold constellation add more plates (triple fan-out; §E/§J) |
| Loop already running | `AGENT_LOOP_TICK_wdl-10x` every 10m; no duplicate armed |

### DELETE / noise refused this pass

- Re-opening Control Room / RQS / revenue OS  
- Scaffolding Three for Instant Audit  
- Expanding Phase 1 back to Firewall/Stack/Boardroom  
- Skipping to staging Worker as default without Product slice  

### Ready for operator "go"?

| Ask | Answer |
|---|---|
| Plan ready to execute **Product** (findings HTTP + Decision Card)? | **Done in tree** - next operator unlock is staging prove |
| Production-ready / deployment-ready? | **Product yes.** **Staging yes** (`smoke:staging` green 2026-09-29). **Prod:** no until explicit yes |

**Operator unlock string:** reply `go staging Worker` (or `deploy staging`) to prove live auth + findings 401 smoke. Prod needs a separate yes.

---

## Related plans (do not duplicate)

- Activation: `user-activation-first-value.md`, `virality-activation-loops.md`  
- Moat copy: `landing-moat-100x.md`  
- Visibility waves: `e2e-visibility-agent-platform.md`  
- APS: `agent-mcp-product-surface.md`
