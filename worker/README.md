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
| `GET /admin/payment-support` | worker/index.ts + paymentSupport | admin | Requires `ADMIN_SECRET`. Lists payment support requests by `status` (open, answered, closed). The read is audited by count |
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
| `POST /launchpad/scan-compliance`, `GET,POST /launchpad/campaigns`, `GET /launchpad/campaigns/:id`, `PUT /launchpad/campaigns/:id/contract`, `GET /launchpad/campaigns/:id/onchain`, `GET /launchpad/config`, `POST /launchpad/vouchers`, `GET /launchpad/vouchers/:code`, `POST /launchpad/vouchers/redeem` | worker/launchpadService.ts | none (scan, public list/detail) / session (rest) | SMB Launchpad, spec 0015. 404 unless `LAUNCHPAD_ENABLED=true` (local dev with no `ENVIRONMENT` is on). Non-custodial: stores copy, the merchant-registered contract address and voucher records only, never keys or balances, and has no "raised" column. Campaign copy must pass the rule-based screen in `services/launchpad/compliance.ts` (422 otherwise). Drafts are private; a campaign is public only after its owner registers a contract (one address per campaign, unique per chain+network). Registration requires the deployment `txHash` and is verified over JSON-RPC: the tx must be a successful call to OUR factory (`services/launchpad/contracts.ts`, or `LAUNCHPAD_FACTORY_<CHAIN>_TESTNET` on testnet only) that emitted the matching deployment event for that address; with no factory configured, registration returns 409. `LAUNCHPAD_SKIP_CHAIN_VERIFY=true` skips the check on testnet only. `/onchain` reads live escrow figures over `LAUNCHPAD_RPC_<CHAIN>_<NETWORK>` (public RPC fallback) and returns `not_measured` if the RPC fails; nothing is stored. Mainnet needs `LAUNCHPAD_MAINNET_ENABLED=true`. Voucher issue, lookup and redeem are owner-only with no cross-merchant enumeration; redeem is a compare-and-swap on `status='issued'` and unexpired. Voucher expiry is null or at least 36 months. Needs unapplied D1 `0018_smb_launchpad_loyalty.sql` |
| `POST /enrichment/entity` | worker/enrichmentService | session | Entity enrichment |
| `GET /trust/audit-chain/verify` | worker/index.ts + auditLog | session + role | Walks the org's hash chain from genesis by `prev_hash` links. Reports `hash_mismatch`, `fork`, or `orphan` with `brokenAtId`. Legacy raw-accountId rows are a separate chain, verified separately. Over 5000 rows returns `truncated: true` and `ok: false` |
| `GET /trust/keys` | worker/trustReceipts.ts | none | Ed25519 public key set for offline receipt verification. 404 unless `TRUST_RECEIPTS_ENABLED` |
| `GET /trust/receipts`, `GET /trust/receipts/:id`, `POST /trust/receipts/:id/visibility`, `POST /trust/receipts/:id/revoke` | worker/trustReceipts.ts | session (list, mutate) / public GET when `visibility='public'` | Trust Network TN1. No mint route: only Worker verifiers call `issueTrustReceipt`. Private receipts 404 to non-owners (no existence leak). Revoked receipts that were once public stay readable as revoked. Needs D1 `0020_trust_receipts_domain_verify.sql` |
| `GET,POST /trust/domains`, `POST /trust/domains/:domain/check`, `DELETE /trust/domains/:domain` | worker/domainVerification.ts | session | Trust Network TN2. 404 unless `DOMAIN_VERIFY_ENABLED`. Token stored hashed; proof by DNS TXT (`_luminara-verify.<domain>` or apex), `/.well-known/luminara-verify.txt`, or home page meta tag. HTTP proof must come from the domain or its www twin after SSRF-guarded redirects. Resolver or network failure is `unreachable` (`not_measured`), never a failed check. Success issues a `domain_control` receipt when signing is configured, else reports `receiptIssued:false`. Daily cron re-checks each verified domain every 7 days; 2 consecutive misses lapse it and revoke the receipt. 30/min per IP |
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

## Agent Passport invariants (K0)

