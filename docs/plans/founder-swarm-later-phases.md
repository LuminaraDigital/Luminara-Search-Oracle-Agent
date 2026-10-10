# Founder Swarm and Business Brain: later phases (Track SW)

**Part of:** Track SW v0.3. The plan is [`founder-swarm-business-brain-additive-plan.md`](./founder-swarm-business-brain-additive-plan.md); its first page lists every file.  
**Date:** 2026-10-10  
**This file holds:** sections 10 to 13 and 15: SW5 (pay-per-audit), SW6 (Jobs), SW7 (live rooms and invites), SW8 (Watches and desktop), SW10 (gated designs). These are designs. Each phase starts with a re-baseline task, and none starts before its Needs line is met. The rules of section 2 of the plan bind every task here.  
**Section numbers** are the plan's own, so they do not start at 1 here.

---

## 10. SW5 - Pay-per-audit for outside agents (x402)

**Goal:** an AI agent with no Luminara account can pay a small fixed price for one audit over plain HTTP and get an evidence-backed result. This is the concrete answer to "agentic commerce".

**When.** After SW6, and only on a trigger: two outside parties ask in writing for pay-per-call access, or the owner chooses to launch it as a surface in its own right (decision 5). Until then this section is a design with one spike done. It was moved behind Jobs in v0.3 because nobody has asked for it yet and Jobs serve founders who are already here.

**Needs:** SW1a promoted; the trigger; decision 5; the operator steps in 10.3.

### 10.1 Design

**What is sold.** One "scout audit" of one public URL: the SW1 Auditor's fixed steps with a smaller page budget (at most 6 fetches) and no model call, so it finishes inside one request. The response is JSON: findings with rule ids and evidence refs, and the evidence list with hashes and fetch times. When receipts are on (P14) it also carries the id of an `audit_run` receipt the caller can verify at `/verify/r/<id>`.

**Wire format: x402 version 2, `exact` scheme, USDC.** On EVM networks `exact` is an EIP-3009 `transferWithAuthorization`: the caller signs permission to move exactly this amount to exactly this address before a time they choose (`validBefore`), with a nonce that can be used once.

1. `POST /x402/audit` with `{ "url": "..." }` and no payment returns 402 with a `PAYMENT-REQUIRED` header (base64 JSON): one accepted option naming the scheme, the network as a CAIP-2 id, the asset, the amount in base units, `payTo`, a timeout, and `extra.name` and `extra.version` for the asset's signing domain. The body repeats it as JSON for humans.
2. The caller retries with `PAYMENT-SIGNATURE`. A payload that does not decode is a 400.
3. **Local checks, before any call to a facilitator:** the network, asset, `payTo` and amount equal ours; `validBefore` is at least the audit deadline plus a settle margin away (60 s plus 60 s). The reference client sets `validBefore` to now plus the timeout the seller advertised, so the advertised timeout is 180 s, not 60: with 60, an authorisation would already be past its expiry when a slow audit came to settle. A failed check is a 402 with the reason.
4. The Worker asks the facilitator to **verify**. Invalid: 402 with the reason.
5. The Worker **records** the payment as `verified`, unique on `(network, asset, payer, nonce)`. A second arrival of the same authorisation inserts nothing and is answered from the row that exists (below).
6. The audit runs under a 60 s deadline. If it fails or times out, the row becomes `work_failed`, nothing is settled, and the caller is not charged.
7. Only if the audit produced a result does the Worker ask the facilitator to **settle**, and the result is stored against the payment first.
   - Settled: the row becomes `settled`; 200 with the result and a `PAYMENT-RESPONSE` header.
   - Refused: 402 with a `PAYMENT-RESPONSE` carrying `success: false`, and the result is withheld.
   - Pending, timed out, or unknown: the row becomes `settle_pending`; the caller gets 202 with `Retry-After` and no findings. This is not a failure. The spec names `settlement_pending` as a result that is not final.

**A payment the Worker is unsure about is never marked failed on a guess.** Before a `settle_pending` row becomes anything else, a reconciler reads the chain: the asset contract's own record of whether that payer's nonce has been used. That is a read, not a transaction, and needs no key. Used, with the transfer to `payTo` present: `settled`, and the stored result is released. Not used and past `validBefore`: `expired`, and nothing is owed. Otherwise it stays pending and is read again.

**Sending the same authorisation again** is how a caller who lost the response gets it back, so the answer depends on the row: `settled` returns the stored result (kept 24 hours); `verified` or `settle_pending` returns 202 with `Retry-After`; `work_failed`, `settle_failed` or `expired` returns 402 with the reason, and the caller signs a new authorisation. One authorisation can never produce two audits or two settlements, however its bytes are encoded, because the key is the signed nonce and not a hash of the payload.

So the caller pays only for a delivered result, and Luminara releases a result only for a settled payment. The Worker never holds a key: the caller signs, and the facilitator submits.

**The asset is pinned, not discovered.** Spike SW5-0 found that a facilitator's `/supported` answer lists kinds, extensions and signers and carries no asset address or decimals. So the asset address, its decimals and its signing-domain name and version are pinned in configuration per network, taken from the issuer's published list, cross-checked against the `@x402/evm` package's own table by a unit test, and confirmed by the owner. The domain name differs by network (`USDC` on Base Sepolia, `USD Coin` on Base; version `2` on both), so a pin copied from one to the other fails every signature. At start-up the rail stays off unless `/supported` lists version 2, the `exact` scheme and the configured network.

**Why not reuse `worker/q402`.** That code is version-1 shaped, uses custom `ton/*` and `xdc/*` schemes where the client pays on-chain first and presents a transaction hash (`worker/q402/types.ts:8-57`), and its settle path has the defects in hazard 5. It stays off, and SW0a-2 turns its routes into 404s. The new rail lives in `worker/x402/` with a README that says how the two differ. If the owner later wants x402 on TON, the standard now has a TON `exact` scheme, but no production facilitator runs it, and self-hosting one needs a funded wallet, which rule J1 forbids (SW10).

**Libraries.** `@x402/core` and `@x402/evm` 2.28.0 (Apache-2.0). Spike SW5-0 bundled and ran them under local workerd at this repo's compatibility date: the seller route cost about 164 KB raw, 30 KB gzip, most of it a second copy of the schema library the packages depend on at an older major version. Imports are narrow: `@x402/core/http`, `@x402/core/types` and `@x402/evm/exact/server`. The root of `@x402/evm` is never imported; it pulls in several hundred modules of a chain library the seller side does not need. Fixtures are the worked examples in the HTTP transport specification, which the spike decoded correctly with the package; the specification ships no separate test vectors.

**MCP.** A second, unauthenticated MCP endpoint, `/x402/mcp`, exposes exactly one tool, `scout_audit`, using x402's MCP transport: an unpaid call returns `isError: true` with the requirements both in `structuredContent` and as a JSON string in `content[0].text`; the client retries with the payment in `_meta["x402/payment"]`; the settlement comes back in `_meta["x402/payment-response"]`. The existing `/mcp` endpoint and its plan gate do not change.

**Abuse.**

