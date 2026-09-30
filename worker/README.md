# Worker (Cloudflare API)

## What this does

Single `worker/index.ts` entrypoint (D1 + KV + env bindings): auth, projects,
reports, MCP, audit runs, sentinel, admin ops. All routes dispatch on
`url.pathname` inside `handleApi`; anything under `/api/` is wrapped in
`withSecurityHeaders` and unhandled errors are collapsed to a bare 500 (no
leaked internals).

## Route map

| Path | Handler file | Auth | Notes |
| --- | --- | --- | --- |
| `GET /health` | worker/index.ts | none | Provider + sidecar + flag probe |
| `GET,HEAD /desktop/latest` | worker/desktopDownloads.ts | none | Desktop release metadata |
| `POST /auth/session` | worker/index.ts + firebaseAuth | none | Firebase session exchange |
| `POST /auth/logout` | worker/index.ts | none | Session clear |
| `POST /auth/reset-password` | worker/index.ts | none | Email reset |
| `POST /auth/sign-up`, `/auth/sign-in` | worker/index.ts | none | Password auth |
| `POST /auth/request-otp`, `/auth/verify-otp` | worker/authOtpSms.ts | none | SMS OTP |
| `POST /auth/send-verification` | worker/index.ts | none | Email verification |
| `POST /webhooks/auth` | worker/index.ts | webhook secret | Firebase webhook |
| `POST /auth/link` | worker/index.ts | Telegram initData + Firebase Bearer | Explicit account link. Body must be `{ confirm: true }` or the route returns 400 and writes nothing. Two distinct accounts that each have an active paid plan return 409 with no merge. `identify()` never links. Success and dual-paid refusal write an audit event |
| `GET,PUT /workspace` | worker/userStore.ts | session | Account workspace blob (zero-knowledge key bag) |
| `GET /enterprise/audit-logs` | worker/enterpriseStore.ts + auditLog | session + role | Admin/Auditor role required |
| `GET /auth/quota` | worker/index.ts | session | Daily quota |
| `POST /telegram/webhook` | worker/index.ts | webhook secret | Telegram updates |
| `GET /telegram/auth`, `/telegram/invoice`, `/telegram/refund` | worker/index.ts | none/secret | Telegram auth + Stars |
| `GET /admin/users` | worker/index.ts | admin | Requires `ADMIN_SECRET` |
| `POST /ton/invoice`, `/ton/verify` | worker/tonAttestationService | none | TON payments |
| `POST /license/activate` | worker/licenseService | session | License activation |
| `POST /admin/license/generate`, `/admin/license/seed` | worker/licenseService | admin | License ops |
| `POST /admin/skills/:slug/versions`, `POST /admin/skills/:slug/enable`, `GET /admin/skills/:slug` | worker/agentSkills.ts | admin | Agent skill versions/enable |
| `POST /agent/attest` | worker/attestationService.ts | none | Agent attestation |
| `POST /sentinel/register`, `/sentinel/status` | worker/sentinel.ts | session | Drift Sentinel targets |
| `GET /share/reports/:token`, `POST /share/reports` | worker/shareService.ts | session + public GET | Full branded reports. Growth+ `shareLinks` |
| `POST /share/teasers`, `GET /share/teasers/:token` | worker/shareService.ts | session create, public GET | Redacted scout teaser. Not `shareLinks`. 5/day. Public hosts only. Credential-like text rejected. Badges stored as not_measured |
| `GET /referrals/me`, `POST /referrals/claim`, `POST /referrals/qualify`, `POST /missions/complete` | worker/referrals.ts | session | Opaque `ref_` invites. Qualify pays two-sided credits only with a one-time scout receipt from a signed-in evidence call. Re-scout needs a second honest scout in the current ISO week. Credit consume is compare-and-swap. Needs unapplied D1 `0012_referrals_missions.sql`. Bot `/missions` is opt-in and is not on the Sentinel cron |
| `POST /idea-scout`, `GET /idea-scout`, `GET /idea-scout/:id`, `PATCH /idea-scout/:id/link`, `POST /idea-scout/pulse` | worker/ideaScout.ts | session | Hypothesis card before a domain exists. Hosted generation needs Telegram or Firebase. The hosted meter is consumed before fetch or the model. Free tier: 2 cards per UTC day via D1 compare-and-swap after the row inserts. A lost slot deletes the row and does not refund the hosted charge. Missing migration 0013 returns before fetch, model, and meters. Anonymous callers are rejected before fetch or model spend. Competitor fetch is title, meta, and headings only. Card schema rejects percentages and measured badges. Needs unapplied D1 `0013_idea_scout.sql` (`idea_scouts`, `idea_scout_daily`, `niche_pulse_subs`). Bot `/pulse` stores a niche tip and is not on the Sentinel cron |
| `GET /visibility/crawler-files` | worker/llmCrawlerRoute.ts | session | `/robots.txt`, `/llms.txt`, and optional `/ai.txt`. SSRF guarded. No redirect follow. A non-empty file mints `X-Scout-Receipt` for that host |
| `POST /enrichment/entity` | worker/enrichmentService | session | Entity enrichment |
| `* /oauth/mcp/*` | worker/mcpOAuth.ts | oauth/token | OAuth 2.1 + PKCE for MCP |
| `GET,POST /memory/facts` | worker/memoryService.ts | session | Hosted memory facts |
| `POST /pagespeed` | worker/pagespeedRoute.ts | session | Hosted PageSpeed |
| `* /mcp`, `/mcp/*` | worker/mcpServer.ts | session/apikey/oauth | MCP tool calls |
| `GET,POST /projects`, `/projects/:id` | worker/projectService.ts + projectContextService.ts | session | Project memory CRUD |
| `GET,POST /reports`, `/reports/:id` | worker/agentReportService.ts | session | Agent reports |
| `GET,POST /api-keys`, `DELETE /api-keys/:id` | worker/apiKeyService.ts | session + plan gate | lm_live_* API keys; Growth/Agency only |
| `POST /oracle/chat` | worker/oracleChat.ts | session + apiAccess | Agency Oracle SSE |
| `POST /audit/run`, `GET /audit/runs/:id` | worker/auditQueue.ts | session + apiAccess | Audit queue |
| `* /providers/:id/*` | worker/providerRelay.ts | byok/session | LLM/search/scrape proxy |

