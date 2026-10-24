# ADR 0001: Firebase / GCP data plane for Luminara Suite

Status: **Accepted (Firestore)**. Tunji chose Firestore 2026-10-23. Engineering CEO SHIP on v2. Tunji approved phase 2/3 implementation on 2026-10-24. `DATA_PLANE` defaults to `d1` and is unset in wrangler. Dual-write is not enabled on staging or production.
Date: 2026-10-23 (Australia/Sydney)
Author: Luminara Suite assistant
Companion inventory: `REPORT.md`, `PLAN.md` in this folder
Related: AGENTS.md; `specs/0007-auth-toll-fraud-anti-enumeration.md`; `worker/securityHardening.ts`; `docs/runbooks/d1-backup-dr.md`; Engineering CEO revise note 2026-10-23

## Context
Tunji wants industry-grade production with a Google Cloud / Firebase backend. Live Auth already uses Firebase project `luminara-suite` (staging: `luminara-suite-staging`). App data today is Cloudflare D1 (+ KV/R2/Queues/DOs). There is **no** approved cutover. Spec 0007 and `securityHardening` currently treat Firestore as out of stack.

Phase 2/3 adds the repository and the flag. The flag stays `d1` until the cost gate below is recorded and Tunji enables `dual` on staging. Parallel current-stack work continues (guest self-probe 522, #182, preprod L*, HMAC secret).

## Decision (recommended default - Tunji checkbox)
**Adopt Cloud Firestore** under `luminara-suite` / `luminara-suite-staging` as the long-term primary application database for product domains that map cleanly to documents, with **Cloud Storage** for large artifacts (PDF exports, bulk downloads). Keep **Cloudflare Workers** as the edge API (SPA, probes, webhooks, rate limits). Keep **D1 longer** for append-only money ledgers and any path that needs multi-row SQL CAS until a later phase.

Tunji may instead choose **Cloud SQL (Postgres)** - see SQL fork criteria below.

### Tunji decision
- [x] **Yes - Firestore** (recommended default in this ADR)
- [ ] **Yes - Cloud SQL Postgres** instead
- [ ] **No / defer** - Firebase stays Auth (+ App Check) only; D1 remains SoT

---

## 1. Domain map (D1 today → Firestore or stay D1 longer)

| Domain (D1 tables / surfaces) | Proposed target | Why |
|-------------------------------|-----------------|-----|
| **Identity & workspace** - `users`, `user_workspace`, `organizations`, `organization_memberships`, `teams`, `org_audit_logs` | Firestore: `users/{uid}`, `workspaces/{uid}`, `orgs/{orgId}`, `orgs/{orgId}/members/{uid}` | Doc-shaped; Auth uid is natural key; high read on boot |
| **Subscriptions / plan flags** - today mostly KV `user:*` + D1 license tables (`license_*`, `launchpad_subscriptions`) | Firestore fields on `users/{uid}` + `subscriptions/{uid}` | Read with workspace; write from Stripe webhook Worker |
| **Instant Audit / Past reports** - `audit_runs`, `audit_findings`, `visibility_snapshots`, `ai_answer_captures`, `shared_reports`, `share_teasers`, `win_shares` | Firestore: `audits/{id}`, `audits/{id}/findings/{id}`, `sharedReports/{id}` (+ Storage for heavy HTML/PDF) | Operator priority #1; S1 on D1 first, then dual-write this family |
| **Projects / MCP product surface** - `projects`, `project_*`, `agent_reports`, `mcp_action_requests`, `api_keys` | Firestore: `projects/{id}`, subcollections; `apiKeys/{id}` hashed | Document + subcollection fit; API keys stay hashed secrets |
| **Domain proofs / trust** - `domain_verifications`, `proof_anchors`, `proof_schedules`, `trust_receipts`, `signed_audit_receipts`, `scout_receipts` | **Stay D1 longer** (phase 5+), then optional mirror | HMAC verify path + revoke idempotency want strong single-row update semantics; public verify is hot |
| **Citation Watch** - `citation_watches`, `citation_watch_runs` | Stay D1 longer, or Firestore after Queues tick is stable | Cron/queue throughput + claim/CAS; migrate after M3 |
| **Stripe / TON / Stars ledgers** - `stripe_credited_sessions`, `ton_*`, `stars_*`, `chain_invoices`, `invoice_reconcile_runs`, `payment_support_requests`, `cost_events`, `budget_*` | **Stay D1 longer** (last to move) | Append-only money; CAS / unique payment ids; highest cutover risk |
| **Referrals** - `referral_codes`, `referral_attributions`, `referral_rewards` | Stay D1 longer or Firestore late | Reward CAS; not blocking Instant Audit |
| **Memory / RSI / dreams / community** - `memory_*`, `business_memories`, `rsi_*`, `dream_*`, `community_feed_*`, `user_missions`, `user_progression`, Idea Scout, niche pulse, GSC tokens, etc. | Defer; stay D1 (or KV) until core audits+users cut over | Large surface; low MVP criticality |
| **Privacy / analytics** - `privacy_jobs`, `product_analytics_events` | Stay D1 or export-only | Job queues; analytics can stay CF |
| **Edge-only** - KV rate limits, DO `DAILY_QUOTA` / `ORACLE_SESSION`, R2 desktop releases, anonymous probe | **Stay on Cloudflare indefinitely** | Edge latency; no GCP benefit |

Phase 2/3 writes two of those collections:

- `users/{userId}`, where `userId` is the login id (`fb:{uid}` or the Telegram id). The document holds the profile columns. `email_unsub_token` stays on D1.
- `audits/{docId}` for `audit_history`. `docId` is `{accountId length in base 36}.{accountId}.{entryId}` because an entry id is unique per account, not globally.

The mirrored writes are the sign-in profile upsert and `PUT /audits/history`. Account link and privacy erase still write D1 only. Run the backfill after those writes, until those paths use the repository.

---

## 2. How the Worker authenticates to GCP

Org policy on the staging project blocks service account JSON keys. The Worker never holds one. There is no `firebase-admin` package on the Worker. The browser never talks to Firestore. Durable writes stay on the Worker, which calls the Firestore REST API.

**Decision: Workload Identity Federation.** The Worker signs a short-lived OIDC JWT with its own RSA key (Web Crypto, RS256). Google STS exchanges that JWT for a federated token. The Worker then calls `generateAccessToken` to impersonate `suite-worker` and caches the access token until five minutes before `expireTime`. Firestore REST calls send that token as `Authorization: Bearer`.

The signing key is an application key the Worker controls. It is not a Google service account key. Wrangler secret `GCP_OIDC_SIGNING_KEY` holds the PKCS#8 PEM. The matching public JWK is the var `GCP_OIDC_PUBLIC_JWK`. `GET /api/gcp-oidc/.well-known/openid-configuration` and `GET /api/gcp-oidc/jwks` answer 404 until the issuer and the public JWK are set. A JWK that contains `d`, `p`, `q`, `dp`, `dq`, `qi`, or `oth` is refused and is not written to the response.

A Cloud Run proxy that runs as `suite-worker` was the other keyless route. The proxy would keep the Google credential inside GCP, and the Worker would call it with a shared HMAC. That adds a regional hop, a second service to patch, and another timeout on every mirror write. Direct Firestore REST keeps the mirror to one hop. Switch to the proxy if STS latency or issuer reachability fails a staging soak.

| Piece | Rule |
|-------|------|
| Service account | `suite-worker@PROJECT_ID.iam.gserviceaccount.com`. Role `roles/datastore.user` on that project. No Owner or Editor. |
| Worker signer | Secret `GCP_OIDC_SIGNING_KEY`. PKCS#8 PEM. Not a Google service account key. Never in git or `wrangler.jsonc`. |
| Public JWK | Var `GCP_OIDC_PUBLIC_JWK`. Public fields only. |
| Issuer | Var `GCP_OIDC_ISSUER`. `https`, no userinfo, query, or hash. Staging: `https://staging.luminarasuite.com/api/gcp-oidc`. |
| Subject | Var `GCP_OIDC_SUBJECT`. Example: `suite-worker`. The provider's attribute condition pins `assertion.sub` to this value. |
| Audience | Var `GCP_WIF_AUDIENCE`. The Workload Identity provider resource name. |
| Impersonation | Var `GCP_IMPERSONATE_SERVICE_ACCOUNT`. |
| Project | Var `GCP_PROJECT_ID`. Leave unset while `DATA_PLANE` is `d1`. |
| Token cache | Reuse the access token until five minutes before `expireTime`. |
| Flag | `DATA_PLANE` is `d1` (default), `dual`, or `firestore`. Any other value logs a warning and behaves as `d1`. |

`dual` reads D1 and writes D1. The Firestore write runs in `waitUntil`, times out after 4 seconds, and logs `op`, `entity`, `id`, `outcome`, and `latency_ms`. The log has no email, report text, bearer token, or signing key. A Firestore error or timeout does not change the HTTP response. `firestore` is implemented behind the flag and is not set in wrangler.

Rollback: `DATA_PLANE=d1`, or unsetting the var, skips Firestore clients entirely.

### Operator checklist (staging)

Run this list on `luminara-suite-staging` only. Do not create a service account key. Do not target `luminara-suite` in this phase.

1. Confirm the existing Firestore database `(default)` in `australia-southeast2` on `luminara-suite-staging`. Do not recreate it.
2. Create a Workload Identity Pool and an OIDC provider. Issuer URI: `https://staging.luminarasuite.com/api/gcp-oidc`. Allowed audience: the provider resource name. Attribute mapping: `google.subject=assertion.sub`. Attribute condition: `assertion.sub == "suite-worker"`.
3. On a trusted machine, generate an RSA key pair. Store the private PKCS#8 PEM with `npx wrangler secret put GCP_OIDC_SIGNING_KEY --env staging`. Put the public JWK (`kty`, `n`, `e`, `kid`, `alg`, `use`, and no private fields) in the staging var `GCP_OIDC_PUBLIC_JWK`.
4. Set staging vars: `GCP_OIDC_ISSUER`, `GCP_OIDC_SUBJECT` (`suite-worker`), `GCP_OIDC_KEY_ID` (the JWK `kid`), `GCP_WIF_AUDIENCE`, `GCP_IMPERSONATE_SERVICE_ACCOUNT` (`suite-worker@luminara-suite-staging.iam.gserviceaccount.com`), `GCP_PROJECT_ID` (`luminara-suite-staging`). Leave `DATA_PLANE` unset.
5. Grant `roles/iam.workloadIdentityUser` on that service account to the pool principal. Grant `roles/datastore.user` on project `luminara-suite-staging` to the service account.
6. Create composite indexes on collection `audits`: `accountId` ASC + `measuredAt` DESC, and `accountId` ASC + `domain` ASC + `measuredAt` DESC.
7. Dry-run the backfill below, read the counts, then apply it to staging.
8. Record the section 4 cost estimate. After that, and after account-link and privacy erase are mirrored, set staging `DATA_PLANE=dual`. Leave production unset.

The Worker serves one public JWK. A rotation that needs two keys at once is a later change.

### Backfill against staging

The export files contain email addresses. Keep them out of git and delete them after the run. Do not select `email_unsub_token`.

```
npx wrangler d1 execute luminara-users-staging --env staging --remote --json \
  --command "SELECT id, source, account_id, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at, welcome_sent_at, email_opt_out_at FROM users;" \
  > users.json
npx wrangler d1 execute luminara-users-staging --env staging --remote --json \
  --command "SELECT account_id, id, domain, measured_at, updated_at, entry_json FROM audit_history;" \
  > audits.json
npm run db:backfill:firestore -- --from-users users.json --from-audits audits.json --project luminara-suite-staging
npm run db:backfill:firestore -- --apply --from-users users.json --from-audits audits.json --project luminara-suite-staging
```

The first `npm run` is the dry run (counts and sample field names, no Firestore calls). `--apply` requires `--project`. `--project luminara-suite` exits with an error unless `--i-understand-prod` is also passed. Document ids are deterministic, so running the apply twice upserts the same documents.

---

## 3. Region (hard go-live gate)

| Env | Firebase / GCP project | Firestore location |
|-----|------------------------|--------------------|
| Staging | `luminara-suite-staging` | **`australia-southeast2`** (Melbourne) |
| Production | `luminara-suite` | **`australia-southeast2`** (Melbourne) |

Production Firestore is already in `australia-southeast2`. Location is immutable after the database exists, so staging uses the same region. Do not recreate either database in `australia-southeast1`, nam5, or another multi-region unless Tunji accepts a new database and the cost.

Cloud Storage buckets for later artifact work: `australia-southeast2`.

---

## 4. Cost gate (before dual-write phase)

**Before enabling dual-write on staging**, measure or bound:

| Operation | Bound to estimate |
|-----------|-------------------|
| Instant Audit complete | Writes: 1 audit doc + N findings (cap N, e.g. 50) + 1 workspace touch. Reads: 0-2 for upsert. |
| Past reports list | Reads: 1 query page (e.g. 20 docs) per open of Past reports. |
| Sign-in boot | Reads: 1 user + 1 workspace (not full audit history). |

**Open question for Tunji:** If the projected **Firestore bill for Suite alone** exceeds **A$50 / month** at current staging traffic × 10, pause dual-write and revisit Cloud SQL or tighter denormalization.

Record the estimate in the enablement PR description. No dual-write without that number (or an explicit “skip cost gate” from Tunji).

---

## 5. SQL fork - Firestore vs Cloud SQL (decision criteria)

Choose **Firestore** if most of these are true:
1. Primary access is by `account_id` / `audit_id` document gets, not wide SQL joins.
2. You accept denormalized summaries on the audit doc instead of JOIN `audit_runs`×`findings`.
3. Multi-document transactions stay within Firestore limits (receipt revoke can stay on D1 longer).
4. You want the standard Firebase console + security rules story alongside Auth.
5. Mobile / realtime listeners matter within 12 months.

Choose **Cloud SQL (Postgres)** if most of these are true:
1. Payment ledger CAS and referral reward SQL must move with the same engine as audits.
2. Reporting / investor exports need ad-hoc SQL joins across audits, findings, and billing.
3. You want near 1:1 migration from existing D1 migrations (Hyperdrive or Cloud SQL Auth Proxy from Worker/Cloud Run).
4. Public `POST /audit-receipts/verify` must stay a single strong row update in SQL from day one of cutover.
5. Team prefers SQL runbooks over document modeling.

**This ADR’s recommended default is Firestore** for users + Instant Audit history first, with money/receipts **staying on D1 longer**. If Tunji picks Cloud SQL, replace sections 1-2 with Postgres schema + Hyperdrive/Cloud SQL Auth Proxy and keep the same phased flag/`DATA_PLANE` idea.

---

## 6. Spec debt (must flip in the first enablement PR)

Phase 2/3 does not set the flag on staging. When `DATA_PLANE` first allows Firestore reads or writes on staging, that same PR must update:

| File | Change |
|------|--------|
| `specs/0007-auth-toll-fraud-anti-enumeration.md` | Narrow the non-goal: Cloud Functions/Firestore remain non-goals for **auth fraud controls**; add pointer that **product data** plane is governed by this ADR (once approved and filed under `specs/` or `docs/adr/`). |
| `worker/securityHardening.ts` | Replace “There is no Cloud Firestore” with accurate stack note: Auth via Firebase ID tokens; durable data via D1 and/or Firestore per `DATA_PLANE`; still no Admin SDK private key in client. |
| `docs/runbooks/d1-backup-dr.md` | Add companion section or new `docs/runbooks/firestore-backup-dr.md`: scheduled export, region, who runs restore; D1 Time Travel remains for domains still on D1. |
| `AGENTS.md` / `README.md` architecture blurb | One paragraph: Workers edge; Auth Firebase; data D1 and/or Firestore per ADR. |
| `firebase.json` / rules | Add Firestore rules file when DB is created (deny-all default; Worker SA uses Admin-equivalent REST with IAM, not client rules for server writes). |

This ADR is filed at `docs/adr/0001-firebase-gcp-data-plane.md`.

---

## Non-goals
- Silent cutover or dual-write without Tunji yes + CEO ship on this ADR
- Firebase Admin private key in client or git
- Replacing Firebase Auth (already correct)
- Pausing CF hardening (guest 522, #182, L*, HMAC) for this ADR
- Moving Stripe/TON ledgers or receipt HMAC verify off D1 in phase 1-3

## Phased cutover (only after yes)
1. **ADR approved.** Store choice and region are recorded. The cost ceiling still gates enablement.
2. **Firestore exists** in `australia-southeast2` on `luminara-suite` and `luminara-suite-staging` (operator, before this phase): deny-all rules, PITR, delete protection, service account `suite-worker`.
3. **Repository and flag.** The code is in the tree. `DATA_PLANE` defaults to `d1`. Wrangler does not set it.
4. **Enable dual-write** on staging after the cost gate, the checklist in section 2, and a follow-up that mirrors account link and privacy erase. D1 stays the source of truth for reads. Signed audit receipts stay on D1.
5. **Read cutover** on staging, then production, with rollback to D1 reads.
6. **Stop D1 writes** for the cut-over collections. Ledgers and receipts stay on D1 until a later ADR.

## Rollback
`DATA_PLANE=d1` restores D1 as source of truth. During dual-write, D1 stays current. Document Time Travel + R2 export before production cutover.

## Parallel work (not blocked by this ADR)
- Guest Check my site self-host 522 (CF ASSETS / in-Worker short-circuit) - staging PR
- #182 receipt freshness rebase; preprod L1/L3-L6, NEW-4, M3; `AUDIT_RECEIPT_ACCOUNT_HMAC_KEY` via wrangler secret put
- S1 durable Instant Audit history on **D1 first** (portable types for later dual-write)

## Approval
- [ ] Engineering CEO: **ship** / **no-ship** / **revise** on this v2 text
- [ ] Tunji: **Firestore** / **Cloud SQL** / **defer** (checkbox above)