- The route fetches caller-chosen URLs, so every fetch goes through the P17 wrapper and the existing host checks, and the per-site limits of section 4.4 apply to it.
- Verification happens before any fetch, so an unpaid caller costs one facilitator call at most; the 402 itself costs nothing.
- An authorisation that verifies and is then never settled costs an audit. So verified-and-unsettled attempts are counted per payer address and per IP, and a small number an hour (set in SW5-5) is the limit.
- Limits: the high-cost rate limiter per IP; 30 paid audits per payer address per hour; 4 running at once across the service; a daily count cap. Each has a variable and each refusal has a code.
- A result for the same URL within 10 minutes is served from cache with its original fetch times shown.

**Where it appears.** On its own hostname, and nowhere else. The x402 routes and their docs page answer only on a separate hostname the operator points at the same Worker; on the main hostname every `/x402/*` path is a 404. Telegram allows crypto features in a Mini App only on TON, so a surface that takes USDC on another network must not be reachable from one: a test asserts that no page in the Mini App bundle, no bot message and no start parameter contains that hostname.

**Money and records.** Revenue arrives at an address the owner controls (decision 5). `x402_payments` is the record. It has no account id and is in no account export (a stated exception to rule 2.6). A payer address can be personal data: after 24 months it is replaced in the row by a salted hash, and the row is kept as a revenue record for as long as the accountant says (decision 5). The Worker cannot return a payment. If one ever settles with no result delivered, it is listed for the owner, who returns it from their own wallet.

### 10.2 Migration `x402_payments`

```sql
CREATE TABLE IF NOT EXISTS x402_payments (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  payer TEXT NOT NULL,
  nonce TEXT NOT NULL,
  valid_before INTEGER NOT NULL,
  resource TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified','settle_pending','settled','settle_failed','work_failed','expired')),
  settle_tx TEXT,
  result_ref TEXT,
  facilitator TEXT NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE (network, asset, payer, nonce)
);
CREATE INDEX IF NOT EXISTS idx_x402_payments_payer ON x402_payments(payer, created_at);
CREATE INDEX IF NOT EXISTS idx_x402_payments_status ON x402_payments(status, created_at);
```

- `amount` is a decimal string of base units. No floating point touches money (the q402 code's float conversion is one of hazard 5's defects).
- Insert with `ON CONFLICT(network, asset, payer, nonce) DO NOTHING`. One row inserted: this request owns the payment. None: read the existing row and answer from it.
- Before settling: `UPDATE x402_payments SET result_ref = ?, updated_at = ? WHERE id = ? AND status = 'verified'`.
- Settle: `UPDATE x402_payments SET status = 'settled', settle_tx = ?, settled_at = ?, updated_at = ? WHERE id = ? AND status IN ('verified','settle_pending')`; release the result only when one row changed.
- Unsure: `UPDATE x402_payments SET status = 'settle_pending', updated_at = ? WHERE id = ? AND status = 'verified'`. Only the reconciler moves a row out of `settle_pending`.
- `result_ref` names the stored result (R2, 24 hours). It is cleared when the result is deleted.
- Paid runs are written to `swarm_runs` under the fixed account id `sys:x402`, `kind = 'paid_audit'`, `origin = 'x402'`, `plan_class = 'paid'`, so the sweeper and alerts cover them.

### 10.3 Operator steps

1. **Owner:** provide the receiving address for Base (decision 5). It is a public address, set as a `var`. The agent never sees, generates or holds its key.
2. **Owner:** choose the production facilitator. Some need an account and a key, set as a secret; some need neither. Staging uses the public test facilitator, which answers for the test network only.
3. **Operator:** point the separate hostname at the Worker.
4. Set per environment: `X402_NETWORK` (the test network on staging), `X402_PAY_TO_ADDRESS`, `X402_PRICE_BASE_UNITS`, `X402_FACILITATOR_URL`, `X402_HOSTNAME`, a read-only RPC URL for the reconciler, and the asset pins (address, decimals, domain name and version). The owner confirms the pins against the issuer's page.
5. **Owner drill, staging:** pay for one audit from the owner's own test wallet with a standard x402 client; then one whose settlement is forced to time out, to watch the reconciler finish it. The agent sends no transaction (rule 2.11).

### 10.4 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW5-0 | Re-baseline and spike. **Done on 2026-10-10, in a scratch directory outside the repo:** the two packages bundle and run under local workerd with narrow imports; the 402 header round-trips; the test facilitator's `/supported` was read (no asset address; Base Sepolia only). **Still to do, when the phase starts:** re-read the specification at its then-current commit; measure the scout audit's duration on staging with n; with the owner, one verify and one settle on the test network (the spike called neither, since both need a payer's signature); read `decimals()` from the asset contract and compare it with the pin | this document; a scratch directory | Section 10 corrected. If the measured p95 does not fit the 60 s deadline, the page budget is lowered before any code is written. The pins are recorded with their source URL and date |
| SW5-1 | Migration; smoke lists; the 24-month payer minimisation; flag and vars in three blocks | `migrations/`; `scripts/smoke-check.mjs`; `worker/scheduledJobs.ts`; `wrangler.jsonc`; `worker/env.ts` | Applies clean. A row older than 24 months keeps its amount and status and no longer holds the payer address. A second insert of one `(network, asset, payer, nonce)` changes nothing |
| SW5-2 | Requirements builder, with `extra.name` and `extra.version` and the pinned asset, and header codec; `GET /x402/supported` | new `worker/x402/requirements.ts`; `worker/x402/README.md`; tests against the worked examples in the HTTP transport specification | The 402 header round-trips through the reference decoder. Amount is a string of base units. Network is a CAIP-2 id. A unit test asserts each pin equals the package's own table. No file imports the root of `@x402/evm` (grep in the test) |
| SW5-3 | Facilitator client: the three calls (verify, settle, supported); timeouts; the start-up check; a mock for tests | new `worker/x402/facilitator.ts`; `tests/helpers/` | Verify false: no row. Verify times out: 503, no row. `/supported` missing the configured network: every x402 route returns 503 `rail_off`. The mock is the only facilitator any automated test talks to |
| SW5-4 | Route: decode, local checks, verify, record, run, store, settle, release; the scout audit as a synchronous use of the SW1 steps | new `worker/x402/auditRoute.ts`; `worker/swarmRun.ts`; `worker/index.ts` | A malformed payload is a 400. A `validBefore` 90 seconds away is refused before any facilitator call. The same authorisation sent twice, including re-encoded with different bytes: one audit, one settlement, and the second call gets the stored result. Audit fails: no settle call (spy), status `work_failed`. Settle refused: the body has no findings, status `settle_failed`, and the response carries `success: false`. Settle times out: 202, status `settle_pending`, no findings. Flag off: 404 |
| SW5-5 | Limits and cache; codes for each refusal; the verified-and-unsettled count | `worker/x402/auditRoute.ts`; `worker/securityHardening.ts` | A private-network URL is refused before verification. The 31st paid call from one payer in an hour is refused before verification. A payer over the unsettled limit is refused before verification. A fifth concurrent audit gets 503 with `Retry-After` |
| SW5-6 | MCP endpoint with the one paid tool | new `worker/x402/mcp.ts`; `worker/index.ts` | An unpaid call returns `isError: true` with the requirements in both places the transport names. A paid call returns the result and the settlement in `_meta`. `/mcp` behaviour is unchanged (existing tests) |
| SW5-7 | The separate hostname: routes and docs page answer only there; `llms.txt` entry on that host | `worker/index.ts`; new docs page; `utils/marketingRoutes.ts` | On the main hostname every `/x402/*` path is a 404. A test asserts the hostname appears in no file of the Mini App bundle, in no bot message and in no Telegram start token |
| SW5-8 | Alerts: settle-failed rate, work-failed rate, rows in `settle_pending` older than 15 minutes, daily count at 80 percent | `worker/scheduledJobs.ts` | Each alert fires once per window on a fixture |
| SW5-9 | The reconciler on the ops cron: for each `settle_pending` row, read the authorisation's state from the asset contract and move the row as section 10.1 says | new `worker/x402/reconcile.ts`; `worker/scheduledJobs.ts`; tests with a fake RPC | Nonce used and transfer present: `settled`, and a repeat of the request returns the result. Nonce unused and `validBefore` passed: `expired`. Nonce unused and still valid: unchanged. The RPC failing changes nothing. No code path in `worker/x402/` moves a row from `settle_pending` to `settle_failed` without a chain read (grep and test) |

