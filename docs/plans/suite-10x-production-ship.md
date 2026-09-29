# Suite 10x Production Ship

**Date:** 2026-09-29  
**Status:** P1+V1+V2+V3 (S1 copy) landed; staging D1 `0011`-`0013` applied; governance SQL approve drill passed (`drill-*` on staging). Next: P2 Worker deploy for live MCP requireApproval E2E, or S2 Probe continuity.  
**Owner:** CEO + full-stack + graphics/perf + AI/ML product  
**Companions:** [`landing-moat-100x.md`](./landing-moat-100x.md), [`paperclip-pattern-production-ship.md`](./paperclip-pattern-production-ship.md), [`premium-craft-surface.md`](./premium-craft-surface.md), [`budget-policies-and-enforcement.md`](./budget-policies-and-enforcement.md), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md)  
**Pattern library (outside repo):** sibling `paperclipai/paperclip` @ `53aad90b9` (never vendored into Suite)

## Assumption

This plan **10xs** two prior deliverables in one production sequence:

1. Paperclip-pattern platform ship (`0009`-`0014`).  
2. Blender / Three visual recommendations for landing + Instant Audit.

It does **not** reopen locked marketing runtime decisions. Where the user ask ("HD interactive Three everywhere") conflicts with measured budgets and APS honesty, we name the conflict and ship the industry path that wins on quality **and** payload.

## A. Pushback (locked)

| Impulse | Decision | Why |
|---|---|---|
| Ship Three.js on the landing to look top 1% | **Refuse** | Plates ~20-31 KB gzip; `three` + archive GLB ~264-281 KB fails soft ≤120 and hard >200 |
| Load Blender `visibility-field.glb` at runtime | **Kill forever on marketing** | Archive/authoring only (`design/constellation/`) |
| R3F / drei / Framer / GSAP on marketing critical path | **Refuse** | Weight + motion-slop; conflicts with moat deslop |
| Bare visibility score / citation % / $ ROI theater | **Forbidden** | APS: enums only (`measured` / `estimated` / `not_measured`) |
| Fork paperclip brand or packages into Suite | **Refuse** | Luminara-only; patterns only |

**What "10x HD interactive" means here:** Blender Cycles/Eevee beauty stills as **layered WebP depth mattes** + Canvas2D/SVG interaction that feels physical (parallax, hover depth, honesty-bound pulse). Optional vanilla Three **only** on Instant Audit Live after written CEO override (layout nodes, no GLB).

**10x definition (craft + platform):** Order-of-magnitude lift in (a) operator-safe MCP/budget production discipline and (b) perceived visual fidelity / interaction continuity into Instant Audit. Not a public conversion KPI. Not "add Three."

---

## B. Track P - Platform 10x (paperclip patterns)

**North-star:** Paid MCP cannot silently outage; approvals are operator-speed; soft-alert era is human-visible before any hard stop.

### Already done

- Specs `0009`-`0012` code + tests; `0013` design; `0014` code largely landed.  
- **H1:** `worker/budgets.ts` schema-aware fail-open, upsert `hard_stop_enabled` default 0, `BUDGET_ENFORCEMENT` kill-switch; `tests/budgetPolicies.test.ts` green.

### Phases (execute order)

| Phase | Work | Exit criteria | Deploy |
|---|---|---|---|
| **P0** | Tokens + redaction hygiene | `tokens:check` / `secrets:check` 0; staging audit `[redacted]` | Anytime |
| **P1** | D1 migrate preflight in `scripts/smoke-check.mjs` | Smoke fails if `mcp_action_requests` / required budget tables missing for the SHA | Block Worker budget/gov flips |
| **P2** | Apply `0011`, governance drill | Destructive → `requiresApproval` → approve → execute; APS intact | **migrate then** `deploy:staging` → prod |
| **P3** | Lock 0013 open questions in design doc | TTL per kind; who raises; DFS attribution; BYOK zero-cents; soft-alert channel | Docs only |
| **P4** | Budget-P0 soft alerts | Migrate `0012`+`0013`; `BUDGET_ENFORCEMENT=soft` or hard_stop 0; dogfood policies only; invoice reconcile | Staging → prod |
| **P5** | Authenticated approve/deny API for `mcp_action_requests` | No raw SQL for on-call; audit intact | After or late-overlap P2 |
| **P6** | Budget-P1 hard stops | Per-policy or env `hard`; `BUDGET_EXHAUSTED` + resume | After invoice golden set |
| **P7** | License vault rotation verify | Staging KV then prod; `verified N/N` | Rotation window |
| **P8** | Project budgets + UI | Luminara names only | Later |

