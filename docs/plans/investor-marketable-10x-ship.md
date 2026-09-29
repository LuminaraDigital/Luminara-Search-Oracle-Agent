# Investor-marketable 10x ship (production + deploy ready)

**Date:** 2026-09-29  
**Status:** M3-M7 code landed in tree (2026-09-29). Investor activation spine + approve HTTP API ready. **Deployment-ready:** typecheck/lint/full test/build/pre-push green on `feat/mcp-governance-hardening` (PR #22). Staging Worker + `requireAuth` flip and prod deploy still need explicit operator approval (do not auto-deploy).  
**Owner:** CEO + full-stack + AI/ML product + graphics/perf + deploy operator  
**Companions:** [`suite-10x-production-ship.md`](./suite-10x-production-ship.md), [`landing-moat-100x.md`](./landing-moat-100x.md), [`virality-activation-loops.md`](./virality-activation-loops.md), [`user-activation-first-value.md`](./user-activation-first-value.md), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), [`paperclip-pattern-production-ship.md`](./paperclip-pattern-production-ship.md)  
**Pattern library (outside repo):** sibling `paperclipai/paperclip` @ `53aad90b9` (never vendored)  
**Ground:** PR [#22](https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent/pull/22) holds P1+V1-V3/S1; staging D1 `0011`-`0013` + SQL gov drill done; staging `requireAuth` still false (`.agents/PAPERCUTS.md`). Worker deploy gated.

**10x definition:** Order-of-magnitude lift in (1) Sample scout → Instant Audit → save → share or MCP in Cursor in one session, (2) operator-safe live governance/budget, (3) Field realism via Blender plates + Canvas (not marketing WebGL). Not a public KPI. Not "add Three."

---

## 1. Pushback (locked)

| Impulse | Decision | Why |
|---|---|---|
| Three.js + runtime GLB on landing for HD | **Refuse** | Plates ~20-48 KB soft path; three+archive GLB ~264-281 KB fails soft ≤120 / hard >200 |
| Load `design/constellation/visibility-field.glb` in marketing | **Kill forever** | Archive/authoring only |
| R3F / drei / Framer / GSAP on marketing critical path | **Refuse** | Weight + motion-slop |
| Bare visibility score / citation % / $ ROI as fact | **Forbidden** | APS enums only |
| Fork paperclip brand/packages into Suite | **Refuse** | Patterns only |
| Mega-PR mixing hot Worker + craft | **Split** | Parallel branches |
| Prod / staging Worker without chat approval | **Blocked** | Operator gate |

**Ship instead:** Blender WebP depth mattes + Canvas2D/SVG honesty motion (`VisibilityFieldHero.tsx`, `VisibilityConstellationCanvas.tsx`, `constellationLayout.ts`). Instant Audit Three only after written CEO override (layout nodes, no GLB, ≤120 soft / >200 fail).

---

## 2. Done vs blocked

### Done in tree

| Item | Evidence |
|---|---|
| H1 budget fail-open + soft defaults + `BUDGET_ENFORCEMENT` | `worker/budgets.ts`, `wrangler.jsonc` |
| Smoke D1 remote preflight (Windows-safe) | `scripts/smoke-check.mjs` |
| Staging D1 `0011`-`0013` + SQL approve drill | Operator applied |
| HD plates + bake:check + dual-layer path | `public/brand/constellation/**`, `scripts/constellation/**` |
| Landing S1 category copy | `components/LandingPage.tsx` |
| MCP governance library + HTTP approve/deny (M3) | `worker/mcpGovernance.ts`, `GET/POST /api/mcp-action-requests`, `tests/mcpActionRequestsHttp.test.ts` |
| Share + API keys backends | `worker/shareService.ts`, `/api/api-keys`, Settings mint |
| M4 Probe → Instant Audit handoff | `services/activation/auditHandoff.ts`, `VisibilityProbe`, `App.tsx`, Sample labels |
| M5 share password header + OG + CTA + robots Allow | `shareReportClient`, `maybeServeShareHtml`, `SharedReportView`, `robots.txt` |
| M6 post-save MCP mint + Cursor snippet | `InstantAuditView`, `services/mcp/cursorMcpSnippet.ts` |
| M7 Growth packaging in crawler meta | `services/marketing/pageMeta.ts` `/pricing` |

### Still blocked (ops / later)

| Gap | Severity | Anchor |
|---|---|---|
| Staging Worker SHA not live for requireApproval E2E | Critical (ops) | Operator `deploy:staging` after merge approval |
| Staging `requireAuth: false` | Critical (smoke) | Papercut; flip before claiming smoke green |
| Field = Probe twin (M8 polish) | Major | Moat S4; plates+Canvas already ship |
| Soft-alert channel + invoice golden set (M2) | Major before hard stop | Audit + `/budgets/self` only |
| CI deploy without migrate step | Major | Operator runbook; do not rely on workflow |
| Prod Worker | Critical (ops) | Explicit chat approval only |

---

## 3. Phases M0-M8 (CEO ship order)

**Default order:** M0 → M1 → M2 ∥ M4 → M3 → M5 → M6 → M7 → M8.

**If Worker stays blocked:** run **M4 → M5 → M6 → M7** first (investor-marketable activation). Never claim governance live without M1.

| Phase | Work | Exit | Deploy | Rollback |
|---|---|---|---|---|
| **M0** | Hygiene: secrets/tokens 0; bake:check in CI; no username paths in docs | Checks green | Anytime | N/A |
| **M1** | Staging gov live: Worker SHA with gov+budgets; `requireAuth` on; `smoke:staging` green; requireApproval E2E (API or interim SQL) | Live quarantine → approve → execute | **Operator** `deploy:staging` | Prior SHA; keep `mcp_action_requests` |
| **M2** | Soft budgets dogfood; alerts visible; hard_stop off | `BUDGET_ENFORCEMENT=soft`; dogfood OK | Staging; prod after invoice | Env `off` / prior SHA |
| **M3** | HTTP approve/deny for `mcp_action_requests` | Authz + audit + tests; no SQL on-call | After M1 | Prior SHA |
| **M4** | Moat S2: domain+engines+Sample → Instant Audit; methodology; soft Save | Prefill; Sample vs Live labeled; no guest hosted spend | FE | Prior FE |
| **M5** | VAL S1: `x-share-password`; crawler OG; soft CTA on `/share/:token` | Prod password unlock; bot OG; CTA; Free share 403 | FE+Worker | Prior SHA |
| **M6** | VAL S2: after `strategy_saved`, Growth mint + Cursor `mcpServers` snippet | One-click mint; Free/Starter upgrade CTA | FE (API exists) | Hide CTA |
| **M7** | Moat S3 packaging: Free=insight; Growth=share+MCP; Agency=`apiAccess` | No Free MCP/share claims; Digital once | FE | Prior FE |
| **M8** | Field=Probe twin + V-HD; Hallmark; no marketing `three`. IA Three = CEO override only | bake:check; SSOT; vite proves no marketing three | FE | Drop Three → Canvas |

### Parallel tracks

```
Craft / narrative:  M4 → M7 → M8 (+ V-HD below)
Platform:           M1 → M2 → M3
VAL:                M5 → M6
```

Craft = `components/marketing/*`, plates, Landing, activation FE.  
Platform = `worker/*`, `migrations/*`, smoke.  
No hard wait. M7 must match APS. FE can ship without budget flips; gov Worker needs M1 first.

---

## 4. Phase detail (files + acceptance)

### M4 - Probe → Instant Audit (must-ship for narrative)

**Files:** `VisibilityProbe.tsx` (today `onOpenAudit()` with no args), `demo/useDemoPlayback.ts`, `LandingPage.tsx`, `App.tsx` (`enterApp(INSTANT_AUDIT)` / `initialUrl` only from url-swap), `InstantAuditView.tsx` (no Sample/Live badge; engines not handed off)

**Exit:**
- [ ] Prefill domain + engine focus + Sample source flag
- [ ] Sample vs Live labeled until a live entitled run
- [ ] APS verdict + one action; zero unsigned hosted audit/PSI/oracle
- [ ] typecheck; 375px; reduced-motion

**Kill:** Guest hosted LLM; inventing Live metrics; score theater.

### M5 - Share virality (must-ship)

**Files:** `services/share/shareReportClient.ts`, `worker/shareService.ts`, `worker/marketingShell.ts`, `services/marketing/pageMeta.ts`, `worker/crawlDocuments.ts` (unfurl exception or allowlisted bot path for `/share/{token}`), `SharedReportView.tsx`, `tests/shareReports.test.ts`

**Exit:**
- [ ] Client uses `x-share-password` only (no `?password=`)
- [ ] Bot UA GET: `og:title` / `og:description` / `og:url`; passworded = generic protected copy
- [ ] Soft CTA: Instant Audit + Pricing/Growth
- [ ] Free POST still `SHARE_ENTITLEMENT_REQUIRED`
- [ ] Share unfurls not blocked solely by blanket `Disallow: /share/` (bot exception or scoped allow)

**Kill:** R2 OG images; password bypass for crawlers.

### M6 - MCP mint + Cursor snippet (must-ship)

**Files:** `InstantAuditView.tsx`, extract from `ApiKeysTab.tsx`, snippet builder + unit test

**Exit:**
- [ ] Growth + signed-in + first save: mint → key once → Copy key + Copy Cursor snippet
- [ ] Snippet targets `/api/mcp` + Bearer
- [ ] Free/Starter: Growth upgrade; unsigned: sign-in

**Kill:** New key store; Free MCP.

### M3 - Approve API

**Files:** `worker/mcpGovernance.ts` (reuse), `worker/index.ts` routes, tests, `docs/ops/MCP-GOVERNANCE.md`

**Exit:** Authz owner/admin; audit+redaction; staging E2E approve via HTTP.

### M7 - Packaging truth

**Files:** `PricingPage.tsx`, `PaywallModal.tsx` (SPA mostly aligned), `services/marketing/pageMeta.ts` `/pricing` crawler body (still Starter-centric), landing Digital credit

**Exit:**
- [ ] Crawler `/pricing` HTML matches Growth MCP+share vs Free/Starter (VAL Session 5)
- [ ] No Free=MCP / Free=share claims anywhere
- [ ] Digital not sold as Suite SKU

**Deploy:** FE (+ Worker if marketing shell ships crawler HTML).

### M1 - Staging Worker deploy (operator)

1. Confirm D1 tables (already done on staging).  
2. Operator: `deploy:staging` for Worker SHA with gov+budgets.  
3. Flip hosted `requireAuth` when ready.  
4. `npm run smoke:staging`.  
5. Live requireApproval drill (prefer M3 API; interim SQL OK once).  
6. **Do not rely on CI to migrate** (`deploy-cloudflare.yml` is deploy→smoke only). Always `db:migrate:staging` before Worker that needs new tables.

---

## 5. Track V-HD - Blender / Canvas 10x (no marketing Three)

**Measured committed plates** (craft lead; winning path ~31 KB hero+idle vs ~270 KB Three+GLB fail):

| Asset | Bytes | Soft | Hard |
|---|---:|---:|---:|
| `field-hero.webp` | 20,384 | ≤32 KB | ≤140 KB |
| `field-hero-nodes.webp` | 31,486 | ≤32 KB | ≤60 KB |
| `field-idle.webp` | 10,726 | ≤18 KB | ≤100 KB |
| `field-sample.webp` | 13,630 | ≤22 KB | ≤100 KB |
| hero+idle combined | 31,110 | ≤48 KB | ≤72 KB |
| `og-visibility-field.png` | 146,286 | ≤180 KB | ≤220 KB |
| archive GLB (authoring only) | 681,476 | - | ≤700 KB |

| Phase | Work | Exit | Budget |
|---|---|---|---|
| **V-HD1** | Bake lighting (HDRI, gold key, cool fill, rim, contact shadow, bloom 0.04-0.06; optional Cycles hero 64-128) | Optional regen; bake:check | Soft hero+idle ≤48 KB; hard ≤72 |
| **V-HD2** | Dual-layer hero far (~10/8 px) + near nodes (~22/16 px); omit near on 404 | `VisibilityFieldHero` | Nodes soft ≤32 / hard ≤60 |
| **V-HD3** | RAF lerp; Canvas depth scale + shadow ellipse; SVG light parallax; capability gate | Mid-desktop ~60fps | Skip plates on reduced-motion/saveData/low-mem |
| **V-HD4** | Honesty pulse: status→glow for idle\|pending\|measured\|estimated\|not_measured; hub breath only pending/measured; ramp ~400ms | Tests | Never pulse `not_measured` as scored |
| **V-HD5** | Probe twin SSOT (= M8); bake `NODE_POS` parity | One layout | Enums only |
| **V-HD6** | Instant Audit Live: Canvas/fragment first; Three only after CEO write | Lazy ≤120 soft / >200 fail; layout nodes; no GLB; host `VisibilityFieldThree.tsx` | Chunk gzip |

**CI:** `npm run constellation:bake:check`; `vitest` constellationLayout/capability/visibilityProbe; fail if `from 'three'` under `components/marketing` or `LandingPage`.

**Kill:** Runtime GLB; R3F; score numerals on plates; four per-engine focus plates day one; Blender required for CI `build`.

**Ship order:** V-HD1 → V-HD2 → V-HD3 → V-HD4 → V-HD5 → measure Sample→Instant Audit → Canvas Live depth → optional V-HD6.

---

## 6. Track P-remainder (paperclip → live)

| Phase | Work | Gate |
|---|---|---|
| **P-deploy** | = M1 live requireApproval E2E; optional smoke drill later | Operator; migrate **before** deploy |
| **P-lock-0013** | TTL (tool 30m; `budget_override` 72h or window end); raiser; DFS attribution; BYOK zero-cents; soft channel = audit + `/budgets/self` then optional Telegram | Docs |
| **P-approve-API** | = M3 | After P2 green so live path is not SQL-only under load |
| **P-invoice** | Golden set before hard stop | Blocks hard |
| **P-hard** | `BUDGET_ENFORCEMENT=hard` or per-policy | After invoice + operator yes |
| **P-vault** | License rotation verify | Rotation window |

**Agent demo coupling (platform):** mint UX (M6) + live Worker E2E (M1) + approve API (M3) before claiming investor-demoable MCP. Soft/hard budget (M2→P-hard) protects paid spend.

APS intact: Free MCP Growth+; paid needs Agency `apiAccess` or BYOK; `get_project_context` before paid; never invent metrics.

---

## 7. Production ready vs deployment ready

| Label | Meaning |
|---|---|
| **Production-ready (code)** | M4-M7 + V-HD1-5 in tree; typecheck/lint/test/build; bake:check; share header fixed; MCP snippet tested; no marketing Three |
| **Deployment-ready (staging)** | M1: Worker live; `requireAuth` true; smoke:staging green; share OG curl; soft budgets dogfood |
| **Deployment-ready (prod)** | Explicit operator approval; smoke:prod; named rollback SHA; no hard budget stop until P-invoice |
| **Investor-marketable** | **M4+M5+M6+M7 green on staging.** M1-M3 mature ops diligence |

### Quality gates (every PR)

```bash
npm run secrets:check
npm run tokens:check
npm run typecheck
npm run lint
npm test
npm run constellation:bake:check
npm run build
```

### Rollback

| Layer | Action |
|---|---|
| FE | Prior assets SHA |
| Share/gov Worker | Prior SHA; keep tables; revoke bad shares |
| Budget | `BUDGET_ENFORCEMENT=off` or prior SHA; keep `cost_events` |
| Three experiment | Remove chunk → Canvas |

---

## 8. Kill criteria

1. Fake SEO score / citation % / $ ROI as fact.  
2. Marketing `three`, R3F, or runtime GLB.  
3. Paperclip brand fork.  
4. Prod deploy without operator chat approval.  
5. Free/Starter MCP or shareLinks claims.  
6. Mixed craft+Worker secrets PR while either track is hot.  
7. Hard budget stop before soft era + invoice reconcile.  
8. Guest hosted LLM/PSI without auth.

---

## 9. Engineering loop

| Role | Owns |
|---|---|
| CEO | Order, kills, Three override, packaging |
| Full-stack | M4-M6 FE + Worker routes + smoke |
| AI/ML product | Honesty in OG/CTA/handoff |
| Graphics | V-HD bake + Canvas/SVG |
| Deploy operator | M1 Worker + requireAuth flip |

**`/loop`:** every **12m** (`AGENT_LOOP_TICK_investor-mkt-exec`): verify M4-M7 tests still green; do not add marketing Three/GLB; next open slices are M1 (operator deploy) or M3 approve API if operator asks; stop when operator says stop or M1+M3 also green.

---

## 10. 10x vs prior plans

| Prior | Ceiling | This plan |
|---|---|---|
| suite-10x | P1+V1-V3+S1 in tree | Investor spine M4-M7 must-ship; M1 live gov |
| paperclip ship | H1 + SQL drill | M1 Worker + M3 approve API + M2 soft dogfood |
| landing-moat | S1 done | S2 handoff + VAL elevated |
| "Add Three for HD" | Payload fail | V-HD1-5 plates+Canvas; V-HD6 gated |
| Investor canvas | Diagnosis | Ordered execute + deploy/rollback + loop |

---

## 11. Double-check before adding anything

1. Raises Sample → Instant Audit → save → share or MCP? Decorative only → kill.  
2. APS honesty? Sample/Live labeled?  
3. Marketing Three or runtime GLB? → kill.  
4. Plate/layout change? → bake:check.  
5. New migration? → smoke D1 + migrate-before-deploy.  
6. Packaging matches Growth entitlements?  
7. Prefer edit over create; no paperclip brand.  
8. Re-run 1-7 after draft; fail → delete before merge.

---

## 12. Missed gaps (specialist merge 2026-09-29)

| Gap | Severity | Note |
|---|---|---|
| `approveActionRequest` without HTTP | Major | M3 |
| S1 copy in PR #22 not live until merge+FE deploy | Major | Marketable after ship |
| Soft-alert delivery channel unspecified | Major | P-lock-0013: audit + `/budgets/self` first |
| Suite-10x already mixed MCP+craft on one branch | Major | Split future PRs (M0) |
| `Disallow: /share/` blocks unfurls | Critical | M5 with OG |
| Crawler `/pricing` Starter-only | Major | M7 `pageMeta.ts` |
| CI no migrate-before-deploy | Major | Operator runbook; do not rely on workflow |
| Probe engines stay demo-local | Major | M4 handoff args |

Specialist inputs merged: [CEO ship-order](61c448b4-daba-469a-a32b-3023071064e2), [full-stack activation](36918dbd-51d8-4000-890b-2cb302988786), [craft V-HD](fc69f971-8413-4c43-bf05-ba4101ce447f), [paperclip P-remainder](8d65931c-2445-45f1-8306-ef861343bccf).

**CEO execute double-check** ([miss+10x](e3d5b440-b285-41ef-8ca8-405a0e2186bc)) ran on a **pre-land snapshot**. Post-land: M3-M7 are in tree. Remaining open: M1 staging Worker deploy + `requireAuth`, then M2 dogfood, then prod only with explicit approval.

---

## 13. Next operator asks (pick one)

1. **Approve / run staging Worker deploy (M1)** + `requireAuth` flip, then `npm run smoke:staging`.  
2. **Merge PR** then prod Worker only with explicit chat approval.  
3. Soft-budget dogfood (M2) after staging Worker is live.

*M3-M7 are in tree. Staging/prod Worker deploy still needs operator approval.*