**Order:** SW5-0; SW5-1; SW5-2 and SW5-3; SW5-4 with SW5-9 (reviewed together as a money change); SW5-5; SW5-6; SW5-7; SW5-8.

**SW5 double-check:** grep `worker/x402/` for any private key, signer or `sendTransaction`; confirm no import from `worker/q402/` and none from the root of `@x402/evm`; confirm no number in the route is a float; confirm no Telegram-reachable surface names the x402 hostname.

**Staging soak:** sized by what it must cross (rule 2.18): at least 10 audits paid by the owner from their own test wallet, one forced settle timeout finished by the reconciler, one authorisation left to expire, and one repeat of a settled request. Automated checks run against the mock.

**Mainnet gate (all required):** decision 5 answered yes, including the owner's explicit yes that taking USDC on Base sits beside the rule that LORA is the one token; the owner's receiving address recorded and confirmed by a test payment on the test network to the matching test address; the asset pins confirmed by the owner; the production facilitator chosen and reachable; counsel and an accountant have answered decision 5's questions about taking stablecoin revenue and how long its records are kept; the price is at or above the measured cost per audit plus the facilitator fee; the soak met its criteria. Production then gets code with the flag off, and the flag is its own release.

**Rollback:** flag off returns 404 on every x402 route at once. Before it is turned off, `settle_pending` is left to drain; the admin health block shows the count, and the reconciler does not depend on the flag. An authorisation that was never settled simply expires. A payment that settled with no result delivered is listed for the owner (section 10.1).

---

## 11. SW6 - Jobs: fixed-price work, kept only on a passed check

**Goal:** the brief's "replacement for services" in the shape TN6 already approved: a founder picks a job, sees its price and its acceptance check before paying, and keeps their money unless the check passes. Luminara is the seller of every job. No third party is paid.

**Needs:** SW2 promoted; SW0a-3, SW0a-4 and SW0a-16 in production (P18); P14; decisions 1, 16, 23 and 32. Starts with a re-baseline (SW6-0). It runs before SW5.

### 11.1 Design

**What a paid job adds.** The free chain already drafts one fix per finding from a template. A job is sold only if it does more than that: it covers the whole site in one deliverable, or includes fields a model writes and a check passes, or is done by a person. SW6-0 writes that sentence for each SKU. A SKU that cannot say it is not sold.

**Catalogue.** Typed data in code (`services/swarm/jobCatalogue.ts`): `sku`, version, title, the agent that does it, the deliverable, the acceptance check id, the price in Stars, and the measured cost. The first three SKUs come from TN6's table:

| SKU | Agent | Deliverable | Acceptance check (deterministic) |
|---|---|---|---|
| `schema_fix_pack` | Fixer | JSON-LD blocks for the site's entity | Each block parses and validates; `sameAs` lists only links with a receipt |
| `ai_crawler_policy` | Fixer | `robots.txt` rules, and an `llms.txt` file if SW6-0 keeps it | Both parse; each named crawler is allowed or blocked as the order asked |
| `competitor_brief` | Prospector | A report through `save_report` | Every metric cites evidence or reads `not_measured` |

Two notes on that table. TN6's check for `ai_crawler_policy` also required the live site to show the new rules. The deliverable is a draft the founder ships, so at delivery the live site cannot yet show it; this plan's check drops that condition, and the re-check after the founder ships covers it (section 19 records the edit). And the compiled AI-search playbook records that Google calls `llms.txt` ineffective; SW6-0 decides with the owner whether that file stays in a paid SKU, and if it stays the listing says what it is and is not known to do.

Prices are set in SW6-0 from the cost per run measured in SW2, never before. The two one-off Stars SKUs that exist today (`worker/telegramBot.ts:83-108`) are not changed.

**Order flow.**

```
quoted -> pending_payment -> paid -> running -> checking -> delivered
                               |         |           \-> failed -> refunded
                               |         \-> failed -> refunded
                               \-> failed -> refunded      (no run by due_at)
delivered -> refunded                        (an operator, from the support queue)
quoted | pending_payment -> expired | cancelled
```

1. `POST /jobs/quote` creates a row with the price copied from the catalogue and a 15-minute expiry. The response shows the price, the check, and the worst-case time.
2. `POST /jobs/:id/checkout` returns a Stars invoice whose payload is `job:<jobId>`.
3. **Pre-checkout** (the 10-second answer Telegram requires): the payload names a job that is `pending_payment` and unexpired, the currency is XTR, the amount equals the job's `price_stars`, and the payer's Telegram id equals the job's `payer_tg_id`. Today's handler takes the price from a plan table and the user id from the payload (`worker/telegramBot.ts:293-308`, `:326-329`); the job branch binds both to the row instead.
4. **Payment** uses the one charge ledger SW0a-3 created (section 5.1), with `purpose = 'job'`. The charge row is written first, as `received`. Then one batch: move the job to `paid` with a conditional update that stores the charge id and sets `due_at`; and move the charge to `credited` only if that job update matched. Then start the run. If the job update matched nothing (the quote expired, the job was already paid, the payer differs), the charge becomes `refund_due`. A crash at any point leaves a charge that is still `received`, which the sweep settles by what is true: credited if a job names it, refunded if none does. A second, late or stray charge for the same job is refunded.
5. The run does the work under a session whose budget is the SKU's measured cost plus a margin. Then the acceptance check runs.
6. **Pass:** `delivered`, with an `agent_job_delivered` receipt. **Fail, or no result by `due_at`:** one batch moves the job to `failed` and its charge from `credited` to `refund_due`. The sweep of section 5.1 refunds it to the stored payer; the job becomes `refunded` when its charge does. Delivery and failure are each a conditional update on the job's current state, so a timeout that failed a job cannot be overtaken by a late delivery, and a delivery cannot be followed by an automatic refund.

**"Always results", stated honestly.** The promise is not that every job succeeds. It is that a job either passes the check the buyer saw before paying or is refunded in full without the buyer asking. A buyer who is unhappy with a job that passed can ask for one redo within 7 days. A redo is its own job row that names the first (`redo_of`), costs nothing, and can exist once. If the redo also disappoints, it goes to a person at Luminara Digital through the support queue, who can refund it.

**Human fulfilment.** A SKU may be marked `fulfiller = 'human'` (TN6). It follows the same states, the same check and the same refund rule; the work is done by Luminara Digital staff from an admin queue with a `due_at`.

**Rails.** Stars only in this phase, and sold only inside Telegram at first (decision 32). Inside the Mini App that is required (section 0.3, item 3). On the web the checkout hands off to the Mini App, as plan checkout already does. TON is not offered for jobs: there is no way to refund TON without holding a key. `plan_credit` is reserved in the schema for jobs included in a plan (decision 16) and has no code in this phase.

