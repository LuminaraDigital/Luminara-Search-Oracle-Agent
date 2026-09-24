# User Activation + Premium Craft + APS checklist

Source of truth (craft): [`docs/plans/premium-craft-surface.md`](../docs/plans/premium-craft-surface.md)  
Source of truth (activation): [`docs/plans/user-activation-first-value.md`](../docs/plans/user-activation-first-value.md)  
Source of truth (product): [`docs/plans/agent-mcp-product-surface.md`](../docs/plans/agent-mcp-product-surface.md)  
Execution bridge: [`tasks/plan.md`](./plan.md)

## Premium Craft Surface (C0-C5) - shipped (MVP + U2 + C4 Canvas)

### Session craft-0 - Lock system

- [x] C0: Write root `design.md` (Workbench + Map/Diagram family, gold/black OKLCH, sentence-case CTA voice, N10 + Ft5)
- [x] C0: Confirm file modify/create list; `CONFIRM_DELETE=false`
- [x] Checkpoint C0: CEO accepts locks; activation coexistence noted

### Session craft-1 - Atmosphere + clutter cut

- [x] C1: `MarketingAtmosphere` / full intensity on landing; shell stays subtle
- [x] C1: Drift keyframes verified in `index.html`
- [x] C1: Hero fold ≤2 CTAs (Audit + Pricing); Windows → footer; section cuts per plan
- [x] C1: MarketingNav N10 scroll-morph + slim rail (Pricing · Why · How)
- [x] Checkpoint C1: reduced-motion OK; no Three/Framer/R3F added

### Session craft-2 - Interactive Visibility Probe

- [x] C2: Add `MarketingStage` + `VisibilityProbe` + `demo/*` fixtures
- [x] C2: Sample path offline; engine enums; honesty badges; ≤60s
- [x] C2: Soft CTA into Instant Audit; no unsigned hosted spend
- [x] Checkpoint C2: zero invented metrics; no fake score fallbacks

### Session craft-3 - App premium parity + siblings

- [x] C3: Marketing siblings mount `PremiumAtmosphere` subtle (Pricing/Why/Infrastructure/Intelligence)
- [ ] C3: Dashboard + Instant Audit chrome deep parity (optional polish; tokens already shared)
- [x] Checkpoint C3: pricing entitlement copy untouched; activation truth intact

### Session craft-4 - Visibility constellation 3D

- [x] C4: SVG/2.5D constellation driven by demo state
- [x] C4: Lazy Canvas2D parallax constellation (Three skipped: payload vs 120KB gzip budget)
- [x] C4: No Three added; canvas chunk stays off main index; SVG default fallback
- [x] Checkpoint C4: product-serving only (CEO kill on decoration)

### Session craft-5 - Hallmark gate

- [x] C5: Typecheck + `tests/visibilityProbe.test.ts` green + `npm run build` green
- [x] C5: Landing MVP punch list closed (atmosphere, probe, clutter, N10, Ft5)
- [x] Checkpoint C5: operator path complete - staging + production deploy + smoke green (2026-09-23)

## User Activation (U0-U3) - active

### Session 1 - Pricing + first-run path

- [x] U0: PricingPage four-tier (or Free footnote + 3 paid) aligned to `planEntitlements`; kill "Start free trial"
- [x] U0: PaywallModal bullets include mcpAccess / shareLinks / teamSeats / apiAccess truth
- [ ] U1: Dashboard tracker = Audit → Business profile → Save to project (not Brand Memory)
- [ ] U1: Zero-audit home = one primary Audit CTA strip
- [ ] U1: Stop Settings auto-open as first-run when scout is already runnable
- [ ] U1: PSI/GSC empty-state honesty copy (not measured / not connected)
- [ ] Checkpoint S1: smoke Pricing claims; smoke Dashboard CTA; no Settings dump on first paint

### Session 2 - Guest Instant Audit

- [x] U2: Add Instant Audit to public product path (`PUBLIC_APP_VIEWS` / gate) for guest scout
- [x] U2: Hosted Worker LLM / paid relay / hosted PSI require auth (instructive errors)
- [x] U2: Post-audit save / share / MCP soft-gate auth
- [x] Checkpoint S2: guest BYOK scout works; hosted without auth fails clearly; save prompts sign-in
- [x] Hotfix: `/#instant_audit` cold-load prefers product hash over marketing `/` (`resolveAppView`; staging `abef118b…` + prod `3dd2bbfa…` 2026-09-23)

### Session 3 - MCP connect loop

- [ ] U3: Settings Overview MCP key create / one-time reveal / list prefix / revoke
- [ ] U3: Route tests GET/POST/DELETE `/api/api-keys` (Growth vs Free)
- [ ] U3: Rewrite `public/docs/mcp.html` + plugin README (Settings, not REST create)
- [ ] Checkpoint S3: Growth mint → Cursor Bearer whoami; Free 403; docs match UI

## APS A0-A8 (complete)

- [x] A0-A3, A5-A6, A7 credit sentences, A8 strategy seed
- [x] A4 Live DataForSEO via shared registry (Phase 1)
- [x] A7 Settings MCP usage UI strip
- [x] Staging remote D1 migrate `0006` + `0007`
- [x] OAuth 2.1 + PKCE (minimal; API keys remain)
- [x] Operator approved production deploy + remote D1 migrate `0006`/`0007` (G0)

## AI Functions phases (complete)

- [x] P0-P6 / G0-G4 as previously shipped (see git history / go-live plan)

## Deferred (next wave)

- [ ] Projects list / context editor UI
- [ ] Agent report deep-link return after auth
- [ ] Telegram ↔ web plan continuity UX
- [ ] Team seats invite UI
- [ ] In-app help / setup center
- [ ] GSC OAuth + deeper PSI defaults
