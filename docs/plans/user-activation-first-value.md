# User Activation: First Value Wave

**Date:** 2026-09-22  
**Status:** Planned (not started)  
**Owner:** Product + full-stack (activation)  
**Companion:** APS [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), checklist [`tasks/todo.md`](../../tasks/todo.md)

## Overview

Close the gap between a working agent platform and a user who can get value. Backend MCP, Instant Audit, and entitlements already exist. Users still hit auth walls, a Settings key dump, Starter-first pricing, and no UI to mint `lm_live_*` keys.

**North-star:** % of new users who complete one Instant Audit and either save a report/project or mint+test an MCP key within 24h.

## Engineering loop (how we ship)

Multi-agent review already ran (CEO ship order, frontend first-value, MCP keys, pricing truth, game-loop L1-L3). Execution uses the same loop per session:

1. **Plan** - vertical slice + acceptance criteria (this doc)
2. **Build** - one slice only; edit over create
3. **Verify** - session smoke path + targeted tests
4. **Polish** - copy/empty states only if smoke fails user clarity
5. **Gate** - CEO kill criteria; do not start next session until gate passes

Do not arm a timer loop for idle planning. Re-run the loop only when implementing or when a slice fails verify.

## Decision locks

| Lock | Decision |
|------|----------|
| Guest aha | Instant Audit is public. Hosted Worker LLM / paid relay / hosted PSI require auth. Guest runs on client BYOK (or existing local path) only. |
| Settings | Never auto-open BYOK dump as first-run. Open only on explicit key need or post-audit CTA. |
| Onboarding steps | 1 Audit → 2 Business profile → 3 Save strategy to project (not Brand Memory). |
| Pricing | Hero sells **Growth** for MCP + share. Starter = web-audit tier only. |
| Empty PSI/GSC | Honesty copy in Session 1; no new measurement work. |
| Auth at value | Soft-gate auth on save / share / MCP / sync / hosted spend. Aligns with APS: paywall on execution, not first insight. |

## Non-goals (this wave)

- Cinematic intro re-enable
- Team seats / invite UI
- Mem0 / Brand Memory redesign
- Full help center or coachmark library
- Telegram ↔ web entitlement continuity rebuild
- Full projects CRUD surface (beyond save CTA + persist hint)
- Live PSI/GSC depth, Vectorize, GSC OAuth
- Stripe free-trial product (license keys remain the only promo path)

## First-session game loop (L1-L3)

| Level | Win | Feedback | Fail | Next |
|-------|-----|----------|------|------|
| L1 Scout | Instant Audit report + one ship action | Mode badge Quick scout; tracker 1/3 | URL/provider error; never invent metrics | Soft CTA: set Business DNA for Full audit |
| L2 DNA | Profile saved; optional Full audit | DNA pill Linked; badge Full audit; tracker 2/3 | Skip allowed; DNA stays if re-run fails | CTA: Save strategy to project |
| L3 Save | `strategy_saved` / project for domain | Persist hint; tracker 3/3 dismisses | Unsigned → sign-in CTA; report still readable | Optional Growth MCP mint (bonus, not required for Free) |

Brand Memory remains a home door for return visits, not the L3 win condition.

## Entitlement truth (Pricing / Paywall must match)

| Capability | Free | Starter | Growth | Agency |
|------------|------|---------|--------|--------|
| shareLinks | no | no | yes | yes |
| mcpAccess | no | no | yes | yes |
| apiAccess | no | no | no | yes |
| teamSeats | 1 | 1 | 3 | 10 |

Research: Growth MCP + DataForSEO BYOK; Agency hosted metered. Domain/Sentinel/schedule caps stay in `planEntitlements.ts`.

## Vertical slices

### Slice B - Sell Growth truth (Session 1)

**Outcome:** Pricing and Paywall name Growth as MCP/share plan; kill fake free trial CTA.

**Files:** `components/PricingPage.tsx`, `components/paywall/PaywallModal.tsx`, light `LandingPage.tsx` / `worker/telegramBot.ts` plan blurbs if needed.

**Acceptance:**
- [ ] No mcpAccess / shareLinks claims on Free or Starter
- [ ] Growth bullets include MCP + share + 3 seats
- [ ] Agency includes apiAccess + 10 seats + clients
- [ ] Zero "Start free trial" unless a real self-serve trial ships
- [ ] Price language prefers Stars/TON (or USD labeled non-checkout)

