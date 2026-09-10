# Telegram Mini App Login: Production Implementation Plan

**Goal:** Make Luminara Suite Mini App sign-in reliable, secure, and deployment-ready under Cloudflare Workers + Telegram WebView constraints.

**Date:** 2026-09-10  
**Scope:** Client TMA boot/auth race, app auth gate, Worker `POST /api/telegram/auth`, regression tests, production deploy.

**Emotional theme / product constraint:** Instant trust. Opening the Mini App must feel native (no web Google popups inside Telegram), with a short verify loader then product tools.

## Requirements checklist

1. Root-cause fix for Mini App login stall / false "not signed in" after `/start`
2. Industry-grade TMA readiness contract (`whenTelegramReady`, settle poll, native initData fallback)
3. Auth gate waits for readiness; no one-shot race with background `initTelegram()`
4. Correct UI inside TMA (Telegram path) vs web (Firebase path); no popup Google flow in WebView
5. Server remains source of truth: HMAC `initData` validation; invalid signatures never unlock product
6. Soft resilience: transient network errors with present `initData` do not brick the shell; Worker still enforces per API call
7. Operator UX: loading state + Retry on hard failures
8. Regression tests for ready/settle/auth decision matrix
9. Typecheck + targeted vitest + production build
10. Deploy Worker + SPA assets to Cloudflare (`luminara-search-oracle-agent` / luminarasuite.com)

## Problem statement (root cause)

Boot mounts React immediately for web performance. `initTelegram()` runs in the background. `useAppAuth` previously read `initData` on first effect before SDK `restore()`, got empty string, permanently set `tgOk=false`, and showed the login wall with no retry. Cloudflare health showed `telegram: true`; many failed opens never reached `/api/telegram/auth`.

## Architecture (target)

```
index.tsx
  ├─ mount <App/> (non-blocking for web TTI)
  └─ initTelegram() + loadServerHealth()  [background]

tma.ts
  ├─ detectTelegramSync()
  ├─ initTelegram() → finishReady(boolean)
  ├─ whenTelegramReady() → Promise<boolean>
  ├─ waitForInitDataRaw() → settle poll (SDK + native bridge)
  └─ getInitDataRaw() → SDK raw || Telegram.WebApp.initData

useAppAuth()
  ├─ await whenTelegramReady()
  ├─ await waitForInitDataRaw()
  ├─ POST /api/telegram/auth
  └─ decision matrix → authenticated | blocked + retry

Worker
  └─ validateInitData(HMAC-SHA256) → 200 session | 401 reason | 503 missing BOT_TOKEN
```

## Security model (unchanged, must not regress)

| Layer | Rule |
|-------|------|
| Client | Never trust `initData` fields for authorization of hosted AI |
| Transport | Send raw `initData` / `x-telegram-init-data` only over HTTPS |
| Worker | HMAC with `BOT_TOKEN` + `WebAppData` secret; TTL on `auth_date` |
| Paywalls | Stars / TON / Stripe entitlements keyed by validated identity / account link |
| Web | Firebase ID token verification when not in TMA |
| TMA | No OAuth popups (WebView breaks them); Telegram is primary identity |

## Phase map

| Phase | Work | Exit criteria | Status |
|-------|------|---------------|--------|
| P0 Diagnose | Confirm race; probe `/api/health` + auth 401 on bad payload | Root cause named | Done |
| P1 Ready contract | `readySettled`, `whenTelegramReady`, `subscribeTelegramReady`, native fallback | No early resolve before `finishReady` | Done (in tree) |
| P2 Auth hook | Wait for ready; retry; TMA vs Firebase UI | Gate never fails before init settles | Done (in tree) |
| P3 App shell | Subscribe ready; remap LANDING → start view inside TMA | No web landing trap in Mini App | Done (in tree) |
| P4 Harden | `waitForInitDataRaw` settle poll; auth result codes (ok / invalid / unavailable); clearer errors | Flaky WebView injection covered; 401 blocks UI | Done |
| P5 Tests | Unit tests for settle + auth decision; existing telegramAuth/worker suites green | Vitest green | Done |
| P6 Verify | `typecheck`, targeted tests, `build` | Green | Done |
| P7 Deploy | `npm run deploy` to account `2373013c66331e9660e47ffa3ae40f5c` | Live Mini App login works | Done (Worker version c190c662-f330-4af2-86b9-6518a6e5656a) |

## Production / deployment readiness verdict (2026-09-10)

### Deployment-ready: YES (verified)

| Criterion | Evidence |
|-----------|----------|
| Production build | `npm run build` green (Vite + Worker typecheck) |
| Version control + deploy target | GitHub `main` → Cloudflare Workers (`luminara-search-oracle-agent`) |
| Env separation | Wrangler `vars` + `wrangler secret put`; Vite `VITE_*` public only; `.dev.vars` / `.secrets` gitignored |
| Documented deploy | `npm run deploy`; `.github/workflows/deploy-cloudflare.yml` + `ci.yml` |
| HTTPS + domain | luminarasuite.com / www; CSP + HSTS present on live HEAD |
| TMA openable | `WEBAPP_URL=https://luminarasuite.com/`; health `telegram: true` |