- **Audit chain id.** Account-scoped audit writes use `auditOrgIdFor(accountId)`
  (`org_<sanitized accountId>`, same id `getOrCreateUserOrg` mints). Never pass a
  raw accountId as `org_id`. Rows written before this rule keep their raw id (the
  hash chain forbids rewrites); `GET /enterprise/audit-logs` merges them via
  `getAuditLogs(..., { legacyOrgIds })` for personal orgs.
- **Credential on every MCP call.** `resolveMcpUser` returns `{ user, credential }`
  (`McpCredential` in `userTypes.ts`): `api_key` (id = `api_keys.id`), `oauth`, or
  `session`. `scopes: null` means unrestricted.
- **Scope gate.** Hosted paid MCP tools require `mcp:research` on the credential
  (`SCOPE_INSUFFICIENT` otherwise). BYOK calls pass with `mcp:free`. OAuth tokens
  minted before enforcement lack `scopeEnforced` and stay unrestricted until their
  30-day TTL drains. Authorize without `scope` requests both; plan caps decide.
- **Every paid call is metered.** MCP and Oracle chat `confirmTool` both check
  `isBudgetHalted` first and write `cost_events` with `credential_kind` /
  `credential_id` (`oracle` for chat). New paid surfaces must do the same.

## Audit chain and Trust Network invariants (TN0-TN2)

- **Append is fork-proof.** `recordAuditLog` inserts with `INSERT ... SELECT ... WHERE
  head = prev_hash` and retries with jittered backoff. The head is the last row by
  `rowid` (insertion order), never `created_at`. `created_at` is kept monotonic along
  the chain. Never write `org_audit_logs` with a plain `INSERT`.
- **Verification follows links,** not timestamps (`verifyAuditChain`). Rows forked
  before this fix are reported as `fork`, never rewritten.
- **Receipts are minted only by Worker verifiers.** No route accepts a client-built
  receipt. `level` is mandatory: `worker_verified`, `registry_verified`, or
  `self_reported`; UI must never present `self_reported` as verified.
- **The signed bytes are `payload_json`.** Verify against the stored canonical JSON
  (`services/trust/receiptCrypto.ts`), never a re-serialisation. Key id is derived
  from the public key. Rotation moves the old public JWK into
  `RECEIPT_RETIRED_PUBLIC_KEYS`; never delete a published key while receipts use it.
