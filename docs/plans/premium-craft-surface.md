# Premium Craft Surface (top 1% marketing + app)

**Date:** 2026-09-23  
**Status:** Production deployed (staging + prod). MVP craft + U2 guest Instant Audit + C4 Canvas constellation live. Deep-link hotfix: `/#instant_audit` cold-load via `resolveAppView` (prod `3dd2bbfa-6a8b-462b-ac0e-9b9486053ab1`).
**Owner:** CEO craft loop (design systems + full-stack + graphics + product narrative)  
**Companion:** [`user-activation-first-value.md`](./user-activation-first-value.md), Hallmark redesign verb, checklist [`tasks/todo.md`](../../tasks/todo.md)

## Overview

Close the gap from "nice dark SaaS" to museum-grade craft: non-slop senior UI, interactive landing stickiness, product-serving 3D presence, and premium impressiveness across marketing and app.

**North-star:** A senior frontend engineer opens the landing, stays for the demo, and leaves saying the surface is crafted, not generated. Scores target **10/10** on: non-slop craft, 3D presence, interactive stickiness (landing), premium impressiveness (app + marketing).

## Engineering loop (how we ship)

Same loop as activation. Do not arm an idle timer for planning. Re-run only when implementing or when a slice fails verify.

1. **Plan** - vertical slice + acceptance (this doc)
2. **Build** - one slice only; edit over create
3. **Verify** - smoke path + perf/a11y budgets + Hallmark gate pass
4. **Polish** - copy / empty / reduced-motion only if verify fails clarity
5. **Gate** - CEO kill criteria; do not start next slice until gate passes

### Specialist roles (per slice)

| Role | Owns |
|------|------|
| CEO | Scope, kill criteria, phase order, honesty / APS invariants |
| Hallmark design | `design.md`, macrostructure, punch list, slop gates |
| Full-stack surface | File ownership, App.tsx wiring, auth/guest boundaries |
| Product narrative | Demo state machine, no invented metrics |
| Graphics / perf | Atmosphere, 3D metaphor, lazy load, FPS / payload budgets |

## Decision locks

| Lock | Decision |
|------|----------|
| Leverage order | (1) Atmosphere / visual plane on landing → (2) Real interactive demo → (3) Cut CTA/section clutter → (4) True 3D only if product-serving |
| Macrostructure (marketing) | **Workbench** as family. Landing hero is the product stage, not a claim stack. Below-fold uses a single **Map / Diagram** composition for answer-engine visibility (not a second SaaS feature grid). |
| Genre | **Atmospheric** craft with locked Luminara gold/black (not purple AI defaults). Modern-minimal restraint on chrome density. |
| Nav / footer | Nav **N10 scroll-morph** (pill on scroll). Footer **Ft5 Statement** (not 4-column Ft3). Desktop rail diet: Pricing · Why · How. Drop "Our AI" from primary rail. |
| CTA voice | Sentence-case primary/secondary (retire ALL-CAPS micro CTAs on marketing). Max 2 in hero fold. |
| Demo honesty | Never invent SEO metrics. Use engine enums `idle` → `pending` → `measured` \| `estimated` \| `not_measured`. Clear Sample vs Live badges. Ban fake score fallbacks (e.g. VisibilityRadar-style default `68`) on landing. |
| Live vs sample | Default: **client-only scripted sample** (works offline). Soft handoff to Instant Audit when authed. Guest live BYOK only after activation Slice A. Never public hosted audit API from landing. |
| 3D metaphor | **Answer-engine visibility constellation**: brand hub + four nodes (Google, AI Overviews, ChatGPT, Perplexity). Lit = measured; dim/dashed = not_measured. No decorative particles. |
| 3D tech | Phase A-B: CSS / SVG / Canvas2D only. Phase C: lazy **vanilla Three** or one fragment shader behind `import()` + idle. **Reject R3F/drei** on marketing path (payload). |
| Motion | Prefer CSS + small React state. Fix dead `animate-premium-drift*` keyframes or replace explicitly. No Framer/GSAP unless a slice fails. Honor `prefers-reduced-motion`. |
| Bundle | Marketing 3D/demo must not load on Telegram/desktop `skipMarketing`. Phase A atmosphere delta ≤ ~8-45 KB gzip; Phase C chunk ≤ **120 KB** gzip. Fail gate >200 KB without CEO override. No WebGL by default under 768px / saveData / low-memory. |
| Atmosphere split | App shell keeps `PremiumAtmosphere` **subtle**. Landing uses marketing-full stage (wrapper or `MarketingAtmosphere`) so Instant Audit FPS is not taxed. |
| Activation coexistence | Do not block activation. Until Slice A: sample + soft auth for save/share/hosted. After Slice A: rewrite "Account required for live audits" to hosted/save only. |
| Non-destructive | In-place edits + additive components. `CONFIRM_DELETE=false`. No deleting marketing page files without explicit confirmation. |

