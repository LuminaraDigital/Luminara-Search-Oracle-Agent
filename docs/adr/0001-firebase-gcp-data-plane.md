# ADR 0001: Firebase / GCP data plane for Luminara Suite

Status: **Accepted (Firestore)** - Tunji chose Firestore 2026-10-23; Engineering CEO SHIP on v2; **implementation not started** (no DATA_PLANE / dual-write until Tunji says start phase 2/3)
Date: 2026-10-23 (Australia/Sydney)
Author: Luminara Suite assistant
Companion inventory: `REPORT.md`, `PLAN.md` in this folder
Related: AGENTS.md; `specs/0007-auth-toll-fraud-anti-enumeration.md`; `worker/securityHardening.ts`; `docs/runbooks/d1-backup-dr.md`; Engineering CEO revise note 2026-10-23

## Context
Tunji wants industry-grade production with a Google Cloud / Firebase backend. Live Auth already uses Firebase project `luminara-suite` (staging: `luminara-suite-staging`). App data today is Cloudflare D1 (+ KV/R2/Queues/DOs). There is **no** approved cutover. Spec 0007 and `securityHardening` currently treat Firestore as out of stack.

This ADR does **not** authorize dual-write or migrate-off-D1 code. Parallel current-stack work continues (guest self-probe 522, #182, preprod L*, HMAC secret).

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

---

## 2. Edge access pattern (Workers → Firestore, no Admin SDK in git)

**Chosen pattern:** Worker calls **Firestore REST API** with a short-lived OAuth2 access token minted from a **service-account JWT** using **Web Crypto** (RS256) inside the Worker. No `firebase-admin` npm package on the Worker; no private key in the repo or client bundle.

| Piece | Rule |
|-------|------|
| Service account | Dedicated SA e.g. `suite-worker-firestore@luminara-suite.iam.gserviceaccount.com` with least privilege: Firestore data access only on needed collections (or Datastore User scoped later via IAM Conditions if available); **no** Owner/Editor |
| Secret | Full SA JSON **or** private key PEM in Wrangler secret `FIRESTORE_SA_PRIVATE_KEY` (+ `FIRESTORE_SA_CLIENT_EMAIL`, `FIRESTORE_PROJECT_ID`). Staging vs prod secrets separate. Never in `wrangler.jsonc` vars, never in git |
| Token cache | Cache access token in Worker memory / DO until ~5 min before expiry |
| Optional later | If JWT minting or IAM proves painful: thin **Cloud Run** proxy with Application Default Credentials; Worker holds only a shared HMAC to that proxy. Prefer direct REST first (fewer hops) |
| Client | Browser never talks to Firestore for durable audits in v1; always via Worker APIs (same as today) |

Rollback: `DATA_PLANE=d1` makes Worker skip Firestore clients entirely.

---

## 3. Region (hard go-live gate)

| Env | Firebase / GCP project | Firestore location |
|-----|------------------------|--------------------|
| Staging | `luminara-suite-staging` | **`australia-southeast1`** (Sydney) |
| Production | `luminara-suite` | **`australia-southeast1`** |

**Do not go live** on nam5 / other multi-region until Tunji explicitly accepts higher cost and latency tradeoffs for AU/Oceania/SEA. Location is immutable after first write - create empty DB in the right region before any dual-write.

Cloud Storage buckets: same region (`australia-southeast1`).

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

When `DATA_PLANE` first allows Firestore reads/writes on staging, the **same PR** must update:

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
1. **ADR approved** - store choice, region, cost ceiling acknowledged.
2. **Create Firestore** in `australia-southeast1` on staging; IAM SA; secrets via Wrangler only.
3. **Repository interface** + `DATA_PLANE=d1|firestore|dual` (default `d1`).
4. **Dual-write** Instant Audit **runs/findings** (+ users/workspace) on staging after cost gate; D1 remains SoT for reads. Signed audit receipts / HMAC verify stay on D1 (see domain map and Non-goals).
5. **Read cutover** on staging; soak; then production with rollback to D1 reads.
6. **Stop D1 writes** for cut-over collections; keep D1 for ledgers/receipts until a later ADR.

## Rollback
`DATA_PLANE=d1` restores D1 as source of truth. During dual-write, D1 stays current. Document Time Travel + R2 export before production cutover.

## Parallel work (not blocked by this ADR)
- Guest Check my site self-host 522 (CF ASSETS / in-Worker short-circuit) - staging PR
- #182 receipt freshness rebase; preprod L1/L3-L6, NEW-4, M3; `AUDIT_RECEIPT_ACCOUNT_HMAC_KEY` via wrangler secret put
- S1 durable Instant Audit history on **D1 first** (portable types for later dual-write)

## Approval
- [ ] Engineering CEO: **ship** / **no-ship** / **revise** on this v2 text
- [ ] Tunji: **Firestore** / **Cloud SQL** / **defer** (checkbox above)