**Operational rule for refunds.** A refund is paid from the bot's Star balance. The owner does not withdraw below the total of charges on jobs that are not yet `delivered`. SW6-7 reports that total.

**What a refund can and cannot promise.** Telegram takes a refund out of the bot's balance, and a balance can be emptied by a withdrawal. So only the check that runs at delivery carries the automatic refund; the 7-day redo is a redo, not a second refund window. An alert fires when the balance falls under the total of undelivered charges. SW6-0 tests, on the staging bot, a refund with too low a balance, a second refund of the same charge, and a refund to a payer whose account is gone, and this section is corrected to what was seen.

**Disputes reach a person.** Telegram makes the seller responsible for disputes. SW0a-16 already turns the reply to `/paysupport` into a support request a person reads. SW6-10 lets an operator refund from that queue, which is the one path from `delivered` to `refunded`, and adds the refund rule to the Terms. Whether jobs sold to Australian and New Zealand buyers carry GST is decision 23, with an accountant.

**Buying from the web or the desktop.** Jobs are paid in Stars, which exist only inside Telegram. On the web and in the desktop shell the pay button is a link that opens the Mini App on the quote, through a new `job_<id>` start parameter. Inside Telegram no screen links to any other way to pay (SW0a-6).

**The kill switch never drops a payment.** With `AGENT_JOBS_ENABLED` off, new quotes and checkouts are refused, and a `job:` payment that still arrives is processed as usual: recorded, then refunded.

**A job is not a quest.** Buying or receiving a job completes no quest, raises no level and opens no room (section 14).

### 11.2 Migration `agent_jobs`

```sql
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  sku_version INTEGER NOT NULL,
  fulfiller TEXT NOT NULL DEFAULT 'agent' CHECK (fulfiller IN ('agent','human')),
  status TEXT NOT NULL CHECK (status IN ('quoted','pending_payment','paid','running','checking','delivered','failed','refunded','cancelled','expired')),
  rail TEXT CHECK (rail IS NULL OR rail IN ('stars','plan_credit','redo')),
  price_stars INTEGER,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  payer_tg_id INTEGER,
  stars_charge_id TEXT UNIQUE,
  redo_of TEXT,
  run_id TEXT,
  session_id TEXT,
  input_json TEXT NOT NULL,
  check_result_json TEXT,
  deliverable_ref TEXT,
  receipt_id TEXT,
  quote_expires_at INTEGER NOT NULL,
  due_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (rail IS NOT 'stars' OR COALESCE(price_stars, 0) > 0),
  CHECK (rail IS NOT 'stars' OR payer_tg_id IS NOT NULL),
  CHECK (status NOT IN ('paid','running','checking','delivered','failed','refunded')
         OR (rail IS NOT NULL AND due_at IS NOT NULL)),
  CHECK (status NOT IN ('paid','running','checking','delivered','failed','refunded')
         OR rail IS NOT 'stars' OR stars_charge_id IS NOT NULL),
  CHECK (status <> 'refunded' OR rail IS 'stars'),
  CHECK ((rail IS 'redo') = (redo_of IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_account ON agent_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_open ON agent_jobs(status, updated_at)
  WHERE status IN ('paid','running','checking','failed');
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_one_open ON agent_jobs(account_id, project_id, sku)
  WHERE status IN ('pending_payment','paid','running','checking');
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_one_redo ON agent_jobs(redo_of)
  WHERE redo_of IS NOT NULL;
```

There is no second charge table. Every statement below is on `agent_jobs` or on `stars_charges` from section 5.1, and each must change exactly one row to count (rule 2.8).

- **Record the charge:** `INSERT INTO stars_charges (charge_id, payer_tg_id, account_id, purpose, ref_id, stars, status, created_at, updated_at) VALUES (?, ?, ?, 'job', ?, ?, 'received', ?, ?) ON CONFLICT(charge_id) DO NOTHING`. The shared `stars_credited_charges` claim is not used for jobs: the charge row's primary key is the claim.
- **Pay the job, first statement of one batch:** `UPDATE agent_jobs SET status = 'paid', stars_charge_id = ?, due_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_payment' AND quote_expires_at > ? AND payer_tg_id = ?`.
- **Credit the charge, second statement of that batch:** `UPDATE stars_charges SET status = 'credited', updated_at = ? WHERE charge_id = ? AND status = 'received' AND lease_until IS NULL AND EXISTS (SELECT 1 FROM agent_jobs WHERE id = ? AND stars_charge_id = ?)`. If the job update matched no row, this one matches none either.
- **If it did not credit:** `UPDATE stars_charges SET status = 'refund_due', refund_reason = 'job_not_payable', updated_at = ? WHERE charge_id = ? AND status = 'received'`.
- **Fail a job, as one batch:** `UPDATE agent_jobs SET status = 'failed', check_result_json = ?, updated_at = ? WHERE id = ? AND status IN ('paid','running','checking')`, then `UPDATE stars_charges SET status = 'refund_due', refund_reason = ?, lease_until = NULL, updated_at = ? WHERE charge_id = ? AND status = 'credited' AND EXISTS (SELECT 1 FROM agent_jobs WHERE id = ? AND status = 'failed')`.
- **Close the job when its refund has gone:** `UPDATE agent_jobs SET status = 'refunded', updated_at = ? WHERE id = ? AND status = 'failed' AND EXISTS (SELECT 1 FROM stars_charges WHERE charge_id = ? AND status = 'refunded')`.
- **An operator's refund of a delivered job:** `UPDATE stars_charges SET status = 'refund_due', refund_reason = 'operator', lease_until = NULL, updated_at = ? WHERE charge_id = ? AND status = 'credited'`, then, once it is `refunded`, `UPDATE agent_jobs SET status = 'refunded', updated_at = ? WHERE id = ? AND status = 'delivered'`.
- **A redo:** an insert that selects from the first job only when it is `delivered`, its `delivered_at` is within 7 days, and it is not itself a redo; `idx_agent_jobs_one_redo` allows one. A redo has `rail = 'redo'` and no charge, so it can never be `refunded` (the fifth CHECK): it ends `delivered` or `failed`.
- `stars_charge_id` is unique, so one charge can never pay two jobs. `idx_agent_jobs_one_open` allows one unpaid or in-flight job per account, project and SKU, so two invoices for the same thing cannot both be paid.
- Every sweep that reads open jobs repeats `idx_agent_jobs_open`'s exact predicate, `status IN ('paid','running','checking','failed')`, or the planner will not use the index.
- The charge row is the only record of refund state; `agent_jobs` has no refund column to disagree with it. A job on the `plan_credit` rail has no charge and so can never be `refunded`; it ends `failed` and its credit is returned by the plan's own count.
- Nothing in SQL stops a status moving backwards. Order is enforced by every update naming the state it expects (rule 2.8), and SW6-3 has a test that walks each illegal transition.
- **Deleting an account that has money in flight.** A deletion request from an account with a job that is `paid`, `running` or `checking`, or a charge that is `received` or `refund_due`, is accepted at once and finished in two steps: those jobs are failed and their refunds queued in the same batch, and the account's data is deleted when the last charge is `refunded` or `refund_failed`, at most 7 days later. The person is told this when they ask. Charge rows are kept with `account_id` set to NULL (section 5.1).
- On account link, jobs move to the surviving account. If both accounts hold an open job for the same project and SKU, the losing account's unpaid one is cancelled first; a paid one cannot collide, because a project belongs to one account.
- The table name and the flag `AGENT_JOBS_ENABLED` are the ones the TN plan reserved. The flag follows rule 2.3 (`"true"` or `"false"`).

