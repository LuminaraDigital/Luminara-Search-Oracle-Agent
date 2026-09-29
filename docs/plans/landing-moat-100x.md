# Landing Moat 100x (redo) - craft, category, Three.js verdict

**Date:** 2026-09-29 (redo + specialist merge)  
**Status:** Planned (ready to implement after craft PR isolation)  
**Owner:** CEO craft loop + full-stack + AI/ML product + graphics/perf  
**Companions:** [`premium-craft-surface.md`](./premium-craft-surface.md), [`user-activation-first-value.md`](./user-activation-first-value.md), [`virality-activation-loops.md`](./virality-activation-loops.md), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), [`suite-10x-production-ship.md`](./suite-10x-production-ship.md) (Track V HD plates + Track P platform execute)  
**Supersedes:** prior Session M*/S* drafts and earlier same-day session order in this file; **this merge is authoritative** for moat locks. Suite-wide 10x execute order lives in `suite-10x-production-ship.md`.

## Overview

Close the gap between a competent Instant Audit SaaS landing and a **category-defining moat site**:

- **Category (Suite):** cost-displacement + AI / modern software adoption **without rebuild**.  
- **Proof wedge:** Visibility Probe / Instant Audit (Google, AI Overviews, ChatGPT, Perplexity) with honesty enums. Visibility is the demo, not the category subtitle.  
- **Luminara Digital:** builder / operator / optional DFY. One attribution. Not a Suite SKU.

**North-star:** % of visitors who finish a labeled Sample scout **and** open Instant Audit (or Sign in to save) in-session.

**“100x / 10x” definition (locked):** Order-of-magnitude lift in category clarity, proof, hierarchy, and activation handoff. **Not** a public conversion KPI. **Not** “add Three.js.”

## Agree / disagree with the critique (CEO + honesty)

### Agree (absorb into ship order)

| Critique | Locked response |
|----------|-----------------|
| Site sells “what” more than unique “why” | Fold leads cost-displacement + adoption-without-rebuild; visibility is support/proof |
| “Show up where customers ask” is narrow | Replace hero / `brandSub: "AI search visibility"`; Probe remains the Workbench proof |
| Generic AI/SEO phrasing | Ownable POV: signal from noise + stack consolidation |
| Modern-SaaS visual sameness | Deslop glass/card density; Blender plates + Canvas2D Field |
| Need product story sequence | Probe: domain → engines (enums) → one ship action → Instant Audit |
| Need proof without fake case studies | Labeled Sample + methodology; Live only on entitled Instant Audit path |
| CTA should name the artifact | Outcome CTAs only if true (“Run sample scout” / “Open Instant Audit”) |
| Hierarchy / rhythm flat | POV → problem → Workbench → result → Digital credit + cost thesis → packaging → FAQ → CTA |
| Suite vs Digital unclear | Suite = product surfaces; Digital = Built-by / DFY once |

### Disagree or constrain (do not ship)

| Critique suggestion | Pushback |
|---------------------|----------|
| Bare **AI visibility score** (0-100) | **FORBIDDEN** as Live. Engine enums only: measured / estimated / not_measured |
| Competitor leaderboard / citation % | **FORBIDDEN** on Sample. Live only when both sides measured |
| Estimated $ / revenue / ROI on marketing | **FORBIDDEN** as fact. Qualitative actions + stack consolidation only |
| Before/after KPI deltas without user Live series | **FORBIDDEN**. Process storyboard OK; metric morphs not |
| “Results in under five minutes / no card” | Only if product-true. Guest Live still auth/BYOK gated |
| Add Three.js to feel top 1% | **Default NO.** Plates already ~20-31 KB; three+archive GLB ~264-281 KB gzip fails hard gate |
| Guaranteed savings / “millions” / “100x cheaper” | Qualitative only. “100x” = craft north-star, not landing metric |
| Blender beauty as SEO evidence | Metaphor for Probe/Audit only |

## Three.js + Blender (graphics merge)

### Measured payload (this session)

| Piece | Gzip (approx) |
|-------|----------------|
| `field-hero.webp` + idle plates | ~20-31 KB |
| `visibility-field.glb` (archive) | ~175 KB (~398 KB raw) |
| `three` min + loader (est.) | ~88-112 KB JS |
| **three + this GLB if loaded** | **~264-281 KB** → soft ≤120 **FAIL**, hard >200 **FAIL** |