Auth legend: `session` = Firebase/Telegram cookie or Bearer;
`apikey` = `lm_live_*` MCP key; `oauth` = `mcp_*` OAuth token;
`admin` = `ADMIN_SECRET` header; `byok` = bring-your-own-key header.

Public document redirects run in `worker/index.ts` before the marketing shell
and the SPA asset fallback:

- `GET /docs/what-is-aeo` and `/docs/what-is-aeo/` return 301 to `/docs/what-is-aeo.html`.
- `GET /how` and `/how/` return 301 to `/how-it-works`.

## Stubbed vs live status

- `worker/auditQueue.ts`: v1 queue is live; when a full node payload is not
  available the `measurementStatus` field is `not_measured` (reduced graph,
  incremental build).
- `worker/agentOutputValidators.ts`: scans agent output for invented metrics /
  missing citations / vendor names. Wired into Oracle SSE provenance events
  (v1 flags only; does not block streams).
- `worker/oracleInteractionGuard.ts`: instructs Oracle to respond
  `not_measured` or "not verified" when data is missing; numeric claims
  without tool evidence are rejected. Live.
- DataForSEO / Umami sidecars: live when env-bound; the front-end traffic
  path returns `not_configured` when unreachable. See `services/competitors/README.md`.
- Telegram webhook, license service, sentinel scan: live when bindings exist.
- Everything under `/oracle/`, `/audit/`, `/tools/` that is not handled
  above returns 501 `NOT_IMPLEMENTED` behind feature flags.

Honest gaps: admin-skill versions, license seeding, and the run-provenance
chain table all require D1 migrations (`migrations/0010_run_provenance_and_agent_skills.sql`).
When D1 is unbound they fail best-effort and log to console.

## Env vars

Read: `ADMIN_SECRET`, `BOT_TOKEN`, `FIREBASE_PROJECT_ID`, `MCP_OAUTH_SECRET`,
`PAGESPEED_API_KEY`, `REQUIRE_APP_CHECK`, `REQUIRE_TG_AUTH`,
`REQUIRE_SUBSCRIPTION`, `FREE_DAILY_LIMIT`, `AUDIT_QUEUE_ENABLED`, provider
keys (`GEMINI`, `GROQ`, `OPENROUTER`, `DATAFORSEO`, `NIM`, `OLLAMA`), sidecar
URLs, TON pricing vars, D1 `DB`, KV `LUMINARA_KV`. Secrets stay server-side.

## Key tests

- `tests/userStore.test.ts`: user/profile + workspace blob round trip.
- `tests/agentOutputValidators.test.ts`: unmeasured-output rejection.
- `tests/browserAction.test.ts`, `tests/browserActionMcp.test.ts`: MCP + DOM action surface.
- `tests/evalsRunner.test.ts`, `tests/honestyGates.test.ts`: honesty gates.