### 11.3 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW6-0 | Re-baseline. Re-check sections 1 and 11 against `main`; confirm SW0a-3, SW0a-4 and SW0a-16 are in production. For each SKU write what it adds over the free chain, and set its price from measured cost; settle the `llms.txt` question; record decisions 16, 23 and 32. On the staging bot, with real test payments: one purchase and refund; a refund attempted with too low a balance; a second refund of one charge; a refund to a payer whose account was deleted | this document | Each price is at or above measured cost with n stated. No SKU ships without a measured cost or without its "what this adds" sentence. What Telegram returned in each refund case is written into section 11.1, and the sweep's handling matches it |
| SW6-1 | Migration; smoke lists; privacy export and delete, with the two-step deletion; link move; `AGENT_JOBS_ENABLED` in three blocks, env typing, example env files, admin health and the capabilities answer | `migrations/`; `scripts/smoke-check.mjs`; `worker/privacyService.ts`; link helper; `wrangler.jsonc`; `worker/env.ts` | Applies clean after `stars_charges`. Deleting an account with a job in flight fails the job, queues its refund, and removes the account's data once the refund has gone or failed; its rows in `stars_charges` and `stars_credited_charges` stay with no account id |
| SW6-2 | Catalogue and the three acceptance checks as pure functions | new `services/swarm/jobCatalogue.ts`; new `services/swarm/jobChecks.ts`; `services/swarm/draftChecks.ts`; tests | Each check has a passing and a failing fixture. A check never calls a model |
| SW6-3 | Quote and checkout routes; state machine with conditional updates; expiry; the redo insert | new `worker/agentJobs.ts`; `worker/index.ts`; `worker/authMiddleware.ts` | A quote for another account's project is refused. An expired quote cannot be checked out. Two checkouts of one job return the same invoice. Each illegal transition is refused (one test per pair). A second redo of one job is refused, and so is a redo eight days after delivery |
| SW6-4 | Stars branch for `job:` payloads in pre-checkout and payment, on the `stars_charges` ledger, binding amount and payer to the row | `worker/telegramBot.ts:290-333`; `worker/paymentLedger.ts:264`; tests | Wrong amount: refused at pre-checkout. Payer id different from the job's: refused. Same charge delivered twice by Telegram: one job paid. Payment for an expired job: refunded and the job stays `expired`. A crash between the charge insert and the batch leaves a `received` row the sweep refunds. Plan purchases behave exactly as before (existing tests) |
| SW6-5 | Job runs: session sized to the SKU, deliverable, check, receipt | `worker/swarmService.ts`; `worker/swarmRun.ts`; `worker/trustReceipts.ts:101` | A passing fixture ends `delivered` with a receipt. A failing fixture ends `failed` and never `delivered`, and its charge is `refund_due` in the same batch |
| SW6-6 | Job sweeps on the ops cron, beside the charge sweep of section 5.1: restart of a `paid` job with no run after 10 minutes; fail and refund of a job past `due_at`; closing a `failed` job whose charge is `refunded`; and a reconciler that compares Telegram's own list of Star transactions with `stars_charges` and reports any charge Telegram has that the table does not | `worker/agentJobs.ts`; `worker/telegramBot.ts:956-970`; `worker/scheduledJobs.ts` | Two overlapping ticks call Telegram once per charge (spy). A Telegram error leaves the charge `refund_due` and the next tick retries; the fifth failure marks it `refund_failed` and alerts. A charge present at Telegram and absent from the table is reported. A job delivered after its timeout fired stays `failed` and is refunded once. `EXPLAIN QUERY PLAN` for each sweep names `idx_agent_jobs_open` |
| SW6-7 | Admin queue for human jobs and the float report | `worker/index.ts` admin routes; `worker/adminAuth.ts` | Without the admin secret: 401. The report's total equals the sum of charges on undelivered jobs in a fixture |
| SW6-8 | Jobs view: catalogue, quote sheet showing price, check and what the job adds, order status, redo request | new `components/jobs/`; new `services/jobs/jobsClient.ts`; `services/telegram/tma.ts` | Static-markup tests per state. The quote sheet shows the check text before the pay button. On the web the pay button is the hand-off link |
| SW6-9 | MCP `list_jobs`, `quote_job` (no checkout through MCP in this phase) | `worker/mcpServer.ts` | A quote through MCP appears in the app for the same account |
| SW6-10 | Disputes and terms: an operator refund from the support queue of SW0a-16; the Terms state the refund rule; the `job_<id>` start parameter | `worker/index.ts` admin routes; `worker/agentJobs.ts`; `worker/termsPolicy.ts`; `services/telegram/startParam.ts` | An operator refund moves the charge to `refund_due`, the sweep refunds it, and the job ends `refunded`. A job that is not `delivered` cannot be refunded this way. Opening the Mini App with `job_<id>` lands on that quote for its owner and on "not found" for anyone else |
| SW6-11 | The Prospector and the server tool loop, moved here from SW2-6. A typed planner returns `{ tool, args }` from the agent's allow-list; every tool result is fenced; three identical calls in a row end the run; per-step and per-run limits (section 4.3). Its own live gate, shaped like SW1-13, before `competitor_brief` is sold | new `worker/swarmToolLoop.ts`; new `services/swarm/prospectorPlan.ts`; `services/agentCore/` detectors; `evals/live/`; tests | A fixture model that repeats one call three times ends the run `failed` with `REPEAT`. A planner reply naming a tool outside the allow-list is refused and counted. Every tool result in the next prompt is inside an untrusted fence (prompt-assembly snapshot). For every twin pair in the gate, the tools called are identical with and without the planted instruction |

**Order:** SW6-0; SW6-1; SW6-2; SW6-3; SW6-4 (reviewed as a money change); SW6-5; SW6-6; SW6-7; SW6-8; SW6-9; SW6-10 before any production flag. SW6-11 in parallel; `competitor_brief` is not listed until it passes its gate.

**SW6 double-check:** every path into `delivered` passes through a check result; every path into `failed` on the Stars rail moves its charge to `refund_due` in the same batch; no state change is an unconditional update (grep); the plan-purchase tests pass unchanged; job copy never says "guaranteed result".

**Staging soak:** the owner buys each SKU once with a real Stars payment on the staging bot and forces one failure. Staging has no users, so nothing here is a waiting period.

**Promote when:** each SKU has been bought, delivered and verified by the owner on staging; one forced failure refunded itself with no admin action and the Stars arrived back (owner check); a double-delivered payment update paid one job; one redo was asked for and delivered. Production: code with the flag off, then the flag, allow-list first.

**Rollback:** flag off refuses new quotes and checkouts. Jobs already paid finish or refund; the refund path does not depend on the flag.

---

## 12. SW7 - Live rooms, org invites, agency war room

**Goal:** the brief's "multiplayer": a founder, a teammate or an agency can watch the same run as it happens, steer it between steps, approve for each other, and hand it over.

**Needs:** SW2 promoted; decision 10. Starts with a re-baseline and a socket spike (SW7-0).

### 12.1 Design