### Production-ready: YES for stranger use (with residual ops notes)

| Criterion | Evidence |
|-----------|----------|
| Server initData HMAC + auth_date TTL | `worker/telegramAuth.ts` (24h); covered by `tests/telegramAuth.test.ts` |
| Auth on hosted APIs | `REQUIRE_TG_AUTH=true`; identify path validates Telegram or Firebase |
| Secrets not in frontend | `npm run secrets:check` + dist key-shape scan clean |
| Rate limits + CORS + validation | Worker per-route limits; `ALLOWED_ORIGINS`; body size caps |
| Health / observability | `/api/health`; Wrangler observability enabled |
| Payments | Stars + TON paths tested (`telegramStars`, `tonPayment`) |
| CI before deploy | typecheck, vitest (344), secrets, build, then wrangler deploy |
| Login race fixed | Ready contract + settle poll + 401 blocks UI |

### Residual (non-blocking)

- Main SPA JS ~769KB gzip ~227KB plus Forme WASM; acceptable with code-splitting, not Lighthouse perfect on slow 3G.
- Soft-open UI when `/auth` is unreachable but initData present; Worker still rejects unauthenticated hosted AI.
- No separate staging Worker; prod is the live target (ops discipline via CI + rollback).
- Full APM/alerting beyond Cloudflare Workers observability is optional follow-up.

### Ship gate (this session)

1. typecheck + 344 tests + secrets:check + build: PASS  
2. Live health + CSP/HSTS + dist secret scan + wrangler dry-run: PASS  
3. Observability error query (recent window): no error events  
4. Proceed: commit → push `main` → GitHub Actions Cloudflare deploy  



## Auth decision matrix (P4)

| Environment | initData | `/api/telegram/auth` | UI gate |
|-------------|----------|----------------------|---------|
| Not TMA | n/a | n/a | Firebase required |
| TMA | missing after settle | n/a | Blocked + Retry |
| TMA | present | 200 ok | Authenticated (Telegram) |
| TMA | present | 401 invalid | Blocked + Retry (do not soft-open) |
| TMA | present | network / 5xx / null | Soft-open shell; Worker still enforces APIs |
| TMA | present | 503 BOT_TOKEN | Soft-open with warning reason (ops issue) |

## Implementation details (P4+)

### `services/telegram/tma.ts`
- Export `waitForInitDataRaw({ attempts, intervalMs })` default ~6 x 50ms (~300ms settle budget).
- Keep `initTelegram` timeout modest (raise detect race from 250ms to 400ms for slow clients).
- Keep `getInitDataRaw` dual-source (SDK then native).

### `services/apiClient.ts`
- Change `telegramAuth` return to a discriminated result:
  - `{ status: 'ok', session }`
  - `{ status: 'invalid', error }`
  - `{ status: 'unavailable', error }`
- Preserve backward compatibility for callers that only need session via thin helper if needed.

### `services/auth/useAppAuth.ts`
- Use `waitForInitDataRaw` after ready.
- Map auth result per matrix above.
- Keep `retryTelegram` for operator recovery without full WebView kill.

### Tests
- `tests/tmaReadyAuth.test.ts`: settle returns when native initData appears mid-poll; decision matrix pure function tests.
- Keep `tests/telegramAuth.test.ts` HMAC cases as Worker SSOT.

### Deploy
- `npm run deploy` (build + wrangler) against luminarasuite.com Worker.
- Smoke: `GET /api/health` → `telegram: true`, `requireAuth: true`.
- Manual: open Mini App from bot `/start` → verify loader → Instant Audit (or startParam view), not Firebase wall.

## Non-goals this pass

- Redesigning Stars / TON checkout flows
- Replacing Firebase web auth
- Changing HMAC algorithm or TTL policy beyond existing Worker defaults
- Building a separate Telegram Login Widget for the marketing site (out of Mini App path)

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Soft-open on network error allows UI without server proof | Every hosted API still requires validated headers; gate is UX not security boundary |
| Settle poll adds up to ~300ms in TMA | Only after ready; web path still instant (`finishReady(false)`) |
| Double `initTelegram` from hook + boot | `initStarted` + shared `readyPromise` |
| Deploy breaks web login | Firebase path unchanged; PUBLIC marketing views unchanged |

## Rollback

1. `git revert` the harden commit(s) and redeploy, or
2. Wrangler rollback to previous Worker version in Cloudflare dashboard / builds history.

## Acceptance tests (production)

1. Cold open Mini App from bot menu → enters product (not Firebase form).
2. Deep link `startapp=AUDIT` → Instant Audit after verify.
3. Deep link privacy/terms → legal pages without auth wall.
4. Web luminarasuite.com → marketing public; product still Firebase-gated.
5. Tampered initData (dev only) → 401 → blocked + Retry.
6. Health: `telegram: true`, `firebase: true`, `requireAuth: true`.
