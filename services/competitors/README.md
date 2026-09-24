# Competitors (watchlist + share-of-voice)

## What this does

Competitor watchlist and citation-alert tracking per brand domain. Front-end
service at `services/competitors/competitorWatchlistService.ts`; related SoV
math lives in `services/visibility/shareOfVoiceService.ts` and traffic
insights in `services/analytics/trafficInsightsService.ts`. Alerts surface
in-app; Telegram delivery goes through the Worker Sentinel keywords.

## Invariants

1. **Watchlist is plan-gated.** `addCompetitor` enforces
   `entitlementsFor(planId).competitorWatchLimit`; over-limit returns
   `{ error }`, never throws.
2. **Storage is localStorage-first with in-memory fallback.** Keys
   `luminara_competitor_watchlist_v1` / `luminara_competitor_alerts_v1`;
   `canLS()` probes before every read/write and falls back to module-memory
   arrays (`watchMemory` / `alertMemory`). Parse failures degrade to memory,
   never throw.
3. **Domains are normalized once.** Protocol, `www.`, port, and path are
   stripped; lowercased. The same `brandDomain`+name (case-insensitive) is
   deduped on add.
4. **Citation deltas are measured from audit history, not estimates.**
   `evaluateCitationDeltas` compares the latest two audits for a domain via
   `listAudits` and mints a `gained`/`lost` alert only when membership in
   `competitorsMentioned` actually changed. With < 2 audits it returns `[]`.
5. **Alerts are bounded.** `saveAlerts` keeps the last 100 entries
   (`slice(-100)`).
6. **Sentinel keywords are capped.** `sentinelKeywordsFor` builds at most 10
   queries: brand base + `vs`/alternative per watched competitor (max 6).

## Stubbed vs live status today

| Data source | Status | Evidence |
| --- | --- | --- |
| Watchlist CRUD + alerts (localStorage) | Live | `competitorWatchlistService.ts` |
| Citation delta detection | Live, uses measured audit history | `evaluateCitationDeltas` -> `listAudits` |
| Share of Voice | Live from empirical citation probes; `method: 'observed'` in every summary | `shareOfVoiceService.ts`, `tests/shareOfVoice.test.ts` |
| Traffic insights (umami sidecar) | Conditional: returns `not_configured` when no sidecar is reachable, `no_website` when the domain is untracked, `ready` only with real stats | `trafficInsightsService.ts:13,237`, `tests/trafficInsights.test.ts` |
| Telegram delivery of competitor alerts | Worker Sentinel path; unverified end-to-end in this README | `sentinel` Worker route |

## Env vars

Read (front-end): none directly; the umami traffic path goes through the
sidecar/proxy. Worker side depends on `BOT_TOKEN` (Sentinel Telegram alerts)
and `SIDE_*` sidecar config for traffic stats.

## Key tests

- `tests/shareOfVoice.test.ts`: mention/citation coverage, slice sum within
  rounding of 100, `method === 'observed'`.
- `tests/trafficInsights.test.ts`: `not_configured` path, `no_website`
  path, current+previous window aggregation, referrer classification.