**The room is the run.** Viewers connect by WebSocket to the run's own Durable Object, which already holds its events. The object accepts sockets with the hibernation API, so an idle room costs nothing while it waits. On connect a viewer gets the events since a sequence number, then each new event as it is appended.

**Getting in.** A browser cannot set an auth header on a WebSocket. So: `POST /swarm/runs/:id/live-ticket` (signed in, role checked) returns a single-use ticket valid for 60 seconds; the socket presents it as its subprotocol value, not in the URL. The object stores the viewer's user id and role on the socket. A guest has no session, and everything under `/swarm` refuses a caller with none, so the guest's ticket route and socket live outside that prefix, under `/watch/<token>`, with the token as their only credential.

**Who may do what.** Roles are the ones the schema already has (`migrations/0003_enterprise_orgs_rbac.sql:16`).

| Role | Watch | Send an instruction | Pause, resume, cancel | Approve a step | Hand over |
|---|---|---|---|---|---|
| owner, admin | yes | yes | yes | yes | yes |
| analyst | yes | yes | no | no | no |
| auditor, viewer | yes | no | no | no | no |
| guest with a watch link | yes, redacted | no | no | no | no |

**An instruction** is a typed choice, not text (section 4.3): narrow the work to one page or one finding of this run, skip the step that is next, or stop after the step in flight. It is recorded as an event with the sender's user id and applied at the next step boundary. It is accepted only while the run is open, and only for an agent whose plan a model steers (the Prospector); the fixed-plan agents take none, because there is nothing in a fixed list for an instruction to change. It cannot raise a cap, change a ceiling, add a tool or approve anything: those stay on their own routes with their own checks.

**Hand over** changes who is asked for approvals on this run: the run's approver becomes another owner or admin of the same org. It is an event, and both people see it.

**Org invites.** Membership rows exist with no way to create one for a second person (`worker/enterpriseStore.ts:76-91` creates only the owner). SW7 adds the smallest invite: an owner or admin creates a single-use link for a role other than owner, valid 7 days; accepting it while signed in inserts the membership. The number of active members is capped by `teamSeats` (1, 1, 3, 10), which becomes a Worker-side entitlement for the first time; it means people, and is never used for agents (Ops F4).

**Before the first invite can be accepted, one existing function has to change.** `getOrCreateUserOrg` returns an account's earliest active membership (`worker/enterpriseStore.ts:53-61`), and six call sites use its answer as "my org" (`worker/index.ts:364`, `:699`, `:727-745`, `:754-760`). Today that is always the personal org, because nobody has a second membership. The moment an invited person's first membership is someone else's org, every one of those routes would act on the inviter's org. SW7-2 makes it resolve the personal org by its id (`org_<accountId>`) first, with a test in which the invited membership is the older row, and ships before SW7-3.

**Scope of membership, deliberately narrow.** Every existing route resolves the caller to their own account. This phase does not change that. Membership is honoured in exactly three places: live rooms, the runs list with `scope=org`, and the approval routes for a run's steps. One helper, `resolveRunAccess(user, run)`, makes the decision and is the only caller of the membership lookup. Everything else in the product stays single-account until a later plan widens it on purpose.

**Guest watch links.** An owner can mint a view-only link for one run, valid at most 24 hours. A guest sees step summaries and state changes and never costs, arguments, evidence text or other viewers.

**War room.** For an agency: one grid of the runs open across its client projects (`projects.client_id` already groups them), each tile a live room in miniature, with the approvals waiting across all of them at the top. A grid, not a canvas.

**Limits.** At most 20 sockets per run and 5 instructions per minute per viewer; messages over 2 KB are dropped. The room closes 10 minutes after the run ends.

### 12.2 Migration `live_rooms`

```sql
CREATE TABLE IF NOT EXISTS org_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','analyst','auditor','viewer')),
  invited_label TEXT,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by TEXT,
  accepted_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_watch_tokens (
  token_hash TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_watch_tokens_run ON run_watch_tokens(run_id);
```

- The role CHECK has no `owner`: an invite can never create a second owner.
- Accept is one batch of two statements, and the second can only act if the first did. First: `UPDATE org_invites SET accepted_by = ?, accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND (SELECT COUNT(*) FROM organization_memberships m WHERE m.org_id = org_invites.org_id AND m.status = 'active') < ?`, the last bind being the plan's seats. Second: the membership is inserted by selecting from the invite row this caller just accepted (`... SELECT org_id, ?, role, ... FROM org_invites WHERE token_hash = ? AND accepted_by = ? AND accepted_at = ?`) with `ON CONFLICT(org_id, user_id) DO NOTHING`. An invite that was expired, revoked, already used or over the seat limit accepts nothing and so inserts nothing.
- On account link, invites the losing account created move to the surviving account's org; watch tokens move with their runs.
- Only token hashes are stored, as share links already do.
- `organization_memberships` is not altered. Its `user_id` is a login id (`worker/enterpriseStore.ts:90`), so access checks compare login ids, not account ids.

### 12.3 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW7-0 | Re-baseline and spike: hibernating sockets on the run object under `wrangler dev` and on staging; whether a deploy drops sockets and how clients recover; record decision 10 | this document; scratch branch | Section 12 corrected. Reconnect behaviour after a deploy is written down as measured |
| SW7-1 | Migration; smoke lists; privacy and link move; flags | `migrations/`; `scripts/smoke-check.mjs`; `worker/privacyService.ts`; `wrangler.jsonc`; `worker/env.ts` | Applies clean. Deleting an account revokes its invites and watch tokens |
| SW7-2 | First: `getOrCreateUserOrg` resolves the personal org by id. Then `resolveRunAccess` and the `teamSeats` entitlement on the Worker | `worker/enterpriseStore.ts:53-61,135-188`; `worker/index.ts:364,699,727-745,754-760`; new `worker/runAccess.ts`; `worker/telegramBot.ts:128-149` | With a fixture account whose oldest membership is another account's org, each of the six call sites still acts on the account's own org. A member of org A cannot read org B's run (404). A suspended member is refused. The new helper is the only importer of the membership lookup outside `enterpriseStore` (test over the import graph) |
| SW7-3 | Invite create, accept, revoke, list; the seat cap inside the accept | new `worker/orgInvites.ts`; `worker/index.ts`; `worker/authMiddleware.ts` | A second accept of one link is refused. Two accepts racing for the last seat seat one person. An accept that fails inserts no membership. An invite for `owner` is refused by code and by CHECK |
| SW7-4 | Ticket route; socket accept with hibernation; replay from a sequence number; broadcast on append | `worker/swarmRun.ts`; `worker/swarmService.ts` | A ticket works once and for 60 seconds. A viewer joining at event 30 receives 31 onward. The 21st socket is refused |
| SW7-5 | Commands by role: instruct, pause, resume, cancel, hand over; rate limits | `worker/swarmRun.ts`; tests | A viewer's pause is refused. An instruction is one of the typed choices or it is refused; free text is refused. An instruction to a fixed-plan run, or to a run that has ended, is refused. No cap, ceiling or tool list is reachable from the instruction path (asserted by test). A hand-over to a non-member is refused |
| SW7-6 | Approvals by another owner or admin of the org for a run's steps | `worker/mcpGovernance.ts`; `worker/runAccess.ts`; `tests/mcpActionRequestsHttp.test.ts` | An admin of the org approves a member's run step. An analyst cannot. A bearer credential still cannot. Approvals outside runs are unchanged |
| SW7-7 | Guest watch links with a redacted stream, on routes outside the `/swarm` prefix | `worker/swarmRun.ts`; new `worker/watchTokens.ts`; `worker/index.ts` | A guest with a valid link connects with no session. A guest stream contains no cost, argument or evidence text (snapshot). A revoked or expired link is refused. The token opens that one run and no `/swarm` route |
| SW7-8 | Live room UI in the roster view; presence; reconnect with back-off; fall back to polling | `components/swarm/`; new `services/swarm/liveClient.ts` | With sockets blocked the view still updates by polling. Reconnect resumes from the last sequence number with no duplicate event |
| SW7-9 | War room grid; `GET /swarm/runs?scope=org` | new `components/swarm/WarRoomView.tsx`; `worker/swarmService.ts` | The grid shows only runs the caller's role may see. Hidden for plans with no agency clients |
| SW7-10 | Members screen: invite, role, remove | `components/settings/` | Static-markup tests; the seat count shown equals the entitlement |