**10x vs original paperclip plan:** migrate-in-smoke gate; automated governance smoke drill; approval API (not SQL-only); human-visible soft alerts; invoice golden set before hard stops; single decision vocabulary (`tool_quarantined` / `subscription_required` / `budget_exhausted`).

**File index:** `worker/{budgets,mcpGovernance,mcpServer,logRedaction,env,index}.ts`, `migrations/0011_*` / `0012_*` / `0013_*`, `scripts/smoke-check.mjs`, `docs/ops/MCP-GOVERNANCE.md`.

---

## C. Track V - Visual 10x (Blender HD + Canvas; Three gated)

**North-star:** Industry-grade, realistic, interactive **feel** on marketing without shipping WebGL. Instant Audit may later earn a true camera.

### Measured baseline

| Piece | Approx gzip |
|---|---|
| `field-hero.webp` + idle | ~31 KB |
| Archive GLB | ~161-175 KB (never runtime marketing) |
| three + GLB if loaded | ~264-281 KB (**hard fail**) |

### V0 - Craft isolation

Land constellation/marketing on a craft-isolated PR. No Worker/MCP secrets churn. CI runs `npm run constellation:bake:check`.

### V1 - Blender plate HD ladder (biggest realism win)

**Authoring (`scripts/constellation/bake_visibility_field.py`):**

- Studio HDRI (low contrast), gold key + cool fill + cinematic rim.  
- Contact shadows + soft shadows; SSR on hero only.  
- Bloom 0.04-0.06 (less glow-slop).  
- Hub clearcoat; status emission mapped only to honesty enums.  
- Optional Cycles hero A/B (64-128 samples, denoised); idle/sample stay Eevee Next.  
- Mesh density: hub ~96 / nodes ~64 segs for 1600px silhouette.

**New / changed plates:**

| File | Role | Soft | Hard |
|---|---|---|---|
| `field-hero.webp` | Far layer | ≤32 KB | ≤80 KB (bake.mjs hero cap stays ≤140-160 KB) |
| `field-hero-nodes.webp` **NEW** | Near transparent layer (hub+nodes) | ≤24 KB | ≤60 KB |
| `field-idle.webp` / `field-sample.webp` | Interactive underlays | ≤18 / ≤22 KB | ≤100 KB |
| Combined hero+idle path | Marketing critical | ≤48 KB soft | ≤72 KB hard |
| `og-visibility-field.png` | Share | ≤180 soft | 220 hard |

Runtime parallax moves far/near layers at different amplitudes (poster + depth matte). Do **not** ship four per-engine focus plates on day one; prove one optional focus plate max.

**Honesty:** plates never paint score numerals or fake SEO KPIs.

### V2 - Canvas2D / SVG interaction fidelity

| Surface | 10x upgrades |
|---|---|
| `VisibilityConstellationCanvas.tsx` | Hover depth (scale + shadow ellipse); plate transform opposite to nodes; hub breath only when pending/measured; status glow ramp ~400 ms |
| `VisibilityConstellationSvg.tsx` | Light pointer parallax; estimated edge dash motion; reduced-motion = static |
| `VisibilityFieldHero.tsx` | Use `field-hero-nodes.webp` as near layer; far/near amplitude split; spotlight bias from selected engine |
| Shared helper | Status → glow/pulse map for `idle\|pending\|measured\|estimated\|not_measured` |

Targets: mid-desktop Canvas ~60 fps; 375px / saveData / reduced-motion / low-mem → SVG + no plates (`constellationCapability.ts`).

### V3-V5 - Moat craft (from landing-moat)

Category copy, Probe→Instant Audit continuity, packaging truth, Map twin SSOT, Hallmark evidence, `vite build` proves no Three on marketing. See `landing-moat-100x.md` S1-S5.

### V6 - Optional Instant Audit Three (CEO written override only)

**Not marketing. Not LandingPage.**

| Rule | Spec |
|---|---|
| When | After V5 + written CEO override |
| Load | Dynamic `import('three')` after Instant Audit idle; capability gate + Live/entitled |
| Geometry | Procedural from `constellationLayout.ts` only. **No GLB** |
| Interaction | Named orbit/tilt (±15° yaw, ±8° pitch) or pick-to-engine. If "depth only," prefer Canvas/fragment first |
| Libs | Vanilla three only. No R3F/drei/post stacks |
| Budget | Soft ≤120 KB gzip chunk; hard fail >200 KB |
| Fallback | Canvas2D constellation |

Suggested host: `components/audit/VisibilityFieldThree.tsx` lazy from Instant Audit shell.

### Track V ship order

1. Bake v2 (lighting + `field-hero-nodes.webp` + soft/hard budgets in `bake.mjs`).  
2. Hero dual-layer wiring.  
3. Canvas honesty depth.  
4. SVG light parallax.  
5. Stop and measure Sample→Instant Audit.  
6. Only then consider V6.

