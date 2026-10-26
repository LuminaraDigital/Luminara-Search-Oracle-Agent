# Release #278 and batch 3

Status: CEO gate GO after two rounds (with the citation verifier and a release/security/payments audit applied). Awaiting the owner's approval; nothing here executes before it. Code references are to `origin/staging` at 77d1dd4 (review batch 2, PR #273). Items name functions, routes and tests rather than line numbers.

## Summary for the owner

Release #278 is ready and should go out before any batch-3 work, once Workers Builds can no longer deploy production and the Cursor agent is held off releases. Right after it, a small Release S ships the desktop 1.0.3 security fixes, the Electron security update, a non-production top-level config and the parked PRs. Batch 3 then ships in three releases: fixes (B3a-1), money changes (B3a-2) and the Stripe change on its own, with structural work (B3b) after.

## Where things stand (2026-10-26)

- `staging` = `main` + PR #273 + migration `0042_purge_plaintext_workspace_keys.sql`, deployed and checked live on staging.
- Release PR #278 (`staging` to `main`): draft, no failing or pending checks (the two production-only jobs are skipped on a PR), carries only #273.
- #276 (Play-safe Android legal pages, with #272 and #274) shipped to production on 2026-10-26 at 01:47 UTC, merged under the owner's login from a `cursor/` branch eleven seconds after it was opened.
- Every open PR is a draft (done 2026-10-26 at the owner's request): #278; held for this release #277, #255, #254, #189; held from batch 2 #161, #163, #164, #165, #166, #183, #190.
- The top-level config in `wrangler.jsonc` is production: same Worker name, production KV and D1, the `luminarasuite.com` and `www` custom domains, but `STRIPE_CHECKOUT_LIVE=false`. A bare `wrangler deploy` (a Workers Builds run or a person) ships a branch to production, and `/api/health` carries no version ID to tell.
- The native Android app (in Play review) hardcodes `https://www.luminarasuite.com/` and calls `/api/auth/sign-in`, `/api/auth/sign-up`, `/api/boot`, `/api/gateway/execute`, `/api/audit/scout-run`, `/api/findings`, `/api/privacy/export`, `/api/privacy/account` and the provider relay with a Bearer token; #278 changes `identify`, `accountBoot` and `findingsService`.
- Agents in this session cannot read production (D1, `wrangler deployments`); those are owner steps.

## Owner decisions

1. **Workers Builds** (`luminara-search-oracle-agent`, `luminara-search-oracle-agent-staging`, `luminara-search`). Leaving it connected is not an option for this release: every `main` push can redeploy production with `STRIPE_CHECKOUT_LIVE=false`, and pushing integration branches is only safe once this is settled. (a) Disconnect Git on all three, recommended; (b) keep Builds with production deploy, branch deploys and previews off.
2. **Dependabot security PRs.** `.github/dependabot.yml` targets `staging`, but security updates always use the default branch and ignore `target-branch`; npm's `dependency-type: "all"` does not cover transitive packages. (a) Make `staging` the default branch (security PRs and new agent PRs then target it; release PRs still name `main`; no workflow is scheduled on `main`), recommended; (b) retarget each security PR to `staging` by hand; (c) turn security PRs off, keep alerts, and open a periodic `npm update <pkg>` PR to `staging`; (d) leave as is. Under (a), (b) and (c), #255, #254 and #189 are retargeted to `staging` after the back-merge and ride in Release S; under (d) they stay drafts.
3. **Launchpad alerts.** (a) Delete the alert feature now, recommended; (b) rebuild alerts tied to the account; (c) the batch-2 Phase 0 design; (d) leave the flag off and revisit in 90 days.
4. **Split the large files now?** (`worker/index.ts` is 2,421 lines; the split brings no customer value.) (a) Now only memoize `identify` per request, add a CI check that stops `worker/index.ts`, `App.tsx` and `worker/telegramBot.ts` growing, and an AGENTS.md rule that new routes go in `worker/routes/`; the moves come after B3a, recommended; (b) the full split now with a two-day freeze for other agents; (c) skip.
5. **Delete the stale `luminara-search` Worker** after 7 days without requests, once no custom domain or route is attached. (a) Yes, recommended; (b) keep it disconnected.
6. **Who drives releases while the Cursor agent is active.** Its merges and release PRs run under the owner's login, so branch protection cannot tell them apart. (a) Cursor merges into `staging` only when `gh pr list --base main --head staging` is empty and never opens or merges into `main`; the rule goes into AGENTS.md and `.cursor/rules` in the merge-back PR, recommended; (b) pause Cursor until B3a ships; (c) Cursor drives all releases.
7. **Desktop installer signing.** There are no `WIN_CSC_*` secrets, so every new user of the unsigned installer sees a SmartScreen warning. (a) Do not block 1.0.3; decide before the next desktop marketing push, recommended; (b) Azure Trusted Signing (check eligibility); (c) an OV certificate now.

The owner merges #278, as decided earlier.

## Phase R: release #278 to production

Owner steps are marked (owner). Agent steps use GitHub only, or public production endpoints where the owner agrees.

R0. Hold the Cursor agent off staging and main until the R9 merge-back PR carrying the decision-6 rule has merged, not only until #278 ships (owner); otherwise nothing stops it opening a `staging` to `main` PR right after the deploy.

R1. Fence the release: done. Before R6, `gh pr list --state open --json number,isDraft` must show #278 as the only PR that is not a draft.

R2. Workers Builds per decision 1 (owner), confirmed before R6. Then `npx wrangler deployments list --env production` (owner): note the active version ID (the #276 CI deploy) and confirm no Builds deployment came after it.

R3. Production reads (owner, Git Bash, or the D1 console if wrangler crashes): `wrangler d1 migrations list luminara-users --remote --env production` shows only 0042 pending; count rows with a plain-text `keys` member and rows with invalid JSON; the licence-key count from `docs/runbooks/d1-backup-dr.md`; cache-busted `/api/health` and its `stripeCheckout` value; a Telegram `getWebhookInfo` baseline (so R7 can tell new errors from old).

R4. Staging click-tests (owner), #278 checklist items 4 to 11: real-browser sign-in, sign-out and account switch; paid account after an audit; own-key gate; idle tab; Mini App on Telegram iOS, Android, Desktop, macOS and web; payment rails on staging (trial refused on a paid plan, licence key and TON testnet credit once, Mini App Stars purchase, Stars refund, Stripe test checkout); bot (private reply, long reply, sticker, group `/plan`); Oracle ("my DA is 40" kept, invented figure noted, forced dream run metered); a real MCP client on staging `/mcp`; a lapsed account lists and revokes keys; packaged desktop build against staging. If an Android build can point at staging, run its sign-in, audit and findings there too.

R5. Pre-merge checks (agent): `origin/staging` is 77d1dd4; `gh pr list --base main --head staging` shows only #278; `git log --first-parent 4022fa2..origin/staging` shows only 77d1dd4; `git diff --stat origin/staging...origin/main` is empty; `gh pr checks 278` has no failing or pending check (two production-only jobs show as skipped); the two `check-staging-deploy.mjs` lines from `deploy-cloudflare.yml` pass for 77d1dd4.

R6. Merge (owner): mark #278 ready, then `gh pr merge 278 --merge --match-head-commit 77d1dd4fd3713bf8db0b5ac7a9876e9e9a1e5883`. Leave `staging` alone until production is green. CI runs in about three minutes: release checks, `npm ci`, secrets, `validate-env --prod`, typecheck, lint, tests, build, D1 Time Travel bookmark, migrate 0042, `deploy --env production`, `smoke --prod`. Done when the run is green, the log shows the bookmark, 0042 applied and `[SmokeCheck] [SUCCESS]`, and the dashboard's active version matches the log's version ID.

R7. Post-deploy:
- (agent, with the owner's yes to probe public production endpoints) Cache-busted `/api/health`: `ok`, and `stripeCheckout` equal to the R3 value (false means a Builds deploy overwrote production). Unsigned `/api/findings` 401; `POST /api/auth/session` with `Origin: https://evil.example` 403 `CSRF_REJECTED`; `/api/q402/supported` 404.
- (owner) Five minutes after deploy, repeat the R3 plain-text count; if above 0, run once `UPDATE user_workspace SET payload = json_remove(payload,'$.keys') WHERE json_valid(payload) AND json_type(payload,'$.keys') IS NOT NULL` (identical to migration 0042), then recount to 0. If the R3 count was above 0, publish the "re-enter your own keys on a new device" note where customers see it.
- (owner) `wrangler tail --env production` for 30 minutes: `csrf_rejected`, `auth_unavailable`, `oracle_output_redacted`, `order_already_applied`, `stars_refund_partial`, `license_trial_refused`, `mcp_batch_refused`, `kv_counter_write_failed`, 5xx. Expected noise: `csrf_origin_missing` and 409s on `PUT /api/workspace` from tabs opened before the release.
- (owner) The Play-review Android build on production with a test account: sign-up, sign-in, audit, findings, export, delete account. Repeat this in every release checklist while the app is in review.
- (owner) Telegram `getWebhookInfo` against the R3 baseline, menu button and BotFather Mini App URL on `https://www.luminarasuite.com/`; Stripe webhook deliveries 2xx; the Play-safe pages from #276 in a real browser (a curl 200 proves nothing on an SPA); the licence-key count equals R3.

R8. Rollback by failure type:
- Failure before "Apply D1 migrations": production unchanged; fix and re-run.
- Failure after migrating: the previous Worker is safe on the migrated database; re-run the failed jobs. A re-run prints a post-migration bookmark; the first attempt's bookmark is the pre-migration one.
- Bad behaviour after deploy: `wrangler rollback <R2 version ID> --env production -y`, picked by ID (the version list also holds Builds uploads). The previous Worker reads purged data fine but goes back to last-write-wins sync and accepts plain-text `keys` from cached old clients, so redo the R7 recount after re-releasing.
- Payment-safe webhooks during the deploy gap: Telegram payment updates are handled before the 200 and a 503 makes Telegram resend; Stripe retries any 5xx; neither depends on 0042.
- D1 Time Travel restore is not a rollback option for this release: an in-place restore rewinds the payment and privacy claim tables (`ton_credited_tx`, `ton_pending_orders`, `stars_charges`, `stars_credited_charges`, `stripe_credited_sessions`, `license_key_claims`, `license_redemptions`, `referral_rewards`, `firestore_erase_ledger`, `signed_request_nonces`) while grants and licence keys stay in KV, so redelivered payments would credit twice, licence keys would become claimable again and erase tombstones would vanish. Only with CEO approval and a reconciliation runbook (export rows newer than the bookmark from those tables, restore, re-insert, reconcile with Stripe and TON).
- Git: `git revert -m 1 77d1dd4` on a branch from `staging`, keeping the migration file. Area A alone: `git revert 32366fa`, then `git revert 516b332`, then `git revert -m 1 ec2211d` (verified to apply cleanly in that order).

R9. After the release (agent unless noted):
- Merge `main` back into `staging` with a merge commit (PR `main` to `staging`), carrying the decision-6 rule in AGENTS.md and `.cursor/rules`.
- Correct `docs/runbooks/d1-backup-dr.md` (Time Travel restores in place and rewinds the payment tables; add the reconciliation steps) and add `docs/runbooks/release-checklist.md` with the owner checklist, the licence-key count and the Android check.

## Release S (right after the merge-back)

Contents, each a small PR into `staging`, merged one at a time only while no release PR is open, each followed by a green staging deploy and smoke:
- **Tooling (P1):** `scripts/smoke-check.mjs` runs wrangler as `spawnSync(process.execPath, [wranglerBin, ...])` with stdin ignored and `windowsHide`, retries once on a crash exit and reports a crash apart from "apply migrations"; `tests/prePushHook.test.ts` stubs `npm` on the fixture PATH; `tests/forbiddenTokens.test.ts` uses `execFileSync`. Test: a source pin, and `npm run smoke:staging` on Windows.
- **Non-production top-level config (P1):** today the top level holds production KV and D1, the `luminara-desktop-releases` bucket, the `luminara-audit-jobs` producer and consumer and the `0 8 * * *` cron, and `env.production` inherits `triggers` (and any Durable Object `migrations`) from it. So: (a) first copy `triggers` and any inherited DO `migrations` into `env.production` and `env.staging`; (b) the top level then keeps no production KV, D1 or R2 ids, no queues, no crons and no routes, and sets `workers_dev: false` and `preview_urls: false`; (c) delete `npm run db:migrate` or pin it with `--env` (today it migrates production D1 without naming an env); (d) a config test asserts both shapes, and the tests that read `wrangler.jsonc` (`stagingSafeguards`, `preprodFlags`, `moneyInvariants`, `featureSwitches`, `appCheck` and others) are updated; (e) gate: the binding list from `wrangler deploy --env production --dry-run` is identical before and after, and so is staging's. `/api/health` gains the deployed version ID through a `version_metadata` binding declared in each env (bindings are not inherited), and `smoke --prod` asserts it.
- **Desktop R1 (P2):** `isPermissionGranted` grants `openExternal` only when the requesting URL is an allowed app page; the window-open handler opens external links only from the main window. Test in `tests/electronSecurity.test.ts`: `tg:` from `https://evil.example` refused, from the app granted.
- **Version 1.0.3:** `package.json` 1.0.2 to 1.0.3.
- **Dependencies:** #255 (electron 44.9.1, required in any 1.0.3 build), #254, #189, #161, #190 after `@dependabot recreate` (its electron bump is superseded). Close #164 (`@types/node` 26 while CI and runtime are Node 22) and ignore `@types/node` majors. #165 waits for a paired vitest 5 bump. Defer #163 (TonConnect 5, live TON rail) and #166 (marked 18, report rendering): version updates with no customer gain.
- **#277** (AEO `/compare` and `/best`; its only auth edit adds `'COMPARE'` to `PUBLIC_APP_VIEWS`).

Then the Release S `staging` to `main` PR, checklist, merge (owner), and `desktop-v1.0.3` (owner):
- Before tagging: `npm run desktop:dist:win -- --publish never` from the release merge SHA and click-test the unpacked app against staging and production (Google popup, email sign-in, Stripe and a TON wallet link in the system browser, mailto, offline retry, the update check).
- Tag: `git tag desktop-v1.0.3 <release merge SHA>`; the tag publishes the GitHub release that the updater reads and writes straight to production R2. Then test the 1.0.2 to 1.0.3 update and `/api/desktop/latest`.
- 1.0.3 cannot be rolled back (electron-updater does not downgrade); the packaged click-test is the gate. Keep the 1.0.2 installer on R2. Never push a bare `v*.*.*` tag (it fires the Android release).

## Batch 3

Same method as batch 2: each PR from current `staging` in its own local worktree, failing test first, specialist review (two rounds at most), whole-branch thermo-nuclear, ponytail and pstack pass, CEO gate; no more than four agents at once; branches are pushed only once decision 1 is (a) or (b); nothing merges into `staging` while a release PR is open.

### B3a-1: fixes

| PR | Sev | Scope | Fix | Failing test first |
|---|---|---|---|---|
| gateway | P3, ship first | `/api/gateway/execute` passes a body `runId` to `taskLifecycle`, which updates `audit_runs` by id alone; a run marked `completed` is then skipped by `processAuditJob` | Ignore the body `runId` entirely (no client sends one; Android's `GatewayExecuteRequest` has none, the web app never calls the route) | `tests/taskLifecycle.test.ts` or the gateway route test: a body `runId` leaves an existing queued run untouched |
| sync | P2 privacy | A push in flight at sign-out can apply the account's storage and decrypt its keys into the browser on a 409; `applyPayload` awaits `decryptKeyBag` between writing storage and keys; `pushNow`'s success path rewrites the meta after a clear | Capture `clearSeq` in `pushNow`; check it again after the decrypt inside `applyPayload` on both the `runPull` and `pushNow` paths; gate `writeMeta` on it; recapture after `runPull`'s own account-switch clear | `tests/workspaceSyncVersion.test.ts`: hold the PUT, `clearLocalWorkspace()`, resolve a conflict: DNA, keys and meta stay empty; same with the clear landing during the decrypt |
| boot | P2 | Before account linking the Mini App boot sends only the Bearer while other calls resolve to the Telegram identity, so quota and workspace alternate | `fetchBoot` also sends `x-telegram-init-data` when present | `tests/signedInBoot.test.ts`: the boot carries initData; and the Mini App still gets a session cookie (`reuseOrMint` is Firebase-only) |
| CSRF | P2 security | A missing Origin is still allowed on the session-setting routes | `POST /auth/session` and the `/telegram/auth` branch (and `/telegram/invoice`, which shares it) require the `application/json` media type, ignoring parameters such as `; charset=utf-8`; logout keeps the allowance; delete the `shortcut:` comment and the README line that says a missing Origin passes | A `text/plain` cross-site POST with no Origin is refused; `application/json; charset=utf-8` passes. Checklist signs in on all five Telegram clients and desktop |
| auth clock | P3 | The fresh-token check compares JWT `exp` with the device clock | Measure the clock offset from the Worker's `Date` header (or only on a forced `getIdToken(true)`), not `exp - iat` at receipt, which overstates a cached token's life | `tests/cachedIdTokenExpiry.test.ts` with a skewed device clock |
| logs and tidy | P3 | Event names and fields; duplicate TON header builders; MCP minting on unnamed unlimited plans | `credential_auth_rejected` for wrong passwords, provider 5xx and network failures logged with status; `rail` on `order_already_applied`; days on `stars_refund_partial`; TON calls via `workerFetchWithAuthRetry`; `canMintMcpKeys` from entitlements like `canCreateShareLinks` | Pinned log JSON updated; `quotaSnapshot.test.ts`: unlimited headers with no boot give no MCP minting |

### B3a-2: money

| PR | Sev | Scope | Fix | Failing test first |
|---|---|---|---|---|
| budgets | P2 money | Paid-call metering is written three times (MCP, Oracle chat, queued audit) and already differs; research-log cache hits and `DFS_AUTH_MISSING`/`DFS_PATH_FORBIDDEN` bill 1 cent without calling the provider | First pin today's `cost_events` rows on all three surfaces (cents, `credentialKind`, `runId`, BYOK 0). Then `meterPaidCall()` in `worker/budgets.ts` for cost, soft alerts and the alert row, and no cost event for those three codes. The halt scope stays per surface and is written down: MCP blocks every tool when halted, Oracle chat only paid tools, the queue only the paid call | The pins stay green; a `RESEARCH_LOG_HIT` call records nothing; a halted queued call records the incident and audit row |
| referrals | P2 money | A spent referral credit is never returned: on that path `checkHostedQuota` returns no `meterKey`, so `refundMeteredQuota` refunds nothing; seven call sites in five files (`auditScoutRun` twice, `dreamingService` twice, `pagespeedRoute`, `providerRelay`, `recheckFix`) | The spend returns a spend id and `bonusRewardId` on `QuotaStatus`; the refund is a D1 batch that inserts into a refund ledger with `INSERT OR IGNORE` and adds the credit back only if that row was new; `AuditRunRecord` stores the reward id; fix callers that gate on `meterKey` (`auditScoutRun`, `providerRelay` `releaseUnmeasured`); update the README dreaming line | `tests/referrals.test.ts`: spend past the cap, refund, credit restored; two concurrent refunds restore one credit |
| queue | P3 | The queued-audit redelivery guard is check-then-act | Atomic claim `UPDATE ... SET status='running' WHERE id=? AND status<>'completed' AND (status<>'running' OR COALESCE(updated_at,0)<?)`; on zero changes for a fresh `running` row, `message.retry({ delaySeconds: lease })` instead of acking | Two concurrent `processAuditJob` calls make one paid call; a stale `running` run is reclaimed |

### Stripe (its own release)

`creditCheckoutSession` recognises its own retry only while `paymentMethod === 'stripe'`, so a TON, Stars or licence write between a half-landed Stripe write and its redelivery double-credits, or refunds the card while keeping the days. Fix: `writeSubscriptionRecord` appends `opts.orderId` to `appliedOrders` itself; Stripe passes `sessionId` (reversals `rev_<sessionId>`); check `hasAppliedOrder` before the downgrade refusal; keep the claim when `appliedOrderExpiry` shows the write landed; on replay never recompute `grantedUntil` from the current expiry (it would include later TON days). Tests in `tests/stripePayment.test.ts`: a TON write and a Stars write between the half-write and the redelivery credit once; a refund ten days into the TON period removes nothing; reversal case. Gate: a Stripe test-mode redelivery drill (`stripe events resend`) for checkout and refund on staging. The follow-up that would read `stripeSessions` only as legacy entries is dropped.

### B3b: structure

| Set | Scope | Notes |
|---|---|---|
| D3 session cookie | Write `__Host-session` and clear `__session` with two `Set-Cookie` headers (`Headers.append`; `json()` takes a plain record); read the new name, then the legacy one with a `legacy_session_cookie` log; the boot mints a fresh id and revokes the legacy sid instead of reusing it; logout revokes and clears both; update the three `WWW-Authenticate` strings | Second PR 14 days later (`SESSION_COOKIE_MAX_AGE`), once the log is near zero, removes the legacy read. Residual until then: a planted legacy cookie is still honoured on browsers that have no `__Host-` cookie. No sign-outs, no client release |
| D7 hosted completion | `worker/hostedCompletion.ts` with one total deadline across all provider attempts (about 20 s, leaving time inside the 30 s `waitUntil` for the send and the refund), and the Telegram bot moved onto it | Idea Scout, dreaming, the Oracle SSE call and `freeAiAnswer.ts` `chat()` wait for the `hosted_completion` logs; no new Gemini fallback for dreaming |
| D6 split (decision 4) | Under (a): memoize `identify` per request (extending `identifiedForRequest`), the CI growth guard and the AGENTS.md rule now; the route-table moves, the `telegramBot.ts` payments and support-desk moves and the `App.tsx` hooks after B3a, as pure moves by checked-in codemod (no test edits, clean `git diff --color-moved`) | |
| D1 Launchpad (decision 3) | (a) delete the alert feature, or (b) alerts tied to the account, claimed per milestone, sent from `waitUntil` with timeouts | The flag stays off until a design passes on staging |
| Ops | Dependabot per decision 2; `luminara-search` per decision 5; signing per decision 7 | Owner work |

## Dropped, with reasons

- Outbound SMS/email cap on a Durable Object (was B3a PR 8): SMS is off in production (`OTP_SMS_ENABLED=false`) and email goes through Firebase with a 200 a day cap; failing closed would add an outage mode for password reset and email verification. A README line records that the atomic cap is a precondition for turning SMS on.
- F2 one honesty loop: the bot loop does five extra jobs and its separate metric list is deliberate.
- F5, F8, F10, F11b tidy: only when the file is already open for other work.
- F7 Telegram group guard extraction: folded into the D6 `telegramBot.ts` split.
- F9 `writeOrderOnce`: the TON and licence catch blocks differ by rail; reassess after the Stripe release.
- R2b early token wipe (not a bug as traced), R2c freellm key without a base URL (the server meter refuses), R3 "Around 40." in the Oracle (fixing it trades a false positive for a false negative), R4a MCP dream force (every MCP caller is Growth or above), R6 stacked Stars refunds (documented; needs per-charge segments).

## Order and gates

R (#278), then Release S (and `desktop-v1.0.3`), then B3a-1, B3a-2, the Stripe release, and B3b. Each release: typecheck, lint (0 errors, no new warnings on added lines), the full suite, coverage, build and the pre-push hook on every PR; staging deploy green and live staging checks; the owner checklist including the Android check; CEO gate on the release diff; the release PR stays a draft until its checklist passes.