**Order:** SW7-0; SW7-1; SW7-2 and SW7-3 (reviewed together as an access-control change); SW7-4; SW7-5; SW7-6; SW7-7; SW7-8 to SW7-10.

**SW7 double-check:** grep for every query that filters by `account_id` taken from anything other than the caller or `resolveRunAccess`; confirm no route outside the three named places reads membership; run the two-org test matrix for every `/swarm` route; confirm the guest snapshot.

**Promote when:** the two-org matrix is green; the owner and a second real person have watched one run together on staging, one in the Mini App and one on the web, and the second has approved a step; a deploy during an open room recovered as SW7-0 recorded. Two flags, two production releases: invites first.

**Rollback:** `LIVE_ROOMS_ENABLED` off closes sockets and the view falls back to polling. `ORG_INVITES_ENABLED` off refuses new invites; existing members keep access until removed.

---

## 13. SW8 - Watches and desktop surfaces

**Goal:** agents that come back on a schedule without being asked, and a desktop app that tells the founder when one needs them.

**Needs:** SW2 promoted; Ops Phase 2 exited (Sealed Lane and seats in `enforce`), the same condition the Ops plan set when it parked Watches; decision 12. Starts with a re-baseline (SW8-0).

**The Auditor-only slice (decision 22), part of the launch cut.** The plans already promise scheduled re-audits by tier (`scheduledReaudit`: none on Free, monthly on Starter, weekly on Growth, daily on Agency), and "agents work while I am away" is the launch promise. The Auditor is a fixed plan with no model-chosen step and no tool that writes outside the account, and in SW1a it makes no model call at all, so the reason Watches were parked (an agent acting on hostile content with nobody watching) applies to it least. If decision 22 is yes, SW8-1 and SW8-2 ship right after SW1a with one restriction enforced in code and by a test: only `agent_id = 'auditor'` can have a Watch until Ops Phase 2 exits.

- **The cron.** `watch_tick` is a job on the 15-minute ops cron that P8 adds, which is on the launch path already. The slice needs no cron of its own and does not wait for SW4's hourly one.
- **No sessions yet.** Sessions arrive in SW2. Until then a scheduled Auditor run is an SW1a run with nothing to spend: it counts against the plan's run allowance and the per-site limits of section 4.4, and `run_cap_cents` is 0.
- **Free has no schedule.** A founder on Free re-runs by hand inside their run allowance. Whether Free should get one scheduled audit a month, as a reason to come back, is part of decision 22; the default is the pricing as it stands.
- **It speaks only when something changed.** A scheduled run compares its finding keys with the previous run's for that project. A finding that appeared or went away sends one notice in the `watch` category of section 6.5, under that policy's consent and cap. A run that found nothing new sends nothing.
- **One scheduler.** Sentinel's "time for your check" message (`worker/sentinel.ts:233-249`) and its enqueue of the old queue audit on drift (`:253-262`) are removed in the same change. Sentinel's drift alert stays.

### 13.1 Design: Watches

A Watch is a standing instruction to start one kind of run for one project on a cadence. The name is the Ops plan's, so there is one concept, not two.

- Cadence is limited by the plan's existing `scheduledReaudit` entitlement (none, monthly, weekly, daily).
- From SW2, each run a Watch starts has its own session, capped by the Watch's `run_cap_cents`, inside the agent's monthly cap. A Watch can never spend more per month than its agent may.
- `watch_tick` takes up to 25 due Watches, and for each claims it by advancing `next_run_at` with a compare-and-set, then starts the run. A Watch that was not claimed is not run twice.
- Three failed runs in a row, or a refused start for money, sets `auto_paused` and tells the owner in the app.
- A Watch's Telegram messages follow section 6.5 and nothing else: the `watch` category, only on a change, only with consent.
### 13.2 Design: desktop

The server does the work. The desktop shell stays a thin window on the hosted app (`docs/plans/desktop-windows-electron.md:24`) and gains what a browser tab cannot do:

| Addition | How | Note |
|---|---|---|
| Sender checks on every IPC handler | Each handler verifies the calling frame's origin against the allow-list before acting | A fix for today's handlers too, which ignore the sender (`electron/main.cjs:301-330`) |
| Native notification when a step needs approval or a run delivers | New `desktop:notify` call; clicking it shows the window on the run | The page decides when; the shell rate-limits to 6 per hour |
| Tray menu shows counts | New `desktop:set-badge` call with two integers | The tray exists on Windows today (`electron/main.cjs:267-293`) |
| Start with Windows, minimised to tray | A preference beside the auto-update toggle | Off by default |
| Save a deliverable to a folder | New `desktop:save-file` call that opens the system save dialog in the main process and writes the one file the user confirmed | No general file access. The page never receives a path it did not get from the dialog |

A new shell needs a new installer, and old shells keep receiving new web deploys, so the page feature-detects each call, as it does for update preferences today (`components/desktop/DesktopUpdatesPanel.tsx:16`).

### 13.3 Migration `swarm_watches`

```sql
CREATE TABLE IF NOT EXISTS swarm_watches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  run_cap_cents INTEGER NOT NULL CHECK (run_cap_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','auto_paused')),
  next_run_at INTEGER NOT NULL,
  last_run_id TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, project_id, agent_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_swarm_watches_due ON swarm_watches(status, next_run_at);
```

- Due: `SELECT id, next_run_at FROM swarm_watches WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at LIMIT 25`.
- Claim: `UPDATE swarm_watches SET next_run_at = ?, last_run_id = ?, updated_at = ? WHERE id = ? AND status = 'active' AND next_run_at = ?`. One row changed, or skip.

