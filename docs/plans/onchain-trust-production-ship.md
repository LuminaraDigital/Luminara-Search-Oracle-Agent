# On-Chain Trust Production Ship Plan

**Status:** Phase 0 code implemented (v1.2.0) - awaiting operator soak inputs  
**Owner:** Luminara Digital (CEO gate on Phase 5 mainnet)  
**Version:** 1.2.0  
**Date:** 2026-10-01  
**Parent PRD:** `docs/plans/prd_onchain_trust_layer.spec.json` (PRD-LS-2026-001)  
**Related:** ZORO steal map (concepts only; no speculative token)  
**CEO review:** [195d38a6](195d38a6-54f7-4fb3-9a6b-20d572803306) plan GO; [3b5e8297](3b5e8297-2b1e-4387-a51e-9799e3580b39) impl Conditional GO for staging merge after ops inputs

## 0. Executive verdict

Luminara already has production TMA auth, Telegram Stars, TonConnect, and mainnet TON subscription settlement. It does **not** yet have network gating, XDC wiring, or on-chain audit proofs. Staging currently verifies TON against **mainnet** Toncenter and shares the production merchant address. That is the highest-priority production risk and the Phase 0 blocker.

**Non-goals (locked):** no new protocol token, no ICO, no custodial user seeds, no mainnet contracts before Phase 5 gate.

**Product posture:** sell verifiable AEO/SEO proofs (Stars / TON / fiat), not labeled datasets. Steal Zoro's attestation, Telegram distribution, quests, and referral *patterns*; skip annotation marketplace and token-weighted DAO.

---

## 1. Baseline (verified 2026-10-01)

| Capability | Status | Evidence |
|------------|--------|----------|
| TMA auth + initData HMAC | Live | `services/telegram/tma.ts`, `worker/telegramAuth.ts` |
| Stars checkout + D1 claims | Live | `worker/telegramBot.ts`, `migrations/0004_payment_atomicity.sql` |
| TON invoice/verify + ledger | Live | `worker/tonPayment.ts`, `worker/paymentLedger.ts` |
| TonConnect UI | Live | `index.tsx`, `public/tonconnect-manifest.json` |
| Off-chain PoA digest (KV) | Partial | `worker/attestationService.ts`, `services/agentCore/tonAttestationService.ts` |
| `CHAIN_NETWORK` / XDC RPC | **Absent** | Not in `worker/env.ts` or `wrangler.jsonc` |
| CitationRegistry / proof_anchors | **Absent** | Spec only; migrations stop at `0016` |
| Radar Battles (M5) | **Absent** | Spec only |
| Staging vs prod TON network split | **Fixed in code** | Staging `CHAIN_NETWORK=testnet` + kQ placeholder; prod mainnet UQ. Operator must replace staging placeholder with funded wallet. |

Specialist audits: [chain baseline](eb7aafbc-16b4-4feb-803c-12257de488f5), [TMA/trust](d42a07aa-1be0-4915-bcc8-1d08acfe1c7a), [deploy readiness](98894ae1-237e-44de-84d6-6bec7b6743f1).

---

## 2. Dependency graph (build order)

```
Phase 0  CHAIN_NETWORK + TON testnet gate + XDC RPC stub + proof_anchors ledger
    |
    +-- Phase 1  Citation Oracle (TON testnet hash anchor) + badge/verify API
    |       |
    |       +-- Phase 2  TMA Radar Battles + share badges (Stars/TON micro SKUs)
    |               |
    |               +-- Phase 3  Agent SBT + XDC AA remediation escrow (testnet)
    |                       |
    |                       +-- Phase 4  Federated mesh (enterprise)
    |
    +-- Phase 5  Mainnet promotion gate (audit + bounty + dress rehearsal)
```

Vertical slices ship working value at each phase. Do not start Phase 3 contracts until Phase 1 has a staging soak with real testnet explorer links.

---

## 3. Phase 0: CHAIN_NETWORK / XDC RPC / fail-closed gating

