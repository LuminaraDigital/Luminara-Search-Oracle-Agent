# Hermes Agent patterns: staged rollout, QA overrides, and A/B readout

Top-level `vars` and `env.production.vars` ship off (`"off"` / `"false"`) in `wrangler.jsonc`, while `env.staging.vars` runs warn-soak and A/B measurement (`THREAT_SCAN_MODE="warn"`, `EPISTEMIC_AB_ENABLED="true"`, `ORACLE_LOOP_GUARDS_ENABLED="true"`, `MCP_DECLARED_COSTS_ENABLED="true"`). Soak on staging, verify D1 telemetry and false-positive rates, and promote to production one switch at a time.

## Runtime switches

| Binding | Values | Default | Behavior |
| --- | --- | --- | --- |
| `THREAT_SCAN_MODE` | `off` \| `warn` \| `strict` | `off` | `warn` records `threat_scan_triggered` in `product_analytics_events` without rejecting writes. `strict` rejects poisoned memory facts, RSI skill/prompt mutations, Dreaming proposals, and scheduled Citation Watch prompts (`400 THREAT_BLOCKED`) while keeping untrusted tool-output scans warn-only (`context` scope). |
| `EPISTEMIC_AB_ENABLED` | `false` \| `true` | `false` | Enables deterministic 50/50 account bucketing (`baseline` vs `treatment`) for epistemic stance separation (`## Unverified / Working Hypotheses`) and Dreaming's 1-retry JSON output contract. |
| `ORACLE_LOOP_GUARDS_ENABLED` | `false` \| `true` | `false` | Enables frozen `OracleSession` memory snapshots (`{ block, facts }`), session/browser `ToolLoopGuardrail` (3x identical call notice, `>= 512`-char duplicate stub, `period 2..4` cycle stop), cost-aware `EmptyResponseGuard`, and per-turn `VerificationLedger` provenance checks. |
| `MCP_DECLARED_COSTS_ENABLED` | `false` \| `true` | `false` | Appends `costCents`, `costUnit`, `requiredScope`, and `costNote` to live MCP `tools/list` annotations. (`plugins/luminara/plugin.json` always carries the static portable table.) |

## Recommended staging rollout order

1. **Threat scanner soak (`THREAT_SCAN_MODE="warn"`):** Run for 48 hours on staging. Inspect `threat_scan_triggered` rows in `product_analytics_events` to confirm zero false positives on legitimate SEO audits, code snippets, or emoji prompts before flipping staging to `"strict"`.
2. **Epistemic stance & Dreaming JSON contract A/B (`EPISTEMIC_AB_ENABLED="true"`):** Soak on staging and inspect the SQL readout below before enabling in production.
3. **Oracle loop & cache guards (`ORACLE_LOOP_GUARDS_ENABLED="true"`):** Enable on staging and verify multi-turn `OracleSession` conversations preserve memory-backed numbers and halt oscillating browser loops.
4. **MCP live cost annotations (`MCP_DECLARED_COSTS_ENABLED="true"`):** Enable once downstream MCP clients are verified to ignore unknown `annotations` keys gracefully.

## Deterministic QA overrides

While `EPISTEMIC_AB_ENABLED` is `"true"`, operators and QA suites can force either arm on HTTP or SSE endpoints via query parameter or header (overrides bypass crawler UA filtering so `curl` smoke tests can target a specific variant):

- Query parameter: `?epistemic=treatment` or `?epistemic=baseline` (also sets cookie `lx_epistemic` on browser responses).
- Request header: `x-luminara-epistemic-variant: treatment` or `x-luminara-epistemic-variant: baseline`.

Example staging QA checks:

```bash
# Seed a pending Dreaming signal, then force treatment arm on consolidation run
# (/api/dreaming/*, /api/oracle/chat, and /api/citation-watches/* use Firebase Bearer auth; /api/mcp uses lm_live_* API keys)
curl -sS -X POST "https://staging.luminarasuite.com/api/dreaming/events" \
  -H "Authorization: Bearer $STAGING_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"luminarasuite.com","eventType":"audit_completed","payload":{"summary":"QA smoke check"}}'

curl -sS -X POST "https://staging.luminarasuite.com/api/dreaming/run?epistemic=treatment" \
  -H "Authorization: Bearer $STAGING_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"luminarasuite.com","force":true}'

# Verify MCP tools/list cost annotations when MCP_DECLARED_COSTS_ENABLED=true
curl -sS -X POST "https://staging.luminarasuite.com/api/mcp" \
  -H "Authorization: Bearer $STAGING_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## D1 A/B & security telemetry readout

All events land in D1 `product_analytics_events` with PII-scrubbed `payload_json`.

Staging readout:

```bash
npx wrangler d1 execute luminara-users-staging --remote --env staging --command "<SQL below>"
```

Production readout:

```bash
npx wrangler d1 execute luminara-users --remote --env production --command "<SQL below>"
```

### 1. Epistemic A/B exposure, validator symmetry & Dreaming fallback rate

```sql
SELECT
  variant,
  unique_accounts,
  exposures,
  oracle_turns,
  oracle_validator_ok,
  oracle_leakage_hits,
  dream_runs,
  dream_fallbacks,
  dream_retries,
  CASE
    WHEN oracle_turns = 0 THEN NULL
    ELSE ROUND(CAST(oracle_validator_ok AS REAL) / oracle_turns, 4)
  END AS oracle_validator_pass_rate,
  CASE
    WHEN dream_runs = 0 THEN NULL
    ELSE ROUND(CAST(dream_fallbacks AS REAL) / dream_runs, 4)
  END AS dream_fallback_rate
FROM (
  SELECT
    json_extract(payload_json, '$.variant') AS variant,
    COUNT(DISTINCT CASE WHEN event_type = 'epistemic_ab_exposed' THEN COALESCE(account_id, session_id) END) AS unique_accounts,
    SUM(event_type = 'epistemic_ab_exposed') AS exposures,
    SUM(event_type = 'epistemic_validator_result') AS oracle_turns,
    SUM(event_type = 'epistemic_validator_result' AND json_extract(payload_json, '$.ok') = 1) AS oracle_validator_ok,
    SUM(CASE WHEN event_type = 'epistemic_validator_result' THEN COALESCE(json_extract(payload_json, '$.unverifiedLeakageCount'), 0) ELSE 0 END) AS oracle_leakage_hits,
    SUM(event_type = 'dream_contract_result') AS dream_runs,
    SUM(event_type = 'dream_contract_result' AND json_extract(payload_json, '$.usedFallback') = 1) AS dream_fallbacks,
    SUM(event_type = 'dream_contract_result' AND json_extract(payload_json, '$.contractRetried') = 1) AS dream_retries
  FROM product_analytics_events
  WHERE event_type IN ('epistemic_ab_exposed', 'epistemic_validator_result', 'dream_contract_result')
    AND json_extract(payload_json, '$.variant') IN ('baseline', 'treatment')
  GROUP BY variant
)
ORDER BY variant ASC;
```

### 2. Threat scanner audit query

```sql
SELECT
  json_extract(payload_json, '$.surface') AS surface,
  json_extract(payload_json, '$.mode') AS mode,
  json_extract(payload_json, '$.patternId') AS pattern_id,
  SUM(json_extract(payload_json, '$.blocked') = 1) AS blocked_count,
  COUNT(*) AS total_hits
FROM product_analytics_events
WHERE event_type = 'threat_scan_triggered'
GROUP BY surface, mode, pattern_id
ORDER BY total_hits DESC;
```

## Instant rollback

Reset any misbehaving flag in `wrangler.jsonc` (`"THREAT_SCAN_MODE": "off"`, `"EPISTEMIC_AB_ENABLED": "false"`, `"ORACLE_LOOP_GUARDS_ENABLED": "false"`, or `"MCP_DECLARED_COSTS_ENABLED": "false"`) and redeploy the affected environment (`npm run deploy:staging` or `npm run deploy`). No schema rollback is required because no destructive database migrations are introduced.