## Non-goals

- Full cinematic intro re-enable (activation non-goal stays)
- Purple / neon / glow-stack redesign of brand identity
- Invented testimonials, logos, or conversion stats
- Replacing Instant Audit with a marketing-only fake product
- Shipping Three.js on the critical path of the authenticated app shell
- Stripe trial or pricing SKU remap (owned by activation)

## Scorecard (definition of 10/10)

| Axis | 10/10 means |
|------|-------------|
| Non-slop craft | Locked `design.md` + tokens; Workbench rhythm; zero templated 3-equal-feature card hero; Hallmark slop gates pass on landing + shell |
| 3D presence | Visibility Field is readable as product metaphor at rest; pointer/depth present; reduced-motion flat SVG/CSS fallback; not wallpaper |
| Interactive stickiness | User can type a URL (or pick a preset), run demo stages, inspect engine nodes, get ranked "what to fix" with honesty labels, within ~60s without leaving the page |
| Premium impressiveness | Marketing and app share atmosphere, type, CTA voice, hairlines, focus states; app shell feels continuous with landing, not a theme swap |

## Hallmark redesign plan (multi-page)

### Proposed `design.md` (lock in Phase 0)

```markdown
# Design - Luminara Suite

Locked system for marketing + app chrome. Pages share tokens/voice; they vary only
within the macrostructure family below. Do not rotate themes per page.

## Genre
atmospheric (dark AI visibility tool · Night Foundry register)

## Macrostructure family
- Marketing pages: Workbench base
  - Landing: Workbench + Visibility Probe (+ constellation Map/Diagram)
  - Pricing: Catalogue-within-Workbench
  - Why / How / AI: Narrative Workflow or Split Studio variants
- App pages: util Workbench (tool chrome; atmosphere subtle only)
- Content pages (Privacy/Terms): Long Document (no blooms)

## Theme (custom · brand-mapped)
Paper band: dark · Display: classical-serif roman (Instrument Serif) · Accent: warm amber-gold

- --color-paper: oklch(0% 0 0)
- --color-paper-2: oklch(14.5% 0 90)
- --color-paper-3: oklch(18% 0.01 85)
- --color-ink: oklch(95.8% 0 90)
- --color-ink-2: oklch(72% 0.01 85)
- --color-rule: oklch(69.3% 0.114 82.6 / 0.28)
- --color-accent: oklch(69.3% 0.114 82.6)
- --color-accent-2: oklch(96.4% 0.077 102.9)
- --color-accent-3: oklch(60.7% 0.118 76.2)
- --color-focus: oklch(96.4% 0.077 102.9)
- --color-accent-ink: oklch(0% 0 0)

Accent budget: ≤5% of viewport chromatic area. No second accent hue.
Ban on marketing: gradient wordmarks (`.gold-text`); glassmorphism panels; fake browser chrome.

## Typography
- Display: Instrument Serif, weight 400, style normal (never italic headers)
- Body: Outfit 300-500
- Mono: JetBrains Mono 400-500
- Display tracking: -0.02em
- Type scale anchor: --text-display = clamp(2.5rem, 8vw + 1rem, 4.5rem)
- Hero headline: ≤7 words preferred; brand name is hero-level

## Spacing
4-pt named scale in tokens.css. Section break minimum --space-3xl. No card grid in heroes.

## Motion
- Stance: CSS + rAF only (no framer/gsap/three on critical path)
- Easings: --ease-out cubic-bezier(0.16, 1, 0.3, 1); --ease-in-out; --ease-in
- Reveal: fade ≤220ms; reduced-motion → opacity ≤150ms, atmosphere static
- Cap: ≤3 named microinteraction primitives per page
- Hero polish: HP3 cursor-spotlight via PremiumAtmosphere / MarketingAtmosphere

## Microinteractions
- Silent success; hover tooltips 800ms; focus 0ms
- Primary CTA: active press translateY(1px); focus-visible ring instant
- Demo probe: optimistic URL normalize; invalid = inline error (Instant Audit voice)

## CTA voice
- Primary: solid accent fill, black ink, rounded-xl (12px), sentence case
  Pattern: "Audit my site" / "Open the app". Kill ALL-CAPS 9-10px tracking.
- Secondary: hairline accent border, transparent fill
- Tertiary: typographic link (Windows app, MCP, studio)
- One primary CTA per viewport. Nav CTA mirrors page primary.

## Honesty invariant
Never invent SEO/AEO metrics. Use Measured / Not measured / Requires sign-in / Unknown.
```

