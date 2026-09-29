# Virality Activation Loops (VAL)

**Date:** 2026-09-27  
**Status:** Planned (ready to implement)  
**Owner:** Product + full-stack  
**Companions:** [`user-activation-first-value.md`](./user-activation-first-value.md), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), [`go-live-open-items.md`](./go-live-open-items.md)

## Overview

Deepen two activation loops that create word-of-mouth without building a broad "ecosystem program" (marketplace, forum, partner directory). Backend for share and MCP keys is largely shipped. Gaps that kill virality sit at the edges: share pages lack crawler OG / soft CTA, password unlock is broken in production, and MCP mint is buried in Settings with no Cursor snippet and no post-save one-click path.

**North-star:** % of new users who complete one Instant Audit and either save a report/project **or** mint+test an MCP key within 24h.

**Packaging truth (do not regress):** Free = insight. Paid = sync, share, MCP, research. Growth = `shareLinks` + `mcpAccess`. Agency adds `apiAccess`.

## Product locks

| Lock | Decision |
|------|----------|
| Scope | Two loops only: (A) shareable audit artifacts, (B) Growth MCP mint after first save |
| Ecosystem | No marketplace, community forum, partner directory, or multi-audience "ecosystem" brand site |
| Entitlements | Keep Growth+ for share mint and MCP keys; guests may open shared URLs |
| Migrations | None expected (`shared_reports`, `api_keys` already from `0005` / `0009`) |
| Keys | Reuse `POST /api/api-keys` (`lm_live_*`). No new key store. OAuth `mcp_*` stays additive |
| OG | Text OG + soft CTA first. No R2 dynamic image pipeline in this wave |
| Deploy | Staging smoke before prod. Explicit operator approval for prod Worker deploy |

## Engineering loop (how we ship)

Multi-agent review already ran for this plan (CEO ship order, share/audit explore, MCP mint explore). Execution uses the same loop per session:

1. **Plan** - this doc; one vertical slice + acceptance
2. **Build** - one slice only; edit over create
3. **Verify** - targeted vitest + staging smoke
4. **Polish** - copy/empty states only if smoke fails clarity
5. **Gate** - kill criteria; do not start next session until gate passes

Do not arm a timer loop for idle planning. Re-run the loop only when implementing or when a slice fails verify.

Specialized roles per session (can be subagents or humans):

| Role | Owns |
|------|------|
| CEO / product | Ship order, kill criteria, packaging truth |
| Full-stack | Worker + React vertical slice |
| AI/ML product | Honest metrics copy; never invent SEO numbers in OG or CTAs |
| Deploy | Staging smoke, env check, rollback path |

## Shipped vs missing (ground truth)

### Loop A: Shareable Instant Audit artifacts

| Layer | Status | Notes |
|-------|--------|-------|
| `shareLinks` entitlement | Shipped | Growth / Agency in `planEntitlements.ts` |
| D1 `shared_reports` | Shipped | Migration `0005` |
| POST/GET/DELETE share API | Shipped | `worker/shareService.ts` |
| Create UX | Shipped | `ReportDisplay.tsx` "Copy share link" (after ship gate) |
| Public SPA `/share/:token` | Shipped | `SharedReportView.tsx` |
| Password server | Shipped | Header `x-share-password`; prod rejects `?password=` |
| Password client | **Bug** | `shareReportClient.ts` still appends `?password=` |
| Per-report OG / crawler HTML | **Missing** | Marketing shell only; crawlers see generic Suite meta |
| Soft CTA on shared page | **Missing** | Unlock + report only; no Instant Audit / Growth CTA |
| Post-audit share as primary next step | Weak | Toolbar button among PDF/evidence |

### Loop B: Growth MCP mint after first save