- **Revocation is a column, never a delete** (except account deletion, which removes
  the account's receipts and domain rows).
- **A missing signing key never fakes a receipt.** Verifiers report
  `receiptIssued: false` with the reason.

Public document redirects run in `worker/index.ts` before the marketing shell
and the SPA asset fallback:

- `GET /docs/what-is-aeo` and `/docs/what-is-aeo/` return 301 to `/docs/what-is-aeo.html`.
- `GET /how` and `/how/` return 301 to `/how-it-works`.

## Jetton settlement invariants (spec 0018)

- `worker/jettonSettlement.ts` credits a jetton payment only when the inbound message source
  equals the merchant's jetton wallet, derived from `get_wallet_address(owner)` on the configured
  master. The body must decode as `transfer_notification` (`0x7362d09c`, TEP-74) with amount >= price, and
  its forward comment must equal the order memo exactly.
- A memo in a plain TON comment is never proof of a jetton payment.
- Indexer wallet listings are never trusted for ownership. If the two providers disagree on the
  derived wallet, the check fails closed.
- Price jetton units per asset with `jettonPriceUnits`; never reuse one asset's unit string.
- Each tx hash is still claimed once in D1 (`paymentLedger`).
- `JETTON_CHECKOUT_LIVE` is false. It goes back on only after one real testnet USDT transfer has been
  credited end to end on staging (spec 0018), with a review, and with `tests/moneyInvariants.test.ts`
  changed in the same pull request. `LORA_CHECKOUT_LIVE` is a second, separate switch for $LORA.

## Payment rail invariants (pinned in `tests/moneyInvariants.test.ts`)

- **Inside Telegram the only rail is Stars.** `POST /ton/invoice` refuses a request that carries
  Telegram init data and any caller whose identity came from Telegram. The paywall draws no TON
  tab, no Jetton selector, no card tab and no "email us" line there.
- **TON checkout is open only for an address the owner has confirmed.** `TON_CONFIRMED_ADDRESS`
  must equal `TON_RECEIVING_ADDRESS`. Until it does, no invoice is issued and public
  `/health` reports `ton: false`. Orders that already exist can still be verified.
- **Q402 is off, and while it is off every `/q402/*` path is a 404**, including discovery.
- **The Stripe card rail is off** (`STRIPE_CHECKOUT_LIVE`) until its own review.
- Public `/health` carries `ok`, the three rail booleans and `plans` (the public Stars
  catalogue: title, description, price in Stars, days). Nothing else.

## A purchase never downgrades a plan (pinned in `tests/planDowngrade.test.ts`)

- `worker/planRank.ts` ranks the plans: the two one-day passes lowest and equal, then Starter,
  Growth, Agency. `writeSubscriptionRecord` refuses to write a lower plan over a higher one that is
  still running, so every rail inherits the rule; the test lists the files that call it.
- Each rail also refuses before payment where it can: the Stars invoice link, `/buy` and
  pre-checkout; `createTonInvoice`; licence redemption (the key stays unused).
- A Stars payment that arrives anyway is refunded with the reason. A TON payment that arrives
  anyway cannot be sent back by the Worker: it is listed under `sub_pending:ton:<order>` for
  the owner to return by hand, and the buyer is told.
- The same plan again extends it. A higher plan replaces it and keeps the days already there.
- A caller that takes a plan away on purpose (a reversed card payment) passes `allowLowerPlan`.

## Stars charges (pinned in `tests/starsCharges.test.ts`)

Telegram does not send a paid update again once the webhook has answered 200, so:

- **A payment update is handled before the webhook answers.** `pre_checkout_query`,
  `successful_payment` and `refunded_payment` never go through `waitUntil` or the throttle.
- **The first write for a payment is its row in `stars_charges`** (migration 0023,
  `worker/starsCharges.ts`). The webhook answers 503, so Telegram sends the update again, in
  exactly one case: that row could not be written. Once the row exists the answer is 200.
- **A charge always ends `credited` or `refunded`.** A failed grant refunds the payer and tells
  them. "It threw" is not taken to mean "nothing was granted": the code checks for the receipt
  (`stars:charge:<id>`) or a subscription record that lists the charge in `appliedCharges`.
- **A refund only ever goes to the Telegram account that paid** (`payer_tg_id`), never to an id
  read from the invoice payload or typed by an operator.
- **Manual refunds go through the ledger** (`/refund` in the bot, `POST /telegram/refund`), so
  the ledger never says `credited` for Stars that went back.
- **A refund is finished only when the plan has gone back too.** `stars_returned` records that
  the Stars are with the payer. If taking back what the charge gave fails, the row stays
  `refund_due` and the sweep retries that part alone; Telegram is not asked to refund twice.
- **A refund takes back what that charge gave, no more.** Its days come off; if it was the last
  thing applied, the plan returns to what the record said before it. The subscription record keeps
  `appliedCharges` and `chargeLinks` (the plan before each charge, and the charge before it) for
  this.
- **The daily sweep** (`stars_charge_sweep`) settles rows a webhook left undecided, retries
  refunds (5 attempts, then `refund_failed` and an alert to `TELEGRAM_ADMIN_ID`), and compares
  Telegram's own transaction list with the ledger. It never grants.
- `scripts/telegram-setup.mjs` keeps pending updates unless `DROP_PENDING_UPDATES=true`: a
  dropped update can be a paid one.
- Known limits: the sweep is daily until the 15-minute ops cron exists; two charges for one
  account in the same instant can lose one of them (KV has no compare-and-set); and a record
  written before the ledger that stacked an upgrade names only its last charge, so refunding that
  charge keeps the upgraded plan name for the days the earlier charge paid for.

## TON orders (pinned in `tests/tonPendingOrders.test.ts`)

TON checkout is closed until the owner confirms the merchant address. When it opens:

- **The comment on a transfer must equal the order's memo.** Containing it is not enough.
- **An order is remembered in D1 for 48 hours** (`ton_pending_orders`, migration 0025). No invoice
  is issued unless the row was written, and one account can hold at most 20 open orders (the
  count is part of the insert). The KV copy still lasts 2 hours; the verifier falls back to the row.
- **The daily sweep works from the transfers** (`ton_pending_sweep`). It reads each wallet's
  history once, collects the comments shaped like a memo, and verifies only the open orders that
  carry one of them. Crediting still goes through `verifyTonPayment` and the `ton_credited_tx` claim.
- **An unpaid order closes at 48 hours** and its row is kept 30 days more for support.
- **An order is creditable only for the wallet configured now.**
- Known limits:
  - The sweep is daily until the 15-minute ops cron exists; the buyer's "Check my payment" works at any time.
  - A wallet's history is read up to 1,000 transfers per index; beyond that a run is partial, and that is only logged.
  - A claim in `ton_credited_tx` older than five minutes is taken as a credit. If a claim's release ever fails
    after a failed grant (it is logged), the row is marked credited with no plan behind it: an operator who
    clears such a claim must also set the row back to `pending`.
  - The sweep does not see Jetton orders (see the note at `JETTON_CHECKOUT_LIVE`).
  - The client remembers one pending order; sending a second replaces the first on that device. The Worker
    still sweeps both.
  - How the two chain indexes page and order their answers is taken from their documentation. Credit one real
    testnet transfer through each index before TON checkout is opened.

## Payment support (pinned in `tests/paymentSupport.test.ts`)

A buyer's billing message reaches a person. Until this was added, `/paysupport` sent one canned
message and the reply went to the model chat.

- **`/paysupport` opens a 10-minute window**: an `awaiting` row in `payment_support_requests`
  (migration 0026). The buyer's next message inside it becomes the request (`open`) in one
  conditional update. `/paysupport <text>` in one message is the request itself.
- **For 10 minutes after that, up to 5 more messages are added to the same request** and
  forwarded. A sixth is refused with a message, not stored and not forwarded, so one buyer
  cannot fill the admins' chats. After the 10 minutes a message is ordinary chat again.
- **The bot forwards the request to every id in `TELEGRAM_ADMIN_ID`**, with the sender, the
  account and the payer's most recent Stars charge. The buyer's words are marked line by line
  (`> `), so they cannot pass for the bot's own lines. An attachment (a picture, a file, a
  contact, a location) is copied to each admin; if no copy arrives, both sides are told.