### Landing section cut list (current → target)

| Keep / transform | Cut or merge |
|------------------|--------------|
| Brand + one line + Probe | Drop third hero CTA (Windows) from fold |
| Replace Sample UI with `VisibilityProbe` | Cut retainer-tax comparison card (or move one line to Why) |
| Optional 2-3 Workbench stage captions | Cut 6-item capability grid; cut 4/BYOK mini-stats |
| Visibility constellation (Map/Diagram) | Cut Suite online logo card; cut provider name strip (keep on Intelligence) |
| Ft5 Produced-by line | Cut full studio 4-card section |
| Final CTA strip (single primary) | Deduplicate repeated Sign in / Audit pairs |
| Footer slim: Privacy · Terms · MCP · Studio | Kill link salad + triple studio credit |

### Ranked punch list (pre-build)

**Critical**
1. Landing lacks atmosphere / visual plane (`LandingPage.tsx`) - mount shared stage background.
2. Hero sample is static labeled Sample UI - replace with interactive demo.
3. Hero CTA clutter (3 buttons) - max 2 in fold.
4. SaaS template rhythm (feature grid + tools strip + about cards) - replace with Workbench + Map/Diagram.

**Major**
5. Atmosphere only on app shell (`App.tsx`) - share primitive with marketing.
6. ALL-CAPS micro CTAs + `.gold-text` / glass on marketing - sentence-case CTAs; solid accent; reduce glass.
7. Fake chrome / static rows read as redrawn UI - prefer live controls over decorative status rows.
8. Marketing pages diverge visually from landing - apply `design.md` + shared chrome.

**Minor**
9. Repeated "Produced by Luminara Digital" - once in fold footnote or footer, not both thrice.
10. Pill / rounded-2xl card density - prefer hairline frames and stage panels.

### File-level plan

**Modify**
- `components/LandingPage.tsx` - structure cut + wire stage/demo/field
- `components/ui/PremiumAtmosphere.tsx` - intensity variants; optional marketing full
- `App.tsx` - mount atmosphere on marketing views; lazy 3D only on landing
- `index.html` (or future `tokens.css`) - OKLCH tokens, motion vars, tracking restraint
- `components/MarketingNav.tsx` - N5 pill behavior if needed
- Marketing siblings lightly: `PricingPage.tsx`, `WhyLuminaraPage.tsx`, `InfrastructurePage.tsx`, `IntelligencePage.tsx` (shared chrome / tokens only in Phase 2)

**Create**
- `design.md` (root) - locked system
- `tokens.css` (OKLCH aliases; import from entry / `index.html`)
- `components/marketing/MarketingStage.tsx` - hero composition host
- `components/marketing/MarketingAtmosphere.tsx` - landing-full atmosphere
- `components/marketing/VisibilityProbe.tsx` - interactive demo + honesty labels
- `components/marketing/MarketingFooter.tsx` - Ft5 shared
- `components/marketing/VisibilityConstellation.tsx` - Phase C (lazy)
- `components/marketing/demo/demoScript.ts`, `demoFixtures.ts`, `useDemoPlayback.ts`
- `docs/plans/premium-craft-surface.md` - this file

**Delete**
- None by default (`CONFIRM_DELETE=false`). Confirm before removing any marketing page file.

## Interactive demo (product narrative)

**Component name:** `VisibilityProbe` (hero Workbench stage). Hosted by `MarketingStage`.

### 60-second script

1. Land: brand + one line + dormant constellation + badge Sample until you run.
2. Type/paste domain (Instant Audit validation spirit); CTA becomes Run quick scout.
3. Analyzing (honest): stage copy only; no fake % climb; engines `pending` then measured/estimated/not_measured.
4. Results: one verdict + one ship action + three engine chips (APS, not a PDF novel). Sample = labeled fixture; Live = BYOK/hosted only when allowed.
5. Soft CTA: Save / Sign in to keep · Open full Instant Audit. Share/MCP only when user asks (Growth truth).

### State machine

```
EMPTY → TYPING_URL → ANALYZING_HONEST
  → RESULTS_SAMPLE | RESULTS_LIVE → CTA_AUTH_SOFT
  → ERROR_RECOVERABLE → TYPING_URL | ANALYZING
```

Modes: `sample` | `live_byok` (Slice A) | `live_hosted` (signed-in). Engine nodes use `VisibilityMeasurementStatus` vocabulary from `services/visibility/engineVisibilityTypes.ts`.