| Layer | Status | Notes |
|-------|--------|-------|
| `mcpAccess` + `/api/api-keys` | Shipped | Growth gate; `lm_live_*` once |
| Settings mint UX | Shipped | `ApiKeysTab.tsx` (MCP keys tab), not Overview |
| Bearer on `/api/mcp` | Shipped | `resolveMcpUser` |
| Cursor `mcpServers` snippet copy | **Missing** | Reveal copies raw key only |
| Post-`strategy_saved` mint CTA | **Missing** | Persist hint text only in `InstantAuditView` |
| Overview mint (`McpUsageStrip`) | **Missing** | Catalogue + upgrade only |
| Docs Settings-first | **Missing** | `mcp.html` / plugin README still teach `POST /api/api-keys` |

## Architecture (target)

```
Instant Audit (guest BYOK or signed-in)
        │
        ▼
 Report + optional strategy_saved (auth)
        │
        ├── Growth: Share CTA ──► POST /api/share/reports
        │                              │
        │                              ▼
        │                     /share/:token
        │                     Worker injects OG for bots
        │                     SPA + soft CTA for humans
        │
        └── Growth: Mint CTA ──► POST /api/api-keys
                                       │
                                       ▼
                              Reveal once + Cursor snippet
                              → Cursor / Claude / Codex → /api/mcp
```

## Vertical slices (CEO ship order)

```
Session 1 (share OG + password fix + CTA) ──► Session 4 (post-audit share CTA)
Session 2 (post-save MCP mint + snippet) ──► Session 3 (Overview + docs)
Session 5 (tracker + pricing crawler truth) can parallel after 1-2
```

**Must-ship for the locked product decision:** Sessions 1 and 2.  
**Polish:** Sessions 3-5.

---

### Session 1: Share preview + password fix + soft conversion

**Outcome:** Pasting a Growth share URL into Slack / X / LinkedIn shows domain-aware OG. Passworded shares unlock in the SPA. Public viewers see a soft CTA into Instant Audit.

**Files likely touched:**
- `worker/shareService.ts` (or sibling helper) - `buildShareOgMeta(report)`
- `worker/marketingShell.ts` and/or `worker/index.ts` - HTML injection for `/share/:token` bot/Accept paths
- `services/share/shareReportClient.ts` - password via `x-share-password`, not query
- `components/audit/SharedReportView.tsx` - soft CTA footer
- `tests/shareReports.test.ts` (+ marketing route test if needed)

**Acceptance:**
- [ ] Unauthenticated HTML GET (or bot UA) for `/share/{token}` returns `og:title` / `og:description` / `og:url` with domain (or safe fallback); no secrets in meta
- [ ] Passworded shares do not leak report body into OG (generic protected copy)
- [ ] Client unlock uses `x-share-password`; production unlock works
- [ ] Shared page soft CTA: Run Instant Audit + Pricing/Growth; no fake free trial
- [ ] Existing create / copy / revoke still green; Free POST still 403 `SHARE_ENTITLEMENT_REQUIRED`
- [ ] Public HTML path shares or extends `share_public_get` rate limits

**Kill:** Needs R2 image pipeline, new share URL scheme, or password bypass for crawlers → stop; ship text OG + CTA + password header fix only.

**Deploy / smoke (staging then prod):**
1. Growth create share → `curl -A Twitterbot https://<host>/share/<token>` → OG tags present
2. Browser open share → CTA → Instant Audit
3. Passworded share unlocks with header path
4. Free plan create still 403
5. `npm run typecheck && npm run lint && npm test && npm run build`
6. `npm run smoke-check` against staging

**Rollback:** Redeploy prior Worker + assets. No schema change. Revoke bad shares via DELETE.

---

### Session 2: Post-save MCP mint + Cursor snippet

**Outcome:** After first successful `strategy_saved`, Growth user gets one-click mint: reveal `lm_live_*` once + copy Cursor `mcpServers` snippet. Free/Starter see Growth upgrade. Unsigned see sign-in.