### What already ships

- Blender authoring → WebP plates + archive GLB (bake only).  
- Runtime marketing: SVG + Canvas2D + plates. No Three. No runtime GLB.  
- Capability gates: desktop ≥768, reduced-motion / saveData / low-mem skip plates.

### Locked decision

1. **S0-S5:** Blender + Canvas2D/SVG only. No `three` in `package.json`.  
2. **Runtime load of archive GLB: KILL forever on marketing** (and do not use Draco to “fix” it).  
3. **Optional later (CEO override in writing):** vanilla Three **only** if a named Instant Audit Live depth interaction fails without true 3D camera, lazy after idle, **nodes from `constellationLayout` (no GLB)**, chunk ≤120 KB gzip, fail >200 KB, no R3F/drei, product enums only. Prefer a fragment shader over Three if depth is the only ask.  
4. **10x path:** category copy, Workbench continuity, Map twin, packaging honesty, deslop - not WebGL.

Sources: [Solaya GLB + posters](https://blog.solaya.ai/blog/how-to-export-3d-visuals-for-web-a-marketers-guide), [Praxvon WebGL earns vs tanks](https://praxvon.com/en/blog/3d-on-the-web-webgl-performance).

## Double-check protocol (before adding ANYTHING new)

1. **Category:** Sells cost-displacement / AI adoption without rebuild, or only generic AEO SaaS? If only latter → rewrite or drop.  
2. **APS honesty:** Sample vs Live labeled? Enums only? No bare score / citation % / fake logos / $ savings?  
3. **Proof job:** Makes Probe → Instant Audit → (MCP/share) clearer? Decorative only → kill.  
4. **Budget / 3D:** Would it add `three`, R3F, Framer, GSAP, or runtime GLB to marketing? → kill.  
5. **Blender path:** Plates/layout touched? → `npm run constellation:bake:check`. Runtime still no GLB/Three on marketing.  
6. **Entity:** Suite vs Digital still one product + one builder attribution?  
7. **Packaging:** Free/Starter/Growth/Agency claims match APS?  
8. **Merge hygiene:** Craft PR vs MCP PR? Mixed → stop and split.  
9. **Gates:** typecheck; targeted tests; 375px + desktop; reduced-motion; unsigned = no hosted spend.  
10. **North-star:** Raises Sample-complete → Instant Audit / Sign in? “Looks premium” alone → deprioritize.  
11. **Second pass:** Re-run 1-10 after the draft exists; fail → delete before merge.

## Missed gaps

| Gap | Severity | Session |
|-----|----------|---------|
| Category / replace `brandSub` / hero | Critical | S1 |
| Probe → Instant Audit continuity | Critical | S2 |
| Suite vs Digital + packaging truth | Critical | S3 |
| Cost-displacement thesis (qualitative) | Critical | S3 |
| Map = Probe twin SSOT | Major | S4 |
| Glass/card denslop / one composition | Major | S1 |
| Methodology / what we measure | Major | S2 / S5 |
| Untracked plates + CI bake:check | **Deploy blocker** | S0 |
| Three (layout-only, Instant Audit) | Optional CEO | After S5, not default |

Local craft gates (bake:check, constellation/Probe tests, tsc, Three absent): **pass**. Full lint/test/staging: **S5**.

## Company goal (copy SSOT)

Luminara helps businesses replace unnecessary technology costs, accelerate AI and modern software adoption, and grow visibility, revenue, and operational capability without forcing a rebuild from scratch.

## Narrative locks (honesty merge)

**Hero promise (one sentence):**  
Adopt AI that audits, probes visibility, and works in your IDE - so you cut tool sprawl, ship faster, and grow without rebuilding your stack.

**Recommended fold (urgency + honesty):**

> **AI is deciding which businesses get discovered.**  
> Luminara shows where you appear across Google, ChatGPT, Perplexity, and AI answer engines - then a prioritised plan to grow without rebuilding your stack.  
> **[Run sample scout]** / **[Open Instant Audit]**  
> Sample is labeled. Live follows Instant Audit rules (auth/BYOK as configured).

**Visibility score lock:** Never a bare composite “AI visibility score” on landing. Per-engine measured / estimated / not_measured + Sample vs Live.

**Competitor lock:** Capability claim OK. Numbers only when Live measured for both sides.

**Business impact lock:** Ordered actions and stack consolidation. No $ uplift as fact. Any calculator = illustrative user inputs, off hero proof.

**Before/after lock:** Sample workflow states OK. Metric deltas only from that user’s Live series.

**Cost-displacement lock:** Replace unnecessary tool/retainer theater + accelerate AI without rebuild. Qualitative only.

**Dual-brand lock:** Brand-first on product = **Luminara Suite**. **Luminara Digital** = builder/operator/DFY, one credit. Never attribute Digital DFY metrics to Suite Live audits.

**Digital bridge (below fold):**

> **Visibility is only the beginning.**  
> Built by Luminara Digital - optional implementation and stack review so you modernise without a rip-and-replace.

**Forbidden (short):** Invented SEO KPIs; unlabeled Sample-as-Live; score theater; fake social proof; Free MCP/share; Blender-as-evidence; dollar impact as fact; decorative Three; runtime GLB on marketing.

### Packaging truth

| Tier | Landing may say |
|------|-----------------|
| Free | Insight / sample; soft gate save/share/hosted |
| Starter | Web audits; no MCP, no share |
| Growth | MCP + share |
| Agency | + apiAccess |

## Decision locks

| Lock | Decision |
|------|----------|
| Category | Cost-displacement + AI adoption without rebuild; visibility = proof wedge |
| Entity | Suite = product; Digital = builder / DFY once |
| 3D default | Blender stills + Canvas2D/SVG |
| Three.js | CEO override only; Instant Audit depth; **no runtime GLB** |
| Score theater | Banned |
| Scope | Landing + Probe + Map + Pricing/Paywall voice |
| PR | Isolate craft from MCP mega-branch before merge |

## Non-goals

- Claiming top 1% as a measured fact  
- Three/R3F/runtime GLB by default  
- Fake case studies / guaranteed savings  
- Rip-and-replace website rebuild  
- Marketplace / forum  
- Digital sold as a Suite tier  

## Sessions (authoritative order)

CEO reorder: hygiene → category → proof → entity/packaging → Map twin → harden. Map after packaging so we do not polish a second fixture while category still lies.

### S0 - Craft PR isolation (deploy hygiene)

**Outcome:** Plates, bake scripts, CI bake:check, marketing constellation files on `feat/visibility-field-craft` (or similar). MCP/governance stay on their branch.

**Acceptance:**
- [ ] `public/brand/constellation/**`, `scripts/constellation/**`, `design/constellation/**`, constellation components/tests, bake:check in CI land together  
- [ ] No Worker/MCP secrets churn in craft PR  
- [ ] `constellation:bake:check` green in CI  

**Kill:** Mega-PR mixing MCP + craft.

*Operator must explicitly request commit/PR.*

### S1 - Category POV + deslop + one composition

**Status:** Done on `feat/mcp-governance-hardening` (2026-09-29). `brandSub` removed; hero = cost-displacement + adopt without rebuild; CTAs = Run sample scout / See pricing; nav Pricing · Why · How.

**Outcome:** Fold = one Workbench. Brand hero-level. Category = cost-displacement + adoption without rebuild. Kill `brandSub: "AI search visibility"`. ≤2 CTAs. Kill glass/card-as-proof. Nav: Pricing · Why · How. Digital attribution once.

**Acceptance:** Remove brand/nav → still reads as Luminara modernisation / cost-displacement product, not generic AEO SaaS. Sample labels intact. Reduced-motion OK. typecheck; 375px smoke.

**Kill:** Score theater; Three; feature-grid relapse; fake $ savings.

### S2 - Probe → Instant Audit continuity (proof)

**Outcome:** Domain + engine focus + Sample badge handoff into Instant Audit. Methodology strip (what we measure / don’t).

**Acceptance:** Prefill works; Sample vs Live labeled; zero unsigned hosted audit/PSI/oracle; APS verdict + one action.

**Kill:** Guest hosted LLM; inventing Live metrics; score theater to close the demo.

### S3 - Suite vs Digital + packaging + cost thesis

**Outcome:** Entity clarity. Qualitative cost-displacement section. Pricing/Paywall Growth truth.

**Acceptance:** No Free=MCP; soft Save / Open Instant Audit; Share/MCP only when entitled.

**Kill:** Fake free trial; SKU remap; Digital as Suite tier; invented $ retained.

### S4 - Map = Probe twin SSOT

**Outcome:** Below-fold Field shares Probe/demo engine state (one SSOT).

**Acceptance:** bake:check; Sample figcaption; plates budgets; SVG+Canvas2D only; no Three; no second metaphor.

### S5 - Evidence + deploy harden

**Outcome:** Hallmark ≥9 with evidence; `vite build` proves no Three on marketing; full CI; staging smoke; prod only with approval.

**Kill:** Labs/cinematic intro; ship without staging.

**Parallel (not stuffed into S0-S5):** Guest Live Instant Audit (activation), VAL share OG - jump ahead only if operator says stickiness fails without Live guest path.

### Optional later - Three Instant Audit depth (CEO only)

**Not a marketing session.** Layout-driven nodes only; no archive GLB; measured vite gzip ≤120 / fail >200; named interaction that plates cannot do.

## Deploy readiness gate (every session)

1. Double-check protocol 1-11 passed  
2. Honesty grep for score theater / bare scores  
3. No new `three` / runtime GLB unless CEO override  
4. bake:check if plates/layout touched  
5. typecheck + targeted tests  
6. reduced-motion / mobile path  
7. No unsigned hosted audit/PSI/oracle  
8. Packaging truth  
9. Staging smoke before prod  
10. Operator approval for Worker prod  

## Verify commands

```bash
npm run constellation:bake:check
npm run typecheck
npx vitest run tests/constellationLayout.test.ts tests/constellationCapability.test.ts tests/visibilityProbe.test.ts
npm run lint:ci
npm test
npm run build
```

## Production baseline (2026-09-29 specialist merge)

| Check | Status |
|-------|--------|
| bake:check / constellation+Probe tests / tsc | Pass |
| `three` in package.json | Absent |
| Archive GLB | ~398 KB raw / ~175 KB gzip (archive only; never load on marketing) |
| Plates | ~20-31 KB (shipped path) |
| three + GLB if loaded | ~264-281 KB gzip (hard fail) |
| Full lint/test/staging | S5 |
| Merge hygiene | **Blocker until S0** |

## Specialist synthesis (merged)

| Role | Agent | Absorbed |
|------|-------|----------|
| CEO | [CEO redo moat plan](2f2e61d3-5ef4-460a-8000-f0aa4e04aa1c) | Category = cost-displacement; visibility = wedge; S0→S5 reorder (packaging before Map); Three not the fix |
| Graphics | [Graphics Three.js budget](2d908fe5-8c1e-40e7-a667-b8d2137bfed3) | Payload table; kill runtime GLB; plates win; layout-only Three if ever |
| Honesty | [Honesty critique pushback](18537853-9003-4a6d-b28b-b6d6076bae4d) | Safe vs forbidden table; dual-brand; paste-ready locks |
| Prior full-stack | [Full-stack readiness audit](b2c4d602-7f56-4084-8cde-78f4be437eb4) | S0 merge hygiene |

## Sources

- [How to export 3D visuals for web (GLB + static posters)](https://blog.solaya.ai/blog/how-to-export-3d-visuals-for-web-a-marketers-guide) (2026)  
- [3D on the Web in 2026: When WebGL earns vs tanks](https://praxvon.com/en/blog/3d-on-the-web-webgl-performance) (2026)  
- [Interactive product demos that convert](https://livedemo.ai/blog/how-to-build-interactive-demo-2025/) (2025)  
- [product-proof-saas](https://skills.rest/skill/product-proof-saas)  
- [AEOlens](https://aeolens.ai/) (competitor score-theater anti-pattern)

## Operator ask

1. Approve **S0** craft-isolated commit/PR (required).  
2. Confirm **S1** after S0.  
3. Default remains **no Three**; Instant Audit depth only with written CEO override after S5.