Rules:
- Sample path always available; works with network blocked (fixtures).
- No `/audit/run`, hosted relay, or PSI from unsigned landing.
- Missing data = `not_measured`, never a fake score.
- Empty PSI/GSC stay empty on the demo.
- Errors instruct; do not invent success.

## 3D presence (graphics)

### Phase A (CSS depth)
- Keep `PremiumAtmosphere` for app shell (subtle).
- Add `MarketingAtmosphere` / full intensity for landing only.
- Fix missing drift keyframes (referenced but no-op today) or replace with explicit CSS.
- Wire hero to `MarketingStage` (not a static card).

### Phase B (interactive stickiness)
`VisibilityProbe` + SVG/2.5D constellation data model driven by demo state. Interaction > polygon count. No WebGL required.

### Phase C (true 3D)
Lazy `VisibilityConstellation` (vanilla Three or fragment shader):
- Input: demo engine states only
- Fallback: Phase B SVG/CSS
- Load: dynamic import after idle; pause when offscreen (`IntersectionObserver`)
- Skip: reduced-motion, width <768, saveData, Electron `webglcontextlost` / GPU fallback marker
- Not on Telegram/desktop skip-marketing or app-shell critical path

### Budgets

| Budget | Target |
|--------|--------|
| Phase A atmosphere wiring | ≤ ~8-45 KB gzip delta |
| Phase C 3D/demo chunk | ≤ **120 KB** gzip including any Three; fail >200 KB without CEO override |
| FPS | Desktop ≥55 while visible; mobile ≥30 or CSS path |
| Main thread | No long tasks >50ms from atmosphere rAF |
| a11y | `prefers-reduced-motion` kills tilt/drift/WebGL; focus rings instant |
| Mobile | No WebGL by default <768; touch: no hover-only truths |
| Electron | On context loss → CSS stage; no retry storm |

## Phased vertical slices

### Phase 0 - Lock system (Session craft-0)

**Outcome:** `design.md` + token map + punch list accepted; no visual ship yet beyond tokens if trivial.

**Acceptance:**
- [ ] `design.md` at repo root matches locks above
- [ ] File-level modify/create/delete list confirmed (deletes empty)
- [ ] Activation plan coexistence noted

**Kill:** Brand color rewrite requested → stop; map existing gold/black only.

### Phase 1 - Atmosphere + clutter cut (Session craft-1)

**Outcome:** Landing mounts atmosphere; hero has ≤2 CTAs; dead sections removed/merged; still may keep temporary static stage if demo not ready.

**Files:** `LandingPage.tsx`, `PremiumAtmosphere.tsx`, `App.tsx`, `index.html` tokens

**Acceptance:**
- [ ] Atmosphere visible on landing
- [ ] Fold: brand, one headline, one support line, ≤2 CTAs, stage panel
- [ ] Capability grid ≤3 items or replaced by Workbench captions
- [ ] Reduced-motion: no drift/tilt

**Kill:** Adds Framer/Three in this phase → stop.

### Phase 2 - Interactive Workbench demo (Session craft-2)

**Outcome:** `VisibilityProbe` replaces Sample UI card; stickiness scoreboardable.

**Files:** `VisibilityProbe.tsx`, `MarketingStage.tsx`, `demo/*`, `LandingPage.tsx`, CTA wiring

**Acceptance:**
- [ ] User can complete sample run in ≤60s (offline fixtures OK)
- [ ] Honesty badges + engine enum vocabulary present
- [ ] Zero invented metrics; no fake score fallbacks
- [ ] Soft CTA into Instant Audit; no unsigned hosted spend

**Kill:** Requires production LLM spend for unauthenticated users → stop; keep sample.

### Phase 3 - App premium parity + marketing siblings (Session craft-3)

**Outcome:** App shell + conversion surfaces share tokens/atmosphere voice; marketing siblings reskin to family.

**Files:** `App.tsx` shell, `DashboardView.tsx`, `InstantAuditView.tsx` chrome only; `PricingPage` / `Why` / `Infrastructure` / `Intelligence`; Auth + Paywall glass parity

**Acceptance:**
- [ ] Same accent/type/focus language
- [ ] No marketing marquee inside tools
- [ ] Activation tracker / pricing truth not broken
- [ ] Marketing siblings: subtle atmosphere + shared footer

**Kill:** Redesigns Brand Memory / Mem0 → stop.

### Phase 4 - Visibility constellation 3D (Session craft-4)

**Outcome:** Lazy constellation serving demo state; SVG/CSS fallback remains.