**Files likely touched:**
- `components/audit/InstantAuditView.tsx` - post-save panel
- Extract/reuse from `components/settings/tabs/ApiKeysTab.tsx` + `apiKeysTabUtils.ts` into a small shared module
- Snippet builder (unit-tested): production `/api/mcp` + Bearer key
- `productTelemetry` events: `mcp_key_created` / `mcp_snippet_copied` if missing
- Tests: snippet builder unit; extend revoke → `/api/mcp` 401 if thin today

**Acceptance:**
- [ ] Growth + signed-in + first save: mint CTA; create → full key once → Copy key + Copy Cursor snippet
- [ ] Snippet targets production `/api/mcp` with the new key filled
- [ ] Free/Starter: upgrade copy, no secret mint
- [ ] Unsigned: sign-in CTA (same posture as save today)
- [ ] Secret never written to localStorage / list rows
- [ ] Revoke → Bearer fails on `/api/mcp` (route or APS test)

**Kill:** New key store, OAuth-only path, or plugin packaging → stop; reuse `/api/api-keys` only.

**Deploy / smoke:**
1. Growth: Instant Audit → save → mint → paste into Cursor → `whoami` / `list_projects`
2. Free: mint blocked with Growth message
3. Revoke key → Bearer fails on `/api/mcp`
4. No new env vars required for API-key path

**Rollback:** UI/Worker redeploy. Revoke keys via DELETE `/api/api-keys/:id`.

---

### Session 3: Overview mint + docs match UI

**Outcome:** Settings Overview is enough to mint without hunting the API Keys tab. Docs stop teaching raw POST for non-engineers.

**Files likely touched:**
- `components/settings/McpUsageStrip.tsx`
- `components/settings/tabs/ApiKeyOverviewTab.tsx`
- `public/docs/mcp.html`
- `plugins/luminara/README.md` (and add or fix `mcp.json` claim)

**Acceptance:**
- [ ] Growth Overview: Create key + snippet (or deep-link into same reveal UX)
- [ ] `mcp.html` primary path: Settings UI; curl/POST as advanced only
- [ ] Plugin README Settings-first; config snippet accurate
- [ ] Free strip keeps MCP_ACCESS upgrade copy

**Kill:** Redesigning all Settings tabs → stop; Overview strip + docs only.

**Deploy / smoke:** Growth mint from Overview; open `/docs/mcp.html` and confirm UI-first wording.

---

### Session 4: Post-audit share affordance

**Outcome:** After Instant Audit completes, share is an explicit next action for Growth (paywall tease for Free), not only a toolbar icon after ship gate.

**Files likely touched:**
- `components/audit/InstantAuditView.tsx`
- `components/audit/ReportDisplay.tsx` (action hierarchy only)
- Telemetry: `share_link_created` / `share_cta_clicked` if missing

**Acceptance:**
- [ ] Post-report primary actions ordered: Save (if needed) → Share (Growth) / Unlock share (paywall) → optional MCP (if Session 2 shipped)
- [ ] Free soft-gate copy matches APS: insight free; share paid
- [ ] No new share API

**Kill:** Share history manager or Agency white-label editor → cut; one CTA + existing create.

**Deploy / smoke:** Growth copy-link from Instant Audit; Free opens paywall; public URL loads.

---

### Session 5: Tracker truth + marketing pricing meta

**Outcome:** Dashboard L3 reflects real `strategy_saved`. Public `/pricing` crawler copy matches Growth-hero product truth.

**Files likely touched:**
- `components/suite/DashboardView.tsx`
- `services/analytics/productTelemetry.ts` if needed
- `services/marketing/pageMeta.ts` `/pricing`
- `tests/productTelemetry.test.ts`

**Acceptance:**
- [ ] Step 3 completes on strategy save, not "any chat + DNA"
- [ ] Brand Memory remains a door, not step 3
- [ ] Marketing shell pricing no longer implies Starter is the hero MCP plan

**Kill:** Mem0 / Brand Memory redesign → stop.