### 13.4 Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| SW8-0 | Re-baseline. Confirm the Ops Phase 2 exit criteria were met and recorded; record decisions 12 and 30 | this document | If Sealed Lane is not in `enforce` in production, the Watches half of this phase does not start, except the Auditor-only slice under decision 22, which needs only SW1a |
| SW8-1 | Migration; smoke lists; privacy and link move; `SWARM_WATCHES_ENABLED` in three blocks, env typing, example env files, admin health and the capabilities answer | `migrations/`; `scripts/smoke-check.mjs`; `worker/privacyService.ts`; the V2-1b helper; `wrangler.jsonc`; `worker/env.ts` | Applies clean. Deleting an account removes its Watches; after a link they sit under the surviving account, and a `(project, agent, kind)` collision keeps the surviving account's row |
| SW8-2 | Watch service and routes; cadence checked against the entitlement; the `watch_tick` job on the ops cron, with claim; auto-pause; the changed-findings comparison and the `watch` notice; the Auditor-only restriction; removal of Sentinel's nudge and its queue enqueue | new `worker/swarmWatches.ts`; `worker/scheduledJobs.ts`; `worker/index.ts`; `worker/sentinel.ts:233-262`; `worker/notify.ts`; `tests/scheduledJobs.test.ts` | Two overlapping ticks start one run per due Watch. A free plan cannot create a Watch. A Watch for any agent but the Auditor is refused while the restriction holds. Three failures auto-pause it and a fourth tick starts nothing. A scheduled run with the same finding keys as the last sends no notice; one new key sends one. The job list test names `watch_tick` under the ops cron and no longer expects Sentinel's nudge |
| SW8-3 | Watches UI on the roster view | `components/swarm/` | Static-markup tests; the next run time and the month's spend are shown |
| SW8-4 | IPC sender checks for every existing handler | `electron/main.cjs:296-330`; `electron/security.cjs` | A call from a frame outside the allow-list is rejected (unit test on the check) |
| SW8-5 | `desktop:notify`, `desktop:set-badge`, start-with-Windows preference | `electron/main.cjs`; `electron/preload.cjs:8-21`; `electron/desktopPrefs.cjs`; `services/desktop/desktopShell.ts` | The 7th notification in an hour is dropped. An old shell without the calls shows no error (feature detection test) |
| SW8-6 | `desktop:save-file` through the main-process dialog | `electron/main.cjs`; `electron/preload.cjs` | The handler writes only to the path the dialog returned, only the bytes passed, and at most 5 MB. A cancelled dialog writes nothing |
| SW8-7 | Desktop release: a `desktop-v*` tag built by the existing workflow; owner installs and checks each addition. An installer signed with a certificate installs without Windows' warning screen; without one it shows the warning. Which it is to be is decision 30 | `.github/workflows/desktop-windows.yml` | Owner check on a real Windows machine: a notification arrives with the window hidden; clicking it opens the run. What the installer showed on first run is recorded |

**Order:** SW8-0; SW8-4 first (it is a security fix and stands alone); SW8-1 to SW8-3; SW8-5 to SW8-7.

**SW8 double-check:** no handler in `electron/main.cjs` acts before the sender check (grep each `ipcMain.handle`); no new call exposes a path or directory listing to the page; a Watch cannot be created with a cap above its agent's monthly cap.

**Promote when:** a weekly Watch on staging has run on schedule at least three times by a scripted clock test and once for real; an auto-pause was triggered and reported; the owner check in SW8-7 passed.

**Rollback:** `SWARM_WATCHES_ENABLED` off makes `watch_tick` a no-op. Desktop additions are inert on the server; a faulty shell is replaced by the next tag.

---

## 15. SW10 - Gated designs (not work orders)

Each item is recorded so the idea is not lost and so the gate is explicit. None starts without its named decision and, where shown, counsel or an outside audit.

| Item | The lowest-risk design | Why it is gated | Gate |
|---|---|---|---|
| Bounties between founders | **Direct pay on acceptance, with no fee inside the payment.** The funder posts a commitment; no funds are held anywhere. A builder delivers; a Luminara verifier issues a receipt; the funder pays the builder wallet to wallet through TON Connect; the Worker reads the transfer on-chain and marks the bounty paid. An unpaid accepted bounty shows on the funder's record. If Luminara earns anything, it is a flat listing fee charged apart from any bounty. v0.2 put a platform fee inside the bounty's own transaction; that makes Luminara's pay depend on the payment between two users, which is the very thing counsel has to rule on, so it is recorded as an option and is not the lowest-risk design. The lowest-risk design of all is the directory in the last row | Luminara would be arranging payment between two parties, which TN decision D5 sends to legal review first. Whether a peer payment for human work is a "digital service" under Telegram's Stars rule is not settled by its text, so settlement would be web-only until answered | Decision 13; counsel |
| Bounty escrow on TON | A per-bounty contract in Tolk: funder deposits, one assignee, release on the funder's signature, refund on timeout. The funder deploys their own instance from their own wallet. No oracle key, because a Luminara signature that released funds would be releasing funds between users | A new contract needs its own outside audit and its own legal sign-off, testnet first (J1, J3). TN decision D4 recommends deferring | Decision 13; audit; counsel; the mainnet gates in Zoro 7.4 |
| On-chain soulbound badges | Two designs are recorded. **(a) Owner-signed batches on standard code:** the reference TEP-85 collection, deployed by the owner, who mints batches from their own wallet from a list the Worker prepares. No custom contract and no Worker key; the owner pays the gas and it is a manual step. **(b) A voucher:** the user's own wallet mints; the Worker signs a voucher (collection, owner address, badge id, receipt hash, expiry) with a dedicated key that cannot move funds; a custom contract checks the signature and mints to the sender, who pays the gas. In (b), a leaked voucher key lets anyone mint badges, so vouchers expire, the contract's signer can be replaced by the owner, and badges minted in the leak window can be marked revoked on the verify page. In both, the Worker sends no transaction | (a) keeps Zoro's "no custom contract" lock and does not scale past the owner's patience. (b) needs a new contract and a new signed-message format (today's receipt signature covers JSON bytes, not a cell hash). Either links a wallet to a business in public, so it must be opt-in. Zoro paused agent SBTs | Decision 14; for (b), audit and testnet first |
| Third-party sellers in Jobs | Sellers with a published passport and receipts; Luminara lists, does not hold or release money | Legal review (TN D5) | Decision 13 |
| An agent paying third parties from the founder's funds | None that keeps rule J1. Every known design (a session key, a spend permission, a funded agent wallet) puts a key that can move the founder's money somewhere Luminara runs | Zero custody | Not planned. Revisit only if the owner changes J1 |
| x402 on TON | The standard defines it; no production facilitator runs it, and self-hosting one needs a funded relay wallet | Zero custody | Revisit when a third-party TON facilitator exists |
| Desktop folder bridge | Fixer writes its prepared files into a folder the user picked once, so the fix lands in their site's source | A standing write grant to a folder is a real capability on the user's machine; it needs its own threat model and review | Decision 12, second part |
| Gated community groups | TN8 Circles as written. One builders chat is taken out of this row by decision 19 (section 14.3) | The rest stays parked at TN decision D6 until 50 verified profiles exist | TN D6 |
| Wallet link | Link a TON wallet to an existing account by `ton_proof`: a single-use nonce issued by the server and bound to the signed-in account; the signature checked; the public key taken from the wallet's state init and matched to the claimed address; the domain checked against an allow-list (the manifest names `www.luminarasuite.com` while the app can load from the apex); a short freshness window; and the network checked separately, because the proof does not bind it. One wallet per account and one account per wallet, as two unique keys, so a wallet cannot be used to stack accounts. Unlinking is allowed and recorded. The address is stored against the account and shown only to its owner | It publishes nothing by itself, but every later on-chain feature would tie a wallet to a business in public. Not a third way to sign in: a wallet costs nothing to create, so wallet sign-in would let one person farm invite credits | Decision 21 |
| A builders directory, in place of bounties for now | Founders who opt in list what they do and how to reach them. Contact is direct. Luminara takes no fee, holds nothing and releases nothing | It needs the moderation minimum (14.6) and project pages; it is the interim the owner can have while counsel reviews bounties | Decision 13 |