**Goal:** Staging is truly testnet. Production is truly mainnet. Cross-network credit is impossible. XDC RPC is configured and health-probed even before first XDC write.

### 3.1 Env schema (`worker/env.ts`)

Add:

| Var | Type | Required when | Values |
|-----|------|---------------|--------|
| `CHAIN_NETWORK` | string | Always when TON enabled | `testnet` \| `mainnet` |
| `CHAIN_TON_API_BASE` | string | Always when TON enabled | Host+path, no trailing slash preferred |
| `CHAIN_TON_API_FALLBACK_BASE` | string | Optional | TonAPI v2 base for same network |
| `CHAIN_XDC_RPC_URL` | string | Always when `PROOF_XDC_ENABLED=true`; recommend set on staging from Phase 0 | Apothem or mainnet RPC |
| `PROOF_ANCHOR_ENABLED` | string | Feature flag | `true` \| `false` (default false until Phase 1) |
| `PROOF_XDC_ENABLED` | string | Feature flag | `true` \| `false` (default false until Phase 1 weekly path) |

Keep existing: `TON_RECEIVING_ADDRESS`, `TON_API_KEY`, `ENVIRONMENT`.

### 3.2 Wrangler vars (`wrangler.jsonc`)

**Staging (`env.staging.vars`):**

```
CHAIN_NETWORK = "testnet"
CHAIN_TON_API_BASE = "https://testnet.toncenter.com/api/v3"
CHAIN_TON_API_FALLBACK_BASE = "https://testnet.tonapi.io"
CHAIN_XDC_RPC_URL = "https://rpc.apothem.network"
PROOF_ANCHOR_ENABLED = "false"
PROOF_XDC_ENABLED = "false"
TON_RECEIVING_ADDRESS = "<dedicated testnet kQ/0Q merchant>"
```

**Production (`env.production.vars`):**

```
CHAIN_NETWORK = "mainnet"
CHAIN_TON_API_BASE = "https://toncenter.com/api/v3"
CHAIN_TON_API_FALLBACK_BASE = "https://tonapi.io"
CHAIN_XDC_RPC_URL = "https://erpc.xinfin.network"
PROOF_ANCHOR_ENABLED = "false"
PROOF_XDC_ENABLED = "false"
TON_RECEIVING_ADDRESS = "<existing mainnet UQ/EQ merchant>"
```

**Critical fix:** replace shared staging merchant with a dedicated testnet wallet. Never reuse `TON_API_KEY` across networks (separate `wrangler secret put --env staging|production`).

#### 3.2.1 Local / top-level wrangler vars

Root `wrangler.jsonc` `vars` (default Worker path) must also declare `CHAIN_*` / `PROOF_*` so `Env` types match every deploy path. Prefer mirroring **production** mainnet defaults at top level, and require local TON testnet work via `wrangler dev --env staging`. Document the same keys in `.dev.vars.example`, `.env.staging.example`, and `.env.production.example`.

### 3.3 Fail-closed rules (`worker/tonPayment.ts`)

Extend `isTonPaymentConfigured` / invoice creation:

1. `CHAIN_NETWORK` must be exactly `testnet` or `mainnet`.
2. Address `testnet` flag must equal (`CHAIN_NETWORK === 'testnet'`).
3. `ENVIRONMENT=production` implies `CHAIN_NETWORK=mainnet` and rejects kQ/0Q (existing guard kept).
4. Staging should set `CHAIN_NETWORK=testnet` and require a testnet-flagged merchant (validate-env).
5. Resolve Toncenter + TonAPI URLs **only** from `CHAIN_TON_*` env. Refactor `findMatchingTonPayment` to **Toncenter v3** (`GET {CHAIN_TON_API_BASE}/transactions?account=…&limit=…&start_utime=…`) with a **new response parser** (v2 `getTransactions` shape must not be assumed). Capture **masterchain seqno** (`mc_seqno` or follow-up masterchain info) for `proof_anchors.seqno`. TonAPI fallback must use `CHAIN_TON_API_FALLBACK_BASE` for the same network. This is not a host-string swap.
6. On mismatch or unset: return `TON_UNAVAILABLE_ERROR`; do not credit.

