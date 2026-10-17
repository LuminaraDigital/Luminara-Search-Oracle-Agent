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
| `POST /admin/trust/revoke-gateway-receipts` | worker/trustReceipts.ts | admin | Revokes receipts whose signed method is `gateway_oracle_audit_v1` (issued by the gateway route before it stopped issuing). Up to 10 per call; returns `{ revoked, remaining }`. Idempotent. Works while `TRUST_RECEIPTS_ENABLED` is off. Each run writes one `admin.trust.revoke_gateway_receipts` audit entry. 503 `TRUST_RECEIPTS_TABLE_MISSING` when migration 0020 is not applied. It marks rows and their public pages; a copy saved earlier keeps a valid signature until the signing key is rotated |
| `POST /admin/skills/:slug/versions`, `POST /admin/skills/:slug/enable`, `GET /admin/skills/:slug` | worker/agentSkills.ts | admin | Agent skill versions/enable |
| `POST /agent/attest` | worker/attestationService.ts | none | Agent attestation |
| `POST /sentinel/register`, `/sentinel/status` | worker/sentinel.ts | session | Drift Sentinel targets |
| `GET /share/reports/:token`, `POST /share/reports` | worker/shareService.ts | session + public GET | Full branded reports. Growth+ `shareLinks` |
| `POST /share/teasers`, `GET /share/teasers/:token` | worker/shareService.ts | session create, public GET | Redacted scout teaser. Not `shareLinks`. 5/day. Public hosts only. Credential-like text rejected. Badges stored as not_measured |
| `GET /referrals/me`, `POST /referrals/claim`, `POST /referrals/qualify`, `POST /missions/complete` | worker/referrals.ts | session | Opaque `ref_` invites. Qualify pays two-sided credits only with a one-time scout receipt from a signed-in evidence call. Re-scout needs a second honest scout in the current ISO week. Credit consume is compare-and-swap. Needs unapplied D1 `0012_referrals_missions.sql`. Bot `/missions` is opt-in and is not on the Sentinel cron |
| `POST /idea-scout`, `GET /idea-scout`, `GET /idea-scout/:id`, `PATCH /idea-scout/:id/link`, `POST /idea-scout/pulse` | worker/ideaScout.ts | session | Hypothesis card before a domain exists. Hosted generation needs Telegram or Firebase. The hosted meter is consumed before fetch or the model. Free tier: 2 cards per UTC day via D1 compare-and-swap after the row inserts. A lost slot deletes the row and does not refund the hosted charge. Missing migration 0013 returns before fetch, model, and meters. Anonymous callers are rejected before fetch or model spend. Competitor fetch is title, meta, and headings only. Card schema rejects percentages and measured badges. Needs unapplied D1 `0013_idea_scout.sql` (`idea_scouts`, `idea_scout_daily`, `niche_pulse_subs`). Bot `/pulse` stores a niche tip and is not on the Sentinel cron |
| `GET /idea-scout/feed`, `POST /idea-scout/vote`, `POST /idea-scout/share` | worker/ideaScout.ts | session | Community idea feed. 404 unless `COMMUNITY_FEED_ENABLED=true`, which stays off until the chat rules and a named moderator exist. Cards and votes live in D1 `0033_community_feed.sql`, not KV. Share takes the id of an idea card the caller owns and publishes a copy under a new `cf_` id; another account's id is 404 and adds nothing. No response carries an account id or an idea id. The public card is the idea card's problem, prompts and hypotheses; competitor URLs and scraped page text are left out. One vote per account per card (primary key); the count is `COUNT(*)` over votes, never seeded. A `hidden` or `removed` card leaves the feed and takes no votes, and its row stays. 5 shares per account per UTC day; ownership and the cap are checked inside the insert. 60 reads per minute per IP, 30 votes and 10 shares per minute per account and per IP. Exported and deleted with the account, moved on account link (if that move fails it is logged and the link stands, as for the payment tables). Owner step: the KV value `idea_scout:community_feed` from before 0033 is read by nothing and holds sharers' account ids; delete it in each environment with `npx wrangler kv key delete idea_scout:community_feed --binding LUMINARA_KV --remote --env staging`, then `--env production` |
| `GET /visibility/crawler-files` | worker/llmCrawlerRoute.ts | session | `/robots.txt`, `/llms.txt`, and optional `/ai.txt`. SSRF guarded. No redirect follow. A non-empty file mints `X-Scout-Receipt` for that host |
| `POST /launchpad/scan-compliance`, `GET,POST /launchpad/campaigns`, `GET /launchpad/campaigns/:id`, `PUT /launchpad/campaigns/:id/contract`, `GET /launchpad/campaigns/:id/onchain`, `GET /launchpad/config`, `POST /launchpad/vouchers`, `GET /launchpad/vouchers/:code`, `POST /launchpad/vouchers/redeem` | worker/launchpadService.ts | none (scan, public list/detail) / session (rest) | SMB Launchpad, spec 0015. 404 unless `LAUNCHPAD_ENABLED=true` (local dev with no `ENVIRONMENT` is on). Non-custodial: stores copy, the merchant-registered contract address and voucher records only, never keys or balances, and has no "raised" column. Campaign copy must pass the rule-based screen in `services/launchpad/compliance.ts` (422 otherwise). Drafts are private; a campaign is public only after its owner registers a contract (one address per campaign, unique per chain+network). Registration requires the deployment `txHash` and is verified over JSON-RPC: the tx must be a successful call to OUR factory (`services/launchpad/contracts.ts`, or `LAUNCHPAD_FACTORY_<CHAIN>_TESTNET` on testnet only) that emitted the matching deployment event for that address; with no factory configured, registration returns 409. `LAUNCHPAD_SKIP_CHAIN_VERIFY=true` skips the check on testnet only. `/onchain` reads live escrow figures over `LAUNCHPAD_RPC_<CHAIN>_<NETWORK>` (public RPC fallback) and returns `not_measured` if the RPC fails; nothing is stored. Mainnet needs `LAUNCHPAD_MAINNET_ENABLED=true`. Voucher issue, lookup and redeem are owner-only with no cross-merchant enumeration; redeem is a compare-and-swap on `status='issued'` and unexpired. Voucher expiry is null or at least 36 months. Needs unapplied D1 `0018_smb_launchpad_loyalty.sql` |
| `POST /enrichment/entity` | worker/enrichmentService | session | Entity enrichment |
| `GET /trust/audit-chain/verify` | worker/index.ts + auditLog | session + role | Walks the org's hash chain from genesis by `prev_hash` links. Reports `hash_mismatch`, `fork`, or `orphan` with `brokenAtId`. Legacy raw-accountId rows are a separate chain, verified separately. Over 5000 rows returns `truncated: true` and `ok: false` |
| `GET /trust/keys` | worker/trustReceipts.ts | none | Ed25519 public key set for offline receipt verification. 404 unless `TRUST_RECEIPTS_ENABLED` |
| `GET /trust/receipts`, `GET /trust/receipts/:id`, `POST /trust/receipts/:id/visibility`, `POST /trust/receipts/:id/revoke` | worker/trustReceipts.ts | session (list, mutate) / public GET when `visibility='public'` | Trust Network TN1. No mint route: only Worker verifiers call `issueTrustReceipt`. Private receipts 404 to non-owners (no existence leak). Revoked receipts that were once public stay readable as revoked. Needs D1 `0020_trust_receipts_domain_verify.sql` |
| `GET,POST /trust/domains`, `POST /trust/domains/:domain/check`, `DELETE /trust/domains/:domain` | worker/domainVerification.ts | session | Trust Network TN2. 404 unless `DOMAIN_VERIFY_ENABLED`. Token stored hashed; proof by DNS TXT (`_luminara-verify.<domain>` or apex), `/.well-known/luminara-verify.txt`, or home page meta tag. HTTP proof must come from the domain or its www twin after SSRF-guarded redirects. Resolver or network failure is `unreachable` (`not_measured`), never a failed check. Success issues a `domain_control` receipt when signing is configured, else reports `receiptIssued:false`. Daily cron re-checks each verified domain every 7 days; 2 consecutive misses lapse it and revoke the receipt. 30/min per IP |
| `* /oauth/mcp/*` | worker/mcpOAuth.ts | oauth/token | OAuth 2.1 + PKCE for MCP |
| `GET,POST /memory/facts` | worker/memoryService.ts | session | Hosted memory facts |
| `GET /rsi/skills`, `POST /rsi/skills/observations`, `POST /rsi/skills/proposals/:id/apply`, `POST /rsi/skills/:id/pin`, `POST /rsi/skills/:id/rollback`, `POST /rsi/skills/:id/usage`, `POST /rsi/skills/curate` | worker/rsiRoutes.ts | session | Learned SKILL.md library. A fix proposes a skill after two successes. Apply needs evidence, an unpinned record, a clean safety scan, passing evals, and room in the 3-change daily cap. The daily 08:00 UTC cron archives stale unpinned skills on Mondays. Needs D1 `0027_rsi_skill_library.sql` |
| `POST,GET /rsi/corrections`, `GET /rsi/rewards`, `POST /rsi/rewards/outcomes`, `POST /rsi/rewards/pin`, `POST /rsi/rewards/rollback` | worker/rsiCorrections.ts | session | Corrections become eval cases that gate skill publishes for that account. Reward weights nudge once per ISO week from measured outcomes. Pinned weights stay fixed. Needs D1 `0028_rsi_corrections.sql` |
| `POST /rsi/prompts/publish`, `POST /rsi/prompts/rollback` | worker/rsiCorrections.ts | admin | Writes the global `agent_skills` catalog. Requires `x-admin-secret`, the same gate as `POST /admin/skills/:slug/versions`. A session is refused. The safety scan, metric eval, and the admin actor's correction cases still run. Needs D1 `0028_rsi_corrections.sql` |
| `POST /rsi/fixes`, `POST /rsi/fixes/rank` | worker/rsiFixOutcomes.ts | session | Logs a fix with before/after AI citation rates into Dreaming `action_memory`. A gain counts only when both rates are measured. Rank leaves unmeasured signatures at score 0 with evidence `not_measured`. Needs D1 `0029_rsi_fix_outcomes.sql` |
| `POST /rsi/replay/nodes`, `POST /rsi/replay/select`, `POST /rsi/replay/pin` | worker/rsiReplay.ts | session | Scores a new audit, probe, or ranking strategy on logged runs before enabling it. The current strategy stays unless the candidate mean is strictly higher on at least 3 measured runs. One enable per week. Pinned slots stay fixed. Needs D1 `0030_rsi_offline_replay.sql` |
| `POST /rsi/posts/draft`, `POST /rsi/posts/:id/metrics`, `POST /rsi/posts/reflect` | worker/rsiPosting.ts | session | Drafts 3 to 5 posts, records one selected post (no external network call), and ingests 24h and 72h metrics. A playbook pattern is added only after 2 measured 72h successes, at most 2 edits a week. The daily 08:00 UTC cron reflects playbooks on Mondays. Needs D1 `0031_rsi_posting.sql` |
| `POST /rsi/memory/documents`, `GET /rsi/memory/search` | worker/rsiMemorySearch.ts | session | Indexes an audit or chat for the account and searches the latest 300 by token overlap. A brand-fact nudge is returned and is not written. The client saves an accepted fact with `saveBrandFact`. Does not replace `worker/memoryRag.ts`. Needs D1 `0032_rsi_memory_search.sql` |
| `POST /pagespeed` | worker/pagespeedRoute.ts | session | Hosted PageSpeed |
| `POST /deploy/readback` | worker/deployReadback.ts | session | Deploy read-back for the CMS deploy screen. Body `{ url, schemaJsonLd }`. Fetches the page through `fetchPublicUrl` (public http(s) only; private, loopback and link-local addresses refused, DNS re-checked on every redirect hop) on the default web ports only, first hop and redirects alike. Answers `{ ok: true, found }`: whether a JSON-LD script element equal to the schema is in the page source. The page must be served with an HTML content type. A copy inside a comment, textarea, template, noscript, style, inline SVG or a script of another type does not count, and the `type` attribute must be `application/ld+json` (parameters after `;` allowed). The whole schema is compared, so one merged into a larger `@graph` reads as not found. Never returns the page. Every page that could not be read gets the same 422 and the same sentence, never `found: false`, so the route cannot probe ports or statuses. 10/min per account and per IP |
| `* /mcp`, `/mcp/*` | worker/mcpServer.ts | session/apikey/oauth | MCP tool calls |
| `GET,POST /projects`, `/projects/:id` | worker/projectService.ts + projectContextService.ts | session | Project memory CRUD |
| `GET,POST /reports`, `/reports/:id` | worker/agentReportService.ts | session | Agent reports |
| `GET,POST /api-keys`, `DELETE /api-keys/:id` | worker/apiKeyService.ts | session + plan gate | lm_live_* API keys; Growth/Agency only |
| `POST /oracle/chat` | worker/oracleChat.ts | session + apiAccess | Agency Oracle SSE |
| `POST /audit/run`, `GET /audit/runs/:id` | worker/auditQueue.ts | session + apiAccess | Audit queue |
| `* /providers/:id/*` | worker/providerRelay.ts | byok/session | LLM/search/scrape proxy. Workers AI fallback (worker/workersAiFallback.ts): hosted-key `POST /providers/groq/chat/completions` only, and only on no hosted key, a network failure, or an upstream 5xx after the second-key retry. Never on a 4xx, never for BYOK, never for another provider, and never unless the request asks for it with the header `x-accept-fallback: 1` (the app's chat sends it; without it the fallback model is not run and nothing is logged). It refuses `response_format`, `tools`, `tool_choice`, non-string content, a bare `prompt`, any field it would have to ignore (`stop`, `logprobs`, the penalties and anything it does not know), an invalid value (it never substitutes a default for one), and a prompt over its budget, counted in UTF-8 bytes; the caller then gets the upstream's own error. An empty or broken fallback is not sent either. A fallback reply carries `X-Provider-Fallback`, `X-Provider-Fallback-Model`, `X-Provider-Fallback-Reason` and a body `x_fallback` field, and only the chat accepts one and shows the model (`allowFallback` on the client). `finish_reason` is `length` only when the binding's reported completion tokens reached the cap; with no usage reported it is `stop` and the answer line says `usage: none`. Usage is the binding's or absent, never zeros. One log line per outcome, with no prompt text: `workers_ai_fallback_answer`, `workers_ai_fallback_refused`, `workers_ai_fallback_failed`. Hosted-key upstream errors the relay renames, each a 503: 402 is `HOSTED_PROVIDER_DEPLETED`, 401 is `HOSTED_PROVIDER_KEY_REFUSED` (the provider refused the server's key), 403 is `HOSTED_PROVIDER_REQUEST_REFUSED` (it refused this request; the cause is not known), so the client does not read either as the caller's sign-in failing. For 401 and 403 the upstream's status and its own error code or type, never its message, go to a `hosted_provider_refused` log line. A BYOK 401 or 403 is the caller's key and passes through; a BYOK 402 stays a 402 (`BYOK_PAYMENT_REQUIRED`) |

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
- **A verified level needs a verifier result.** `issueTrustReceipt` refuses
  `worker_verified` and `registry_verified` unless the call carries a `VerifierResult`:
  a passed check for the same subject, claim and method, whose evidence hash and
  location the receipt carries. The level, claim and method must also be ones a
  verifier in the Worker can return (`VERIFIER_METHODS`): today only `worker_verified`
  `domain_control` by `dns_txt`, `well_known` or `meta_tag`. The evidence must be where
  that method reads its proof for that subject: `dns:TXT:_luminara-verify.<domain>` or
  `dns:TXT:<domain>` for `dns_txt`, and for the other two an http(s) URL on the domain
  or its www twin, as the domain check reports it. The guard checks the result's shape
  and that it matches; it cannot prove who built it, so only a verifier may build one. `POST /gateway/execute` checks nothing about a domain, so it issues
  no receipt and says so (`receiptIssued: false`). `tests/receiptsNeedVerifier.test.ts`
  lists the only files allowed to write the level.
- **The Worker holds no chain signing key and sends nothing to a chain.**
  `anchorAuditCitation` makes no outbound request and answers `ok: false`, also with
  `PROOF_ANCHOR_ENABLED` on, so it can store nothing as `anchored`
  (`worker/chain/ton/citationRegistry.ts`). `/proof/verify` never reports an
  `audit_citation` row as on-chain, not even one an older build stored as `anchored`;
  payment anchors, which carry a transaction hash, are reported as before.
- **The signed bytes are `payload_json`.** Verify against the stored canonical JSON
  (`services/trust/receiptCrypto.ts`), never a re-serialisation. Key id is derived
  from the public key. Rotation moves the old public JWK into
  `RECEIPT_RETIRED_PUBLIC_KEYS`; never delete a published key while receipts use it.
- **Revocation is a column, never a delete** (except account deletion, which removes
  the account's receipts and domain rows).
- **Revoking does not undo a signature.** It marks the row, and the receipt's public
  page then shows it as withdrawn. A copy of the receipt that somebody saved earlier
  still checks out against `/api/trust/keys`: the signature stays valid until the
  signing key is rotated and the old public key is no longer published. That is the
  only way to make a saved copy fail, and it makes every other receipt signed with
  that key fail too, so those have to be issued again.
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

## Stripe card rail invariants (`worker/stripePayment.ts`, pinned in `tests/stripePayment.test.ts`)

The rail is off. These hold for the day it is switched on.

- **Only a signed-in web buyer can start a checkout.** `POST /stripe/create-checkout-session` is a
  protected route and the handler calls `identify()` again: no user means 401 and no call to
  Stripe. There is no guest checkout. A request with Telegram init data, or an identity that
  came from Telegram, is refused (Stars only inside Telegram).
- **The Stripe mode must match the environment.** `ENVIRONMENT=production` needs a live secret
  key; every other environment needs a test key. Anything else closes the rail and public
  `/health` reports `stripeCheckout: false`. The webhook acts only on an event whose `livemode`
  matches, so card 4242 can never buy a production plan.
- **Nobody pays while the payment could not be credited.** No session is created unless
  `isStripeLedgerReady` passes (migrations 0021 and 0024 applied) and KV is bound.
- **The grant is decided by the server's own numbers.** Only `checkout.session.completed` with
  `mode=payment`, `payment_status=paid`, `currency=usd`, a `payment_intent`, and `amount_total`
  equal to `STRIPE_PLAN_CONFIG[plan].amountCents` is credited, to `metadata.userId` only.
  `invoice.payment_succeeded` and `client_reference_id` are not honoured. Turning on Stripe Tax
  or coupons changes `amount_total` and must change this check in the same PR. A session that
  fails a check is logged with `NOT credited` and nothing is refunded automatically: refund it by
  hand. A session can be paid for one hour, so a price change needs an hour before sessions
  opened at the old price are gone.
- **A full refund or a dispute takes back the days that charge granted, once.** The ledger row
  stores `payment_intent`, the paying login, the days granted and when they end
  (`granted_until`). `charge.refunded` (full refunds only; a partial refund leaves the plan
  alone), `charge.dispute.created` and `charge.dispute.funds_withdrawn` claim the reversal in D1
  before the subscription is rewritten. An inquiry (dispute status `warning_*`) changes nothing.
  Only the days still ahead come off, so a card month that has run out cannot shorten a plan
  bought another way. A dispute that is later won is not re-credited automatically.
- **A reversed upgrade does not leave the higher plan behind.** After a reversal the plan is the
  highest of: the account's other card charges still standing, and the plan it held before its
  run of card purchases began (`prev_plan`). If another rail has written the record since, that
  purchase set the plan and the name is left alone.
- **Events may arrive in any order.** A refund or dispute that arrives before its session was
  credited leaves a marker row (`reversed:<payment_intent>`), and the late session is not credited.
- **Plan rank (Track SW, SW0a-4).** A lower plan never replaces a higher active one: it is refused
  before payment (409 `LOWER_PLAN_REFUSED`). If a lower-plan session opened earlier is paid
  anyway, plan and expiry stay as they are and the Worker refunds the payment through Stripe
  (the only place the Worker moves money on this rail). The same plan extends the expiry. A
  higher plan adds its days to the current expiry and replaces the plan name: this is today's
  rule on every rail, and Track SW decision 31 is whether to keep it (see below).
- **The payer returns to the Luminara site.** Both return URLs are built from `WEBAPP_URL`. The
  request body and the `Origin` header are never used. The client sends the plan id and nothing else.
- **Webhook hygiene.** Body capped at `MAX_SMALL_BODY_BYTES` before the HMAC is computed; a
  non-numeric `t` in the signature header is malformed; a failed write releases its D1 claim and
  the request fails, so Stripe redelivers. A retried session finds itself in `stripeSessions`
  on the record and is neither added again nor refused.

Known limits, each to be settled before the rail is switched on:

- **Days bought cheaply become days of the higher plan on upgrade (decision 31).** Twelve Starter
  months and then one Agency month is thirteen months of Agency. The card rail makes this easy
  to do on purpose. It is the same on Stars, TON and licence keys today.
- **Two events for one account at the same moment can lose an update.** The subscription is one
  KV record that each rail reads and then writes. Three charges disputed in the same second can
  end with one month removed instead of three. Fixing it means keeping the plan in D1 or a
  Durable Object, for every rail.
- **A Worker that is cut off between the D1 claim and the KV write leaves a claim with no
  grant**, and later deliveries are answered as duplicates. A caught failure releases the claim;
  a cancelled request does not. The ledger needs an "applied" state to close this.
- **The run of card purchases is remembered on the KV record.** A purchase on another rail writes
  a fresh record, so a card retry or reversal after it is judged without that memory.

Before `STRIPE_CHECKOUT_LIVE` is set to true (its own PR, with `tests/moneyInvariants.test.ts`):
subscribe the Stripe endpoint to exactly `checkout.session.completed`, `charge.refunded`,
`charge.dispute.created` and `charge.dispute.funds_withdrawn`; on staging, prove one test-mode
purchase (also once with a `+location_FR` email, to see `currency` stay `usd` under Adaptive
Pricing), one refund, one dispute and one refused lower plan; add the two migrations and
`stripe_credited_sessions` to `scripts/smoke-check.mjs`; and give the buyer a confirmation when
they land on `/?payment=success` (nothing reads it today).

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
  buyer and marks the request `answered`; `/close <id>` closes it; `/requests` lists what is
  waiting. Anyone else who sends these is refused, and in a group they do nothing but say where
  to use them. Closing sends the buyer nothing, except when an answer had told them their next
  message would come back: then they are told it is closed.
- **After an answer, the buyer's next message goes back to the same request**, for 72 hours,
  and puts it back in the queue. Only that one message: the one after it is chat again. With
  several answered requests it goes to the one answered last, and the others stop waiting for
  one. A message sent with Telegram's own reply to anything the bot said about a request (the
  answer, or an acknowledgement that names it) returns to that request at any time, for the
  buyer it belongs to. A closed request takes nothing more.
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
  that have waited more than a day since their last message. A request nobody has answered is
  never removed by it.
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
- `worker/chatHonesty.ts`: the Telegram bot's free-text chat fetches and measures
  nothing, and the model has no say over prices or payments.
  - **Two kinds of message never reach the model.** `chatRoute` reads the user's
    message (English, plus a short named list of words in Spanish, Portuguese,
    Russian, French and German). A payment problem in the first person ("I paid but
    nothing happened", "charged twice", "I want a refund") gets one fixed reply that
    points to `/paysupport` and says not to pay again. A question about Luminara's
    own plans, prices or how to pay gets one block built from `PLANS`, headed
    "Luminara's own plans:", which also says that plans are paid with Telegram
    Stars and do not renew on their own. Its last line is for a buyer whose payment
    went wrong and who landed there: "Already paid? Send /paysupport. Do not pay
    again." Both replies are stored in history like any reply, cost no quota and
    need no plan.
  - **It routes only when sure, and it has no memory.** A payment cue in the first
    person ("I paid", "charged me", "my payment") wins over everything else in the
    message. Without one, a message that names another company or tool, or is about
    the user's own site, page, markup, policy, customers or pricing, goes to the
    model. Each message is read by itself: what was said before never routes it.
  - Every model reply passes through `filterChatReply` before it is stored or sent.
    A sentence that tells the user to pay again ("Send /buy_starter again.",
    "Retry the purchase."), or claims a change to the account that the model cannot
    make ("I have activated it for you.", "Your plan is now active."), gives way to
    the /paysupport text, once per reply.
  - A sentence that names one of our plans as a plan with a number (a price, or a
    limit such as "10 sites"), or gives a number of Stars, gives way to the plan
    block. The model's number is never checked: a correct price is replaced too.
    "Your Starter plan" is ours; beside "tier", "page" or "pricing" it is read as a
    tier of the user's own product and left alone. Any other talk of money (price, pay,
    refund, renew, trial, discount, free, card, crypto, subscription) stays word for
    word, and one fixed line is added at the end of the reply: where plans and
    prices are, where billing help is, and that this chat cannot quote prices or
    take payments.
  - A sentence that states a measurement nobody made (a percentage, a rank, a score,
    a count of citations or visits, a claim of having looked at the site) becomes
    one "not measured" sentence. Links, dates, phone and version numbers and HTTP
    status codes are set aside first. A number the user wrote is kept only where the
    sentence hands it back ("you said"). An instruction keeps its count ("Add 3 FAQ
    questions") and loses a promised outcome. Status comes from the claim ledger
    (`services/evidenceBound`).
  - Inline code is read as prose. Only JSON-LD (an object with `@context`) and head
    tags (`meta`, `link`, `title`, a JSON-LD `script`) are set aside as something
    to paste, fenced or not. Any other JSON, markup or fenced text, and everything
    after an unclosed fence, is prose and is read for measurements.
  - A link or bare host name is spelled out in words unless the host is
    luminarasuite.com, the `WEBAPP_URL` host, one the user wrote, or a reference
    host (`REFERENCE_LINK_HOSTS`). Links inside JSON-LD and head tags are checked
    too. A sentence that asks for a code, password, seed phrase or key is removed.
  Business DNA enters the prompt only inside an untrusted-content fence whose
  markers carry a one-time code, with each field capped at 300 characters. The
  reply is sent with no `parse_mode` and with link previews off. The filter is a
  backstop, pattern based and mostly English; the prompt rules and the plan-question
  rule are the main controls. Live.
- DataForSEO / Umami sidecars: live when env-bound; the front-end traffic
  path returns `not_configured` when unreachable. See `services/competitors/README.md`.
- Telegram webhook, license service, sentinel scan: live when bindings exist.
- Everything under `/oracle/`, `/audit/`, `/tools/` that is not handled
  above returns 501 `NOT_IMPLEMENTED` behind feature flags.

Honest gaps: admin-skill versions, license seeding, and the run-provenance
chain table all require D1 migrations (`migrations/0010_run_provenance_and_agent_skills.sql`).
When D1 is unbound they fail best-effort and log to console.

## Cron and queue dispatch invariants (pinned in `tests/scheduledJobs.test.ts`, `tests/workerScheduledAndQueue.test.ts`)

- **A cron expression runs only the jobs mapped to it** in `CRON_JOBS` (`worker/scheduledJobs.ts`).
  An expression with no entry runs no job, and `scheduled()` logs it as an error
  (`[Cron] ... is not mapped`). A new cron and its entry ship in the same pull request.
- **A queue batch goes only to the handler mapped to its queue** in `worker/queueDispatch.ts`.
  A batch from a queue with no entry is acknowledged and logged as an error
  (`[Queue] ... is not mapped`); none of its messages is processed. A new consumer in
  `wrangler.jsonc` and its entry ship in the same pull request.
- **A queue handler that throws loses no message.** The error is logged and the batch is sent back
  for retry; the consumer's `max_retries` and dead letter queue then apply. The audit handler still
  settles its own messages one by one (ack on success, retry on failure).

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