**Deploy / smoke:** Fresh path Audit → DNA → save flips tracker 3/3; `curl` marketing `/pricing` HTML mentions Growth MCP/share.

## Production readiness checklist

| Area | Requirement |
|------|-------------|
| Migrations | Confirm staging/prod already have `0005` + `0009` (api key prefix). No new migrations in this wave |
| Env | No new secrets for share OG or `lm_live_*` mint. `WEBAPP_URL` host must match the origin users paste (apex vs www) |
| Entitlements | Single source `planEntitlements.ts`; Worker `planCapsFor` / Pricing / Paywall / Telegram stay aligned |
| Feature flags | None for share/MCP mint. Do not couple to Oracle/audit queue flags |
| CI | `npm run typecheck`, `lint`, `test`, `test:coverage`, `build` green before merge |
| Smoke | Session 1-2 need manual/scripted OG + MCP whoami on staging before prod |
| Security | OG short (domain + soft verdict); never keys/PII; password shares generic OG; rate-limit HTML OG path |
| Rollback | Prior Worker version + static redeploy. Revoke keys/shares via existing DELETE |

## Metrics (instrument in Sessions 2/4)

| Event | Why |
|-------|-----|
| Existing `time_to_first_value` / audit complete | Funnel top |
| `strategy_saved` | L3 activation |
| `share_link_created` / public share opens | Loop A |
| Soft CTA click → Instant Audit or auth | Share→signup |
| `mcp_key_created` / `mcp_snippet_copied` | Loop B |
| MCP `whoami` within 24h of mint | Connect success |

## Explicit NON-GOALS

- Marketplace, partner directory, community forum, "ecosystem program"
- Team seats / invite UI, Mem0 / Brand Memory redesign
- Full projects CRUD, help center, coachmark library
- Cinematic intro, Stripe self-serve free trial
- GSC OAuth depth, Vectorize, live PSI defaults as activation work
- Telegram ↔ web entitlement continuity rebuild
- MCP OAuth UI / multi-provider OAuth clients as a blocker
- New D1 tables for shares or keys
- Guest free share mint (would undercut Growth packaging)
- Dynamic OG image CDN / R2 pipeline

## Relation to user-activation-first-value

`user-activation-first-value.md` overview status is stale relative to code (mint UI and share APIs exist). Treat that doc as the earlier activation framing. This VAL plan is the authoritative ship order for the two virality loops. When Sessions land, update Slice C checkboxes and the activation doc status to match reality.

## Session map

| Session | Ships | Verify before next |
|---------|-------|--------------------|
| 1 | Share OG + password header fix + soft CTA | Bot UA shows OG; password unlock works; Free 403 |
| 2 | Post-save mint + Cursor snippet | Growth whoami works; Free blocked; revoke fails Bearer |
| 3 | Overview mint + docs | Settings-first docs; Overview create |
| 4 | Post-audit share CTA | Growth share from win moment; Free paywall |
| 5 | Tracker + pricing meta | L3 = strategy_saved; crawler pricing truth |

## Risks

| Risk | Mitigation |
|------|------------|
| OG leaks report body | Short domain + soft verdict only; password → generic |
| Host mismatch apex vs www | Align `WEBAPP_URL` with paste origin before staging smoke |
| Key shown once then lost | Confirm copy UX; never persist secret client-side |
| Scope creep into ecosystem | Kill criteria above; CEO gate between sessions |
| Password query still used | Session 1 must ship header fix with OG |

## Exit criteria (wave complete)

1. Growth share URL unfurls with domain-aware OG on at least one major crawler UA.
2. Passworded shares unlock in production SPA.
3. Shared page has Instant Audit soft CTA without fake free trial.
4. After first strategy save, Growth user can mint + copy Cursor snippet without hunting Settings tabs.
5. Docs primary path is Settings UI, not raw POST.
6. CI gates green; staging smoke recorded; prod deploy only with operator approval.