**Kill:** Tier rename or Stripe SKU remap required → stop; hero + bullets only.

### Slice D - First-run path + honesty (Session 1)

**Outcome:** Dashboard tracker matches L1-L3; Settings not first door; PSI/GSC empty copy reads optional/not measured.

**Files:** `components/suite/DashboardView.tsx`, `App.tsx` (no Settings auto-open when ready / when guest), `PageSpeedPanel.tsx`, GSC empty copy, `AuthRequiredScreen` only if still shown for other views.

**Acceptance:**
- [ ] Tracker: Audit → profile → Save to project; Brand Memory not step 3
- [ ] Zero-audit home: one primary Audit CTA (not 3-column incomplete checklist)
- [ ] Settings does not auto-open for first paint when user can already run scout (BYOK or, when signed in, hosted-ready)
- [ ] PSI/GSC empty states say not measured / not connected, not "broken"

**Kill:** Touches Mem0 / multi-step wizard → stop; copy + CTA order only.

### Slice A - Guest Instant Audit (Session 2)

**Outcome:** Paste URL → scout without Firebase when using client BYOK; auth for hosted spend and save.

**Files:** `App.tsx`, `services/auth/useAppAuth.ts` (`PUBLIC_APP_VIEWS` + Instant Audit), `AuthRequiredScreen` / gate paths, `InstantAuditView.tsx` (post-audit auth CTA for save).

**Acceptance:**
- [x] Guest can open Instant Audit and run scout with local/BYOK LLM
- [x] Hosted Worker LLM / paid relay / hosted PSI refuse without auth (instructive error)
- [x] Save strategy / share / MCP prompt sign-in
- [x] No new Worker billing model

**Kill:** Needs new auth model, new billing path, or >1 session entitlement surgery → cut to soft-gate after first verdict screen only.

### Slice C - MCP connect loop (Session 3)

**Outcome:** Growth+ mints `lm_live_*` in Settings Overview, copies Cursor snippet; docs match UI.

**Files:** `components/settings/McpUsageStrip.tsx` (or sibling under Overview), optional `services/apiClient.ts` wrappers, `public/docs/mcp.html`, `plugins/luminara/README.md`, `tests/apsMcp.test.ts` (+ optional `tests/apiKeys.test.ts`).

**API (reuse):** GET/POST/DELETE `/api/api-keys` already Growth-gated. Full secret only on create; list shows `prefix` only.

**Acceptance:**
- [ ] Growth user: create named key, see once, Copy, list prefix-only after dismiss
- [ ] Revoke → Bearer fails on `/api/mcp`
- [ ] Free/Starter: no create; clear Growth upgrade copy
- [ ] `mcp.html` never tells non-engineers to `POST /api/api-keys`
- [ ] Route tests cover create/list/revoke + free 403

**Kill:** New key store, OAuth-only MCP, or plugin packaging → stop; mint + paste + docs only.

## Session map

| Session | Ships | Verify before next |
|---------|-------|--------------------|
| 1 | Slice B + Slice D | Pricing never claims MCP on Starter; tracker remapped; no Settings dump as aha |
| 2 | Slice A | Guest scout with BYOK; hosted spend needs auth; save prompts sign-in |
| 3 | Slice C | Growth mint works; Free 403; docs match Settings |

## Architecture notes

```
Guest / signed-in browser
        │
        ▼
 Instant Audit (scout) ──BYOK──► local/provider keys
        │                 └──hosted──► auth required
        ▼
 DNA (optional) → Full audit
        ▼
 Save to project (auth) ──► D1 projects / strategy
        ▼
 Growth: Settings mint lm_live_* ──► Cursor /api/mcp
```

No new D1 migrations expected. Prefer existing glass/gold patterns; no coachmark library; no new card grids on home.

## Risks

| Risk | Mitigation |
|------|------------|
| Guest abuse of hosted LLM | Hard auth on hosted path; guest = BYOK only |
| Key shown once then lost | Confirm copy UX; never persist secret client-side |
| Pricing USD vs Stars/TON confusion | Prefer Stars/TON language; USD only if labeled illustrative |
| Tracker telemetry id rename | Update `productTelemetry` step ids carefully; keep tests green |

## Out of wave (next)

Projects list UI, report deep-link return-to-URL after auth, Telegram/web plan continuity, team invites, help center, measurement depth (GSC OAuth, PSI hosted defaults).
