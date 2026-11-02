# Luminara Suite: Production Launch Checklist (`docs/launch-checklist.md`)

**Product:** Luminara Suite (`https://luminarasuite.com`)  
**Stack:** React 19 + Vite -> Cloudflare Workers (`luminara-search-oracle-agent`) + Cloudflare D1 (`luminara-users`) + Durable Objects (`OracleSession`, `RateLimiterDO`, `WebhookThrottleDO`) + Vectorize + R2 + Stripe / Telegram Stars / TON.

Every step below is tagged so you know who owns the action:
- **🧑 You**: Requires your browser, credentials, or operator sign-off.
- **🤖 Agent**: Commands your coding agent runs and verifies for you.
- **🤝 Together**: Agent prepares the command or payload; you approve or paste the secret.

---

## Phase A: Pre-Flight Quality Gates (Local Workspace)

### 1. Run Static, Security, Type, Lint, Test & Bundle Gates
**🤖 Agent**
```bash
npm run secrets:check
npm run tokens:check
npm run env:validate
npm run typecheck
npm run lint
npm test
npm run build
node scripts/smoke-check.mjs --dry-run
```
- **What this verifies**: Zero leaked keys across 2,100+ files, valid `wrangler.jsonc` environment bindings (`STRIPE_CHECKOUT_LIVE`, `LUMENS_ENABLED`, `CHAIN_NETWORK`), zero TypeScript or ESLint errors, passing unit/integration suites (including Wave `0044` Agentic Memory & Vault and PMF telemetry parity), and clean `dist/` bundle split (no PDF or TonConnect bloat in the entry chunk).

### 2. Apply Wave `0044` Migration to Local D1
**🤖 Agent**
```bash
npm run db:migrate:local
```
- **What this verifies**: Applies `migrations/0044_agentic_memory_and_vault.sql` cleanly against the local SQLite D1 store (`memory_edges`, `memory_vault_snapshots`, `agent_trace_spans`, `mcp_external_servers`, and `memory_facts` scoped columns).

---

## Phase B: Staging Cutover (`https://staging.luminarasuite.com`)

### 3. Apply D1 Migration `0044` on Staging
**🤝 Together**
```bash
npm run db:migrate:staging
```
- **Target D1**: `luminara-users-staging` (`2aeb897a-d2d4-462b-89c5-0d9efbf093fe`).
- **Why before deploy**: Applying `0044` before deploying the Worker ensures `memory_edges`, `memory_vault_snapshots`, and `agent_trace_spans` exist immediately (though the Worker also has schema-safe `try/catch` fallbacks if run pre-migration).

### 4. Deploy Worker & Assets to Staging + Run Staging Smoke Check
**🤝 Together**
```bash
npm run deploy:staging
npm run smoke:staging
```
- **What this verifies**: Deploys `luminara-search-oracle-agent-staging`, verifies all required D1 tables on `luminara-users-staging`, and checks `/api/health`, `/api/findings?domain=smoke.example.com` (`401`), `/api/enquiries` (`401`), `/api/memory/unified/timeline` (`401`), `/api/agent-habitat/status?domain=smoke.example.com` (`401`), and security headers on `https://staging.luminarasuite.com`.

---

## Phase C: Production Cutover (`https://luminarasuite.com`)

### 5. Export Pre-Migration Production D1 Backup
**🤝 Together**
```bash
npm run db:backup:prod
```
- **What this does**: Exports a full SQL snapshot of `luminara-users` (`e828e0b0-491d-4d0b-b5ea-bd4bdd6c7b8a`) to `backups/prod-backup.sql` before any production schema change.

### 6. Apply D1 Migration `0044` on Production
**🤝 Together**
```bash
npm run db:migrate
```
- **What this does**: Applies `migrations/0044_agentic_memory_and_vault.sql` on remote production D1 (`luminara-users`).

### 7. Deploy Worker & Assets to Production + Run Production Smoke Check
**🤝 Together**
```bash
npm run deploy
npm run smoke:prod
```
- **Alternative (Automated via GitHub Actions)**: Merge `feat/aeo-compare-best-hub` into `main` via Pull Request. `.github/workflows/deploy-cloudflare.yml` automatically runs `d1 migrations apply` -> `wrangler deploy` -> `smoke-check.mjs` on staging and production.

---

## Phase D: External Console & Commercial Go-Live Checks

### 8. Verify Stripe Live Checkout & Webhook Delivery
**🧑 You**
- Production `/api/health` already reports `"stripeCheckout": true`.
- In the **Stripe Dashboard -> Developers -> Webhooks**, confirm the production webhook endpoint (`https://luminarasuite.com/api/stripe/webhook`) is active for `checkout.session.completed` and has `0` failed deliveries.
- Run one real `$1` / Starter card checkout or promo-discounted checkout on `https://luminarasuite.com/pricing` and confirm `stripe_credited_sessions` records the session in D1.

### 9. Enable Firebase App Check Enforcement (`VITE_FIREBASE_APPCHECK_SITE_KEY`)
**🧑 You**
- Follow `docs/ops/beginner-azure-and-app-check.md`:
  1. In **Google Cloud reCAPTCHA Enterprise** + **Firebase Console -> App Check**, register `luminarasuite.com` and `staging.luminarasuite.com`.
  2. Set `VITE_FIREBASE_APPCHECK_SITE_KEY` in `.env.production` / GitHub Actions build variables and confirm `FIREBASE_PROJECT_NUMBER` is set on the Worker.
  3. Roll out `APPCHECK_ENFORCE` in 3 stages in `wrangler.jsonc`: keep `"off"` until client tokens flow, promote to `"log"` (already active in staging) to inspect `{"event":"appcheck","mode":"log"}` logs with zero user impact, then promote to `"enforce"` (and optionally `REQUIRE_APP_CHECK="true"`).
  4. Verify readiness via the admin-authorized health endpoint (`x-admin-secret: <ADMIN_SECRET>`): check `appCheckMode`, `appCheckProjectNumberConfigured`, and `stripeConfigured`.

### 10. Optional: Open TON Mainnet / Testnet Crypto Checkout Rail
**🧑 You**
- Currently `/api/health` reports `"ton": false` as a deliberate safety gate until you confirm wallet ownership of `TON_RECEIVING_ADDRESS` via `TON_CONFIRMED_ADDRESS`.
- To open TON checkout when ready, set `TON_CONFIRMED_ADDRESS` to match `TON_RECEIVING_ADDRESS` (either in `wrangler.jsonc` under `env.production.vars` or via secret):
  ```bash
  npx wrangler secret put TON_CONFIRMED_ADDRESS --env production
  ```

### 11. Commercial Credibility Cohort Gate (CC5)
**🧑 You**
- Track the anonymous-to-paid funnel in D1 (`product_analytics_events` linked via durable `session_id` from `luminara_guest_id` and `stripe_credited_sessions`):
  `probe_completed` -> `signup_completed` -> `instant_audit_completed` -> `checkout_started` -> `payment_completed` -> `fix_shipped` -> `mission_completed`.
- Query live funnel and cohort counts at any time with your admin token:
  ```bash
  curl -sS -H "x-admin-secret: $ADMIN_SECRET" "https://luminarasuite.com/api/admin/analytics/funnel?days=30"
  ```
- Record your first 10 paying accounts and 14-day retention outcomes in `docs/case-studies/cohort-01.md` per `docs/plans/commercial-credibility-100x-ship.md`.