---

## D. Parallel sequencing (non-blocking)

```
Craft branch:     V0 → V1 → V2 → V3 → V4 → V5 ──(optional V6)
Platform branch:  P1 → P2 → P3 → P4 → P5 → P6
                  P0 anytime; P7 on rotation calendar
```

| Rule | Detail |
|---|---|
| Branch split | Craft = constellation/marketing. Platform = `worker/*`, `migrations/*`, smoke |
| No hard wait | V does not wait for Budget-P0; P does not wait for plate HD |
| Soft couple | V3 packaging claims must match APS already enforced in P2 |
| Staging | FE craft can ship without budget tables; budget Worker SHA needs P1+P4 migrate first |
| Prod | Explicit operator approval for Worker; FE-only craft OK if Worker unchanged |

---

## E. Quality gates and rollback

### Every PR / release SHA

```bash
npm run secrets:check
npm run tokens:check
npm run env:validate
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

**Track V:** `npm run constellation:bake:check`; constellation + Probe vitests; no `three` import under `components/marketing` / `LandingPage`; reduced-motion + 375px check.

**Track P:** phase test slices; `smoke:staging` / `smoke:prod`; migrations list before deploy; governance require_approval drill in smoke.

### Rollback

| Layer | Action |
|---|---|
| Marketing FE | Prior deploy SHA; leave plates |
| Governance Worker | Prior SHA; keep `mcp_action_requests` (no DROP) |
| Budget | `hard_stop_enabled=0` / `BUDGET_ENFORCEMENT=off` or prior Worker; keep `cost_events` |
| Vault | Re-seed prior generation from offline backup |
| Three experiment | Remove chunk; Instant Audit falls back to Canvas/SVG |

### Stop conditions

- Do not claim budget production-ready until P1+P4 staging green, soft alerts visible, invoices reconciled, operator approves hard stop.  
- Do not claim visual 10x shipped until V0 isolation + bake:check in CI + zero marketing Three/runtime GLB.  
- Do not start V6 without written CEO override after V5.

---

## F. 10x deltas vs prior plans

| Prior | Ceiling | This plan |
|---|---|---|
| `paperclip-pattern-production-ship.md` | H1 + SQL approve + audit soft alerts | Migrate preflight; automated gov drill; approval API; human-visible soft alerts; invoice gate before hard stop |
| `landing-moat-100x.md` | Correct Three kill; S0-S5 | Layered HD plate ladder + soft/hard split; Canvas depth spec; parallel with Track P |
| Critique "add Three for HD" | Payload fail | Named refusal + measured alternative (~48 KB soft path vs ~270 KB fail) |
| Blender as one flat still | Competent | Industry poster + transparent depth matte + honesty-bound Canvas motion |

### Double-check before adding anything new

1. Category / APS honesty intact?  
2. Marketing Three or runtime GLB? → kill.  
3. Plate/layout change? → bake:check.  
4. New migration? → P1 preflight + migrate-before-deploy.  
5. Prefer edit over create; no paperclip brand; no second budget/approval system.  
6. Re-run 1-5 after the draft exists; fail → delete before merge.

---

## Operator asks (approve to unlock execution)

1. Confirm Track V path: **HD Blender plates + Canvas** (not marketing Three).  
2. Confirm Track P next code slice: **P1 migrate preflight** (or P2 staging migrate if `0011` not applied).  
3. Written CEO override required before any V6 Three work.  
4. No production deploy / migrate without explicit approval in chat.

## Immediate execute queue (when operator says go)

1. P1: extend `scripts/smoke-check.mjs` with D1 table preflight.  
2. V1: bake script HDRI/materials + `field-hero-nodes` + budget soft/hard in `bake.mjs` (local Blender).  
3. V2: wire dual-layer hero + Canvas hover depth.  
4. Do not mix Worker and craft in one PR.

## Missed gaps (double-check pass)

| Gap | Severity | Owner |
|---|---|---|
| `BUDGET_ENFORCEMENT` not yet in `.env.production.example` / wrangler vars docs | Major | P1 |
| Transparent WebP path for `field-hero-nodes` needs sharp RGBA in `bake.mjs` | Major | V1 |
| paperclip plan section 3 still narrates H1 as required (stale; H1 landed) | Minor | docs hygiene |
| Governance smoke drill not yet automated in `smoke-check.mjs` | Major | P2 |
| Soft-alert UI strip beyond `GET /api/budgets/self` not designed | Major | P4 |
| V6 Three chunk isolation test (marketing graph must stay three-free) not written | Major | V5/V6 |