**Raw `0:`/`-1:` addresses:** today treated as `testnet: false`. Phase 0 decision: reject raw addresses for merchant config in validate-env, or require `CHAIN_NETWORK` match via explicit allowlist. Prefer reject for merchant config to close the blind spot.

### 3.4 Migration `0017_proof_ledger.sql` (Phase 0 ships schema; writers stay behind flags)

```sql
-- proof_anchors: payment + future audit attestations
CREATE TABLE IF NOT EXISTS proof_anchors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- 'ton_payment' | 'audit_citation' | 'xdc_recheck'
  audit_run_id TEXT,
  order_id TEXT,
  domain TEXT,
  evidence_hash TEXT,
  chain TEXT NOT NULL,              -- 'ton' | 'xdc'
  network TEXT NOT NULL,            -- 'testnet' | 'mainnet'
  contract TEXT,
  tx_hash TEXT,
  seqno INTEGER,
  explorer_url TEXT,
  status TEXT NOT NULL,             -- 'pending' | 'anchored' | 'failed' | 'superseded'
  error TEXT,
  created_at TEXT NOT NULL,
  anchored_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_proof_anchors_domain ON proof_anchors(domain);
CREATE INDEX IF NOT EXISTS idx_proof_anchors_tx ON proof_anchors(tx_hash);
CREATE INDEX IF NOT EXISTS idx_proof_anchors_order ON proof_anchors(order_id);

CREATE TABLE IF NOT EXISTS proof_schedules (
  domain TEXT NOT NULL,
  account_id TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'weekly',
  next_run_utc TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (domain, account_id)
);

CREATE TABLE IF NOT EXISTS chain_invoices (
  order_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  plan TEXT NOT NULL,               -- e.g. domain_proof
  amount_nano TEXT NOT NULL,
  memo TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Phase 0 writer: on successful TON credit, insert `proof_anchors` row (`kind=ton_payment`) with `seqno`, `network`, `tx_hash`, explorer URL derived from `CHAIN_NETWORK`.

#### 3.4.1 Backfill (Phase 0 done gate)

One-time SQL or `scripts/` job inserts `proof_anchors` from existing `ton_credited_tx` rows (`kind=ton_payment`, `network` from deploy-time `CHAIN_NETWORK`, `seqno` nullable/`unknown` when historic seqno is unavailable). Do **not** mark Phase 0 complete without this backfill or an explicit CEO waiver.

### 3.5 XDC RPC module (stub, production-shaped)

New `worker/chain/xdcRpc.ts`:

- `getXdcRpcUrl(env)` reads `CHAIN_XDC_RPC_URL`
- `probeXdcRpc(env)`: JSON-RPC `eth_chainId`. Apothem `0x33` (51) and mainnet `0x32` (50) verified via live RPC 2026-10-01; still fail closed on mismatch when `PROOF_XDC_ENABLED=true`
- Fail closed if `PROOF_XDC_ENABLED=true` and probe/chainId mismatch
- No writes in Phase 0

Health: extend `/api/health` JSON with `chainNetwork` and `xdcRpcOk` (optional probe). Keep existing `ton` boolean (`isTonPaymentConfigured`); do not break clients that already read `ton`. Never leak keys.

### 3.6 validate-env + CI

Update `scripts/validate-env.mjs` + `scripts/lib/tonAddress.mjs`:

| Check | Staging | Production |
|-------|---------|------------|
| `CHAIN_NETWORK` | must be `testnet` | must be `mainnet` |
| Merchant address | must be testnet-flagged | must pass `checkProductionTonAddress` |
| `CHAIN_TON_API_BASE` | must contain `testnet` host | must be mainnet host (no `testnet.` prefix) |
| `CHAIN_XDC_RPC_URL` | Apothem host | mainnet RPC host |

Extend `scripts/smoke-check.mjs`: add `migrations/0017_proof_ledger.sql` to `REQUIRED_D1_MIGRATIONS` and `proof_anchors` to `REQUIRED_D1_TABLES`.

### 3.7 Tests (Phase 0 acceptance)

- [ ] Staging env fixture: testnet merchant + testnet API base verifies; never writes mainnet explorer URL
- [ ] Production env: kQ address rejected
- [ ] `CHAIN_NETWORK=mainnet` + testnet address => `isTonPaymentConfigured` false
- [ ] `CHAIN_NETWORK` unset => TON unavailable
- [ ] Mock fetcher asserts request URL starts with env base
- [ ] Successful credit persists `proof_anchors` with seqno + network
- [ ] XDC probe unit test with mocked `eth_chainId`

### 3.8 Phase 0 deploy runbook

1. Create staging testnet merchant wallet; fund via Testgiver bot
2. `wrangler secret put TON_API_KEY --env staging` (testnet Toncenter key)
3. Update `wrangler.jsonc` staging vars (section 3.2)
4. PR: code + migration + tests
5. Merge to `staging` -> CI migrate -> deploy -> smoke
6. Manual: pay 0.05-1 testnet TON invoice; confirm credit + `proof_anchors` row + testnet explorer link
7. Soak 7 days minimum before Phase 1 contract work on staging (4 weeks preferred per PRD metrics)
8. Production Phase 0: only env schema + fail-closed + migration; keep `PROOF_*=false`; merchant stays mainnet; verify no behavior change for live TON checkout. No new **on-chain** marketing claims. Optional Phase 0.5: label existing KV PoA as an **off-chain digest** in badge/modal (full honesty fix remains Phase 1 §4.6).
9. Run §3.4.1 backfill on staging (then production after migrate) or record CEO waiver

### 3.9 Phase 0 double-check gate

Before marking Phase 0 done:

- [ ] No hardcoded `toncenter.com/api/v2` left in `worker/tonPayment.ts`
- [ ] Staging and production merchant addresses differ
- [ ] `npm run typecheck && npm run lint && npm test && npm run build` green
- [ ] Staging smoke + one real testnet payment recorded
- [ ] CEO/ops confirms secrets are not shared across envs

---

## 4. Phase 1: Verifiable Citation Oracle (M1)

**Goal:** Every completed audit can emit a tamper-evident evidence hash anchored on TON testnet; public verify + badge.

### 4.1 Evidence pipeline

On `audit_runs` -> completed:

1. Canonical SHA-256 over ordered digests: HTML payload, schema/JSON-LD, citation URL list, serialized reasoning from `result_json` / findings
2. Idempotent: same inputs => same hash (property test)
3. Insert `proof_anchors` pending row; Worker minter sends Tolk CitationRegistry message (ops hot wallet only)

### 4.2 Contracts (TON testnet first)

- Language: Tolk 1.0
- Store: `(domain_hash, audit_id) -> evidence_hash, seqno, timestamp`
- Only designated minter can write
- Pause flag for emergencies

Repo layout (proposed): `contracts/ton/CitationRegistry.tolk` + deploy scripts under `scripts/chain/` (not nested product folder).

### 4.3 XDC weekly path (behind `PROOF_XDC_ENABLED`)

- Cron `0 8 * * *` enrolls domains from `proof_schedules`
- Meta-tx to Apothem; gas from pre-funded pool
- Checkpoint later to XDC mainnet only in Phase 5

### 4.4 APIs

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/proof/anchor` | Internal / service |
| GET | `/api/proof/verify?domain=` | Public |
| POST | `/api/proof/badge` | Session or public digest |
| MCP | attestation tool on existing `/mcp` | MCP session |

