# AEO Moat Implementation Plan

## Goal

Ship production-ready Brand Memory, audit timeline diffs, competitor watchlist,
agency workspaces, scheduled Sentinel jobs, audit query language, wiki-style
`[[competitor]]` links, and a Pro/Agency paywall tier. No Rakazo/Foam/SilverBullet embeds.

## Phases

1. Plan entitlements + types (shared domain limits)
2. Client services: vault, audit history, diff, query, watchlist, agency
3. Wire ingest on audit/chat/DNA into VFS + graph + history
4. Worker: agency plan, domain caps, sentinel schedule, competitor alerts
5. UI: Brand Memory view, paywall Pro tier, dashboard entry, wiki links
6. Tests + sync keys + deploy readiness

## Entitlements

| Plan | Domains | Sentinel | Audit history depth | Agency clients | API |
|------|---------|----------|---------------------|----------------|-----|
| free | 1 | 0 | 5 | 0 | no |
| starter | 2 | 2 | 30 | 0 | no |
| growth | 10 | 10 | 90 | 0 | no |
| agency | 25 | 25 | unlimited | 10 | yes |

## Files

- `services/plans/planEntitlements.ts`
- `services/memory/brandMemoryVaultService.ts`
- `services/audit/auditHistoryService.ts`
- `services/audit/auditDiffService.ts`
- `services/audit/auditQueryService.ts`
- `services/audit/wikiLinkService.ts`
- `services/competitors/competitorWatchlistService.ts`
- `services/workspace/agencyWorkspaceService.ts`
- `components/suite/BrandMemoryView.tsx`
- Worker: `telegramBot.ts`, `tonPayment.ts`, `index.ts` sentinel caps
- `components/paywall/PaywallModal.tsx`
- Tests under `tests/`

## Done when

- [x] Agency plan purchasable (Stars + TON)
- [x] Domain limits enforced on Sentinel register
- [x] Audits append to history and Brand Memory Vault
- [x] Diff + query + wiki links work
- [x] Agency clients isolate DNA + history
- [x] Tests pass; no em dashes in new copy
- [x] `npm run typecheck` + `npm run build` green

Verified: 2026-09-10 local typecheck, vitest moat suites, production Vite build.