**Files:** `VisibilityConstellation.tsx` (host), `VisibilityConstellationSvg.tsx`, `VisibilityConstellationCanvas.tsx` (dynamic), `constellationCapability.ts`

**Acceptance:**
- [x] Metaphor readable without instruction
- [x] Driven by demo engine states only
- [x] Lazy load + reduced-motion + mobile/Electron fallback verified
- [x] Bundle/FPS budgets met; no R3F (Canvas2D chunk ~2KB gzip; Three not added)

**Kill:** Decorative particles / unrelated scene → stop. Payload >200KB gzip without override → stop.

### Phase 5 - Hallmark gate + deslop (Session craft-5)

**Outcome:** Hallmark audit re-run; deslop pass; marketing siblings aligned enough that system does not drift.

**Acceptance:**
- [ ] Punch list critical/major closed
- [ ] `.agents/skills/deslop` or Hallmark slop gates on landing: pass
- [ ] Scorecard self-grade ≥9/10 on all four axes with evidence notes

## Dependency graph

```
design.md (P0)
    │
    ├── Atmosphere on landing (P1)
    │       │
    │       └── Interactive demo (P2) ──┬── App chrome parity (P3)
    │                                   │
    │                                   └── Visibility Field 2.5D → WebGL (P4)
    │
    └── Activation Slice A (guest audit) ── optional Live demo path (after P2)
```

## Risks

| Risk | Mitigation |
|------|------------|
| 3D becomes decoration | CEO kill; metaphor must bind to demo state |
| Auth wall kills stickiness | Sample demo always works; Live gated honestly |
| Bundle hurts LCP | Dynamic import; skip on skipMarketing |
| Conflicts with activation | Do not rewrite pricing/onboarding; chrome-only in P3 |
| AI slop regression | `design.md` lock; Phase 5 audit |

## Verify commands (per phase)

- `npm run typecheck`
- Targeted vitest if new pure helpers (demo state machine)
- Manual: 375px + desktop landing smoke, reduced-motion OS toggle
- Phase 4: Chrome performance sanity (FPS / network chunk)

### Ship gates (from graphics / perf)

1. Payload: `vite build` size check; `three` absent from main index chunk
2. A11y: reduced-motion freezes motion; keyboard completes demo
3. Honesty: fixtures use `not_measured` / Sample; no unlabeled numeric scores
4. Security: unsigned demo run shows no audit/PSI/oracle hosted calls
5. Perf: ≥55 fps desktop hero 5s; mobile CSS path; no rAF long tasks >50ms
6. Electron: forced WebGL lose → CSS stage usable; no crash-loop
7. Product path: CTA handoff to Instant Audit only when allowed; else auth (until Slice A)

## Out of scope confirmations needed before delete/rebuild

- Deleting any of `PricingPage` / `WhyLuminaraPage` / etc.
- Full marketing site rebuild as separate route tree
- Adding Framer Motion or GSAP as default motion stack
- Adding R3F/drei (rejected for marketing unless CEO override)

## Specialist synthesis (merged 2026-09-23)

| Specialist | Agent | Merged into |
|------------|-------|-------------|
| Surface inventory | [Marketing app surface map](7d784c78-e72b-442b-afcb-e71c4765dcca) | Phase order P0 tokens → P1 landing/shell → P2 siblings/auth/paywall → P3 core product → P4 labs/static HTML; `skipMarketing` gating |
| Product narrative | [AI product demo narrative](bf9a6bf1-5285-476b-a778-c661d7893174) | 60s script, state machine, engine enums, soft auth ladder, Slice A copy rewrite |
| Graphics / perf | [3D and motion budget](76ab526c-5e35-4bf2-ada7-86f29c280ce0) | Constellation metaphor, reject R3F, atmosphere split, budgets, file tree, dead drift keyframes |
| Hallmark redesign | [Hallmark redesign blueprint](adc63b10-a345-43ea-9bdb-e71e1d709ad2) | Workbench + Visibility Probe, N10 + Ft5, section cut list, sentence-case CTAs, punch list |

### Surface phase map (inventory)

1. **P0** - Tokens + `PremiumAtmosphere` API + `MarketingNav`
2. **P1** - Landing full atmosphere + app shell subtle parity
3. **P2** - Marketing siblings + Auth + Paywall
4. **P3** - Dashboard, Instant Audit chrome, Oracle messages, public report edges
5. **P4** - Brand Memory / Vision / Oracle Mind / intro; then `public/desktop`, `public/docs/mcp.html`, `public/privacy.html` CSS-var copy only