Phase 1 may **alias** `/api/proof/*` to new handlers and wrap or deprecate live `/api/agent/attest` (KV digest store). Prefer an MCP tool in `worker/mcpServer.ts` over a separate `/api/mcp/attestation` REST route unless that route is added deliberately.

Extend existing UI: `ProofOfAuditBadgeModal`, `VerifyAttestationView`, `ReportDisplay` trust row. Always label network on badge.

### 4.5 Monetization

SKU `domain_proof`: ~$50/mo equivalent; Stars + TON (`TON_PRICING.domain_proof`) + Square if present. Staging: cheap testnet amount (e.g. 2 TON testnet).

### 4.6 Phase 1 double-check

- [ ] Tamper one byte of evidence => verify fails
- [ ] Testnet proof cannot satisfy mainnet verify
- [ ] Anchor within 60s of audit complete on staging
- [ ] Copy no longer claims "on-chain" for KV-only digests

---

## 5. Phase 2: TMA Radar Battles (M5) + Zoro distribution patterns

**Goal:** Viral brand-vs-brand AEO battles inside Telegram; each result links Phase 1 proof.

### 5.1 Product

- `POST /api/tma/battle`, `GET /api/tma/battle/:id`
- Dual `VisibilityRadar` comparison UI
- Start params: `battle_<id>`, fix existing `audit_<domain>` prefill gap in `App.tsx`
- SKUs: `battle_single`, `battle_pack` (Stars + TON)
- Quests / referral: Stars credit or free battle unlock (no token)