- **An admin answers in the bot, in a private chat.** `/reply <id> <text>` is relayed to the
  buyer and marks the request `answered`; `/close <id>` closes it without a message;
  `/requests` lists what is waiting. Anyone else who sends these is refused, and in a group
  they do nothing but say where to use them.
- **After an answer, the buyer's next message goes back to the same request**, for 72 hours,
  and puts it back in the queue. Only that one message: the one after it is chat again. A
  message sent with Telegram's own reply to a support answer returns to that request at any
  time, for the buyer it belongs to. A closed request takes nothing more.
- **What a buyer writes here never reaches a model.** The window check sits above the chat in
  `handleTelegramUpdate`; a captured message is not put in a prompt and not kept in
  `tg:chat:<id>`. When the window cannot be checked (the database does not answer), the message
  is not read at all and the sender is asked to send it again.
- **Private chats only.** In a group, `/paysupport` points to the private chat.
- **If no admin can be told** (no id configured, or Telegram refuses), the request is still
  saved, the buyer is told to write to the support address as well, and `[Support] ALERT` is logged.
- `GET /api/admin/payment-support?status=open|answered|closed` lists requests (`ADMIN_SECRET`).
- The daily `payment_support_sweep` removes windows nobody wrote into, removes answered and
  closed requests 12 months after they were last touched, and reminds the admins of requests
  that have waited more than a day. A request nobody has answered is never removed by it.
- Requests are exported with the account, moved when two sign-ins are linked, and deleted with it.
- The table differs from the plan's first draft in two places, both from review: a
  `follow_ups` column, and one index on `(payer_tg_id, status, expires_at)` for the lookup that
  runs on every chat message.
- Known limits: one Telegram account can have 5 unanswered requests at a time; what is stored
  of a request stops at 2,000 characters (the admins still receive each message in full, up to
  that length each); for 72 hours after an answer the buyer's next message goes to a person
  even if it was meant for the assistant (the acknowledgement says so); the admin's own
  answers are not stored, only that a request was answered and by whom (audit log); the plan
  names no retention period for this table, so 12 months follows its rule for other personal data.

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
