# Three-tier rate limiting (Luminara Suite)

Defense-in-depth against accidental client loops, volumetric abuse, and spend spikes.
Stack: Vite/React client, Cloudflare Workers (edge + server), D1/KV. Not Firebase Cloud Functions.

## Tier 1: Frontend

| Control | Location |
|---------|----------|
| Submit locks | `hooks/useAsyncLock.ts` (ApiKeyModal save, BrandMemory Sentinel, Desktop install) |
| Debounce | `hooks/useDebouncedCallback.ts` (400ms default for future typeahead) |
| Throttle + AbortController | `hooks/useThrottledAction.ts` |
| No 4xx auto-retry | `services/apiClient.ts` `workerFetchWithAuthRetry` |
| Transient retry cap | `fetchWithTransientRetry` (max 2 attempts, backoff + jitter; never on 4xx) |
| 429 UI signal | `luminara-rate-limited` CustomEvent with Retry-After / X-RateLimit-* |

## Tier 2: Edge (Cloudflare)

### Workers Rate Limiting bindings (`wrangler.jsonc` `ratelimits`)

| Binding | Namespace (prod) | Limit | Used for |
|---------|------------------|-------|----------|
| `API_RATE_LIMITER` | `1001` | 120 / 60s | All `/api/*` except Telegram webhook |
| `HIGH_COST_RATE_LIMITER` | `1002` | 20 / 60s | providers, mcp, oracle, audit, enrichment, pagespeed |

Staging uses namespaces `1101` / `1102` so counters do not collide with production.

Reference: [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (GA; colo-local).

### Optional Cloudflare WAF / Rate Limiting rules (dashboard)

Apply under Zone `luminarasuite.com` if you want blocks before the Worker boots.
Suggested rules (template; apply manually or via Terraform later):

| Rule name | Match | Threshold | Action |
|-----------|-------|-----------|--------|
| API standard | `http.request.uri.path matches "^/api/"` | 100 req / 1 min / IP | Block + 429 |
| Auth / license | path contains `/api/auth/` OR `/api/telegram/auth` OR `/api/license/` | 20 req / 1 min / IP | Block + 429 |
| High cost | path matches providers\|mcp\|oracle\|audit\|pagespeed | 10 req / 1 min / IP | Block + 429 |
| Public share | `^/api/share/reports/[a-f0-9]{64}$` | 30 req / 1 min / IP | Managed Challenge or Block |

Fail-fast at the edge preserves Worker CPU and billed duration.

## Tier 3: Server (Worker)

Identity from verified Telegram / Firebase / API key / MCP OAuth only (`identify` / `billingId`).
Never trust client-supplied usage counters.

| Action | Dual key (account + IP) | Window |
|--------|-------------------------|--------|
| `workspace_put` | 30 | 60s |
| `license_activate` | 5 | 60s |
| `mcp_oauth_token` | 10 (IP) | 60s |
| `memory_create` | 20 | 60s |
| `pagespeed` | 10 | 60s |
| `provider_relay` | 60 | 60s |
| `mcp` | 60 | 60s |
| `oracle_chat` | 10 | 60s |
| `audit_run` | 5 | 60s |
| `enrichment_entity` | 20 | 60s |
| `share_public_get` | 30 (IP) | 60s |
| `pwd_reset` (public) | 3 (IP sliding) | 15 min |
| `otp` (public, reserved) | 5 (IP sliding) | 1 hour |
| `api_key_create` | 10 (uid + IP sliding) | 24 hours |

Plus isolate `RateLimiter` (120/60/20), burst gate (5/sec/IP fail-closed), edge bindings, daily hosted quota (`checkHostedQuota`), and outbound email killswitch (`system_metrics:outbound_daily:{UTC-day}`, default 200).

### Password reset (toll-fraud + anti-enumeration)

- Client calls `POST /api/auth/reset-password` (not browser `sendPasswordResetEmail`).
- Order: burst → edge AUTH_MESSAGING_LIMITER → IP sliding window (3 / 15 min) → outbound daily budget → Identity Toolkit `accounts:sendOobCode`.
- Response body is always `{ success: true, message: "If an account exists..." }` for existing and missing emails (HTTP 200).
- Firebase Auth error codes such as `EMAIL_NOT_FOUND` never reach the client.
- Signup UI maps `auth/email-already-in-use` to a non-confirming message.

### OTP / email verification / credential gateway

- `POST /api/auth/sign-up`: 5 / hour IP; Identity Toolkit; never returns EMAIL_EXISTS.
- `POST /api/auth/sign-in`: 20 / 15 min IP; collapses not-found / wrong-password.
- Client hydrates Firebase SDK after Worker success; App Check attaches when `VITE_FIREBASE_APPCHECK_SITE_KEY` is set.
- `POST /api/auth/request-otp`: burst + edge + 5/hour IP; Twilio SMS when `OTP_SMS_ENABLED=true` + secrets; else 501.
- `POST /api/auth/verify-otp`: same IP gate; hashed codes in KV (10 min TTL).
- `POST /api/auth/send-verification`: authenticated; dual-key uid+ip 5/hour + OTP IP gate + outbound budget; neutral success body.
- API key create (10/day) and revoke (20/day) use dual-key sliding windows keyed to billing account id + IP.

### Response headers

On breach (and when dual limit allows):

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (UTC epoch seconds)
- `Retry-After` (on 429)

Structured log: `rate_limit_exceeded` / `edge_rate_limit_exceeded` / `burst_rate_limit_exceeded` / `outbound_daily_budget_exhausted` JSON to Workers logs.

## Verification checklist

1. Double-click Save Changes / Enable Sentinel: only one network mutation.
2. Flood `/api/health` from one IP: isolate + edge binding return 429 with headers.
3. Authenticated account rotating IPs: dual KV `acct:` / `uid:` key still throttles.
4. Hosted provider after daily free limit: 402 + quota headers (existing paywall path).
5. Password reset for known vs unknown email: identical JSON body and status; 4th request/IP in 15m is 429 before Identity Toolkit.
6. Outbound daily counter at limit: password reset returns 503 `OUTBOUND_BUDGET_EXCEEDED` without sending mail.