### 5.2 Phase 2 double-check

- [ ] Share rate instrumentation in product analytics
- [ ] Badge embeds network-labeled proof URL
- [ ] Payment ledger claims for new SKUs

---

## 6. Phase 3: Agent registry + remediation (M2 + M3)

- TON TEP-85 SBT for agent identity
- XDC Etherspot EIP-7702 + paymaster (HSM)
- Escrow release requires independent verifier re-crawl
- Per-finding remediation fees $10-$50
- Reputation from Zoro-style consensus adapted to agents (not annotators)

Gate: Phase 1 contract audited on testnet; funds capped.

---

## 7. Phase 4: Federated mesh (M4)

- Local crawler nodes + encrypted gradients to XDC subnet
- Enterprise B2B $500-$2,000/mo
- ZK provenance optional after hash lineage proven
- No speculative token incentives; usage vouchers only after legal review
- PRD M4 "token incentives" language is **out of scope** per locked non-goals

---

## 8. Phase 5: Mainnet promotion gate

Hard gate (all required):

1. Third-party audit of Tolk + Solidity/AA contracts
2. Public bug bounty 2-4 weeks on testnet
3. Dress rehearsal with company funds on mainnet staging
4. Pause flags + Worker `PROOF_*` / `CHAIN_NETWORK` kill switches
5. Rollback runbook: `wrangler rollback` + `proof_anchors.status=superseded`
6. CEO sign-off

---

## 9. Production / deployment matrix

| Step | Staging | Production |
|------|---------|------------|
| Branch | `staging` | `main` |
| Workflow | `deploy-cloudflare.yml` | same |
| Order | backup (recommended) -> migrate -> deploy -> smoke | **Manual** `CONFIRM_PROD_BACKUP=1 npm run db:backup:prod` (operator, not CI); then migrate -> deploy -> smoke |
| Gates | PR green CI (`ci.yml`: typecheck, lint, coverage, evals) | same + soak evidence |
| Rollback | `wrangler rollback --env staging` | `--env production` |
| Kill switch | unset/mismatch `CHAIN_NETWORK` or `PROOF_*=false` | same |

**Do not** use `scripts/sync-hosted-secrets.mjs --apply` for staging/production TON keys; that script targets the **default** Worker only (no `--env` flag). Use `npx wrangler secret put TON_API_KEY --env staging|production` per environment.

Feature flags follow existing string-var pattern (`ORACLE_*`, `AUDIT_QUEUE_ENABLED`).

Observability adds: health chain fields, `[Proof]` / `[TON]` logs with network+seqno, alert on `proof_anchors.status=failed`.

---

## 10. Work breakdown (implementable tasks)

### P0-T1: Env + wrangler network gate
**Acceptance:** types + staging/prod/top-level vars; validate-env enforces network/address pairing; `CHAIN_*` / `PROOF_*` documented in `.dev.vars.example`, `.env.staging.example`, `.env.production.example`  
**Files:** `worker/env.ts`, `wrangler.jsonc`, `.dev.vars.example`, `.env.staging.example`, `.env.production.example`, `scripts/validate-env.mjs`, `scripts/lib/tonAddress.mjs`  
**Verify:** `node scripts/validate-env.mjs --staging` / `--prod`

### P0-T2: tonPayment v3 URL + fail-closed + seqno
**Acceptance:** no hardcoded mainnet hosts; Toncenter **v3** parser + seqno capture; mismatch disables TON; tests use v3 JSON fixtures  
**Files:** `worker/tonPayment.ts`, `tests/tonPayment.test.ts`, `tests/tonAddress.test.ts`

### P0-T3: proof_anchors migration + payment writer + backfill
**Acceptance:** every new ton credit writes anchor row with seqno/network; historic `ton_credited_tx` backfilled or CEO-waived; smoke lists migration 0017 + `proof_anchors`  
**Files:** `migrations/0017_proof_ledger.sql`, `worker/paymentLedger.ts` or tonPayment, `scripts/smoke-check.mjs`, optional `scripts/` backfill

### P0-T4: XDC RPC probe stub
**Acceptance:** health reports `xdcRpcOk` on staging Apothem; wrong chainId fails when enabled  
**Files:** `worker/chain/xdcRpc.ts`, `worker/index.ts` health, tests

### P0-T5: Staging soak
**Acceptance:** real testnet payment E2E documented in ops note  
**Deps:** T1-T4

### P1-T1..T5: Evidence hash, Tolk registry, APIs, badge UI, domain_proof SKU
### P2-T1..T4: Battle API, TMA UI, SKUs, share/quests
### P3+/P4/P5: Per sections 6-8

Each task ends with: run AGENTS.md gates, fix failures, re-run gate (double-check).

---

## 11. Risks (production)

| Risk | Mitigation |
|------|------------|
| Staging credits mainnet txs | Phase 0 env bases + different merchant |
| User confuses testnet badge | Network label + verify rejects cross-network |
| Contract bug | Testnet-only until Phase 5; pause; capped funds |
| Relayer centralization | Multi-relayer later; Phase 1 TON minter is intentional ops wallet |
| "On-chain" marketing lie | Fix badge copy in Phase 1; KV != chain |
| Token/regulatory creep | Non-goals locked; legal review before any voucher incentives |

---

## 12. Success metrics

| Phase | Metric |
|-------|--------|
| 0 | 100% new TON credits have seqno+network; 0 cross-network credits in staging soak |
| 1 | >=90% audits anchor <60s; verify p50 <800ms |
| 2 | Battle share rate >=25% |
| 5 | Zero open criticals post-audit/bounty |

---

## 13. Immediate next action

**Start P0-T1 + P0-T2 in one PR.** Do not open CitationRegistry contract work until staging TON testnet verify passes once end-to-end.

Engineering loop: validate this plan against code each tick; implement Phase 0 tasks in order; double-check after every task and after the phase.

---

## Appendix A: Zoro concept mapping (locked)

| Steal now | Adapt later | Skip |
|-----------|-------------|------|
| Cryptographic attestations | Agent reputation consensus | Annotation marketplace |
| Shareable proof lineage | Closed revenue -> gas pool | Speculative token / DAO vote by holdings |
| TMA distribution + quests + referrals | ZK circuits beyond hashes | BNB as primary chain |

## Appendix B: Double-check protocol

After every task:

1. Re-read acceptance criteria
2. Run targeted tests + typecheck
3. Grep for regressions (hardcoded mainnet URLs, shared secrets docs)
4. Fix before next task

After every phase:

1. Full AGENTS.md gate set
2. Staging smoke + manual path
3. Update this plan status line
4. CEO review for Phase 0 complete and Phase 5 mainnet
