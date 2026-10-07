# Spec 0016: Agent Passport (Track K)

Pattern source: Kite AI Agent Passport (public whitepaper, docs, agentpassport.ai), adapted to Luminara without chain, stablecoin, or token components. Brand: Luminara only.

## What

Agents act on a user's behalf under an explicit, visible, revocable grant:

1. **Three-tier authority.** Account (root: plan, monthly budget, BYOK) > agent client (an `lm_live_*` key or an `mcp_*` OAuth token, with scopes and later a monthly cap) > session (per task: budget, per-call cap, TTL, project and tool scope).
2. **Bounded loss stated before consent.** Session caps can never exceed the client's remaining allowance, and the client's can never exceed the account's. The approval screen shows the worst case.
3. **One activity ledger.** Every paid call, governance decision, approval, refusal, and revocation is one row, attributed to the credential and session that caused it.
4. **Receipts.** Saved reports carry a server-signed record of which agent, session, tools, and measured vs not-measured sources produced them.

## Why

Before this track, budgets, approvals, and the hash-chained audit log existed but applied only at account level and had no user surface. Users could not limit what one agent spends, could not see what agents did or tried, and OAuth scopes were issued but not enforced. Agencies cannot hand an agent a client budget, and share-link readers cannot tell measured numbers from model prose.

## Waves

| Wave | Scope | Status |
|------|-------|--------|
| K0 | Audit chain id unification, OAuth scope enforcement, credential attribution on `cost_events`, Oracle paid path metered | Done |
| K1 | Agent client caps + spending sessions (`request_session`, approve in web or Telegram) | Planned |
| K2 | `estimate_cost` preflight, cost metadata on tools, `PAYMENT_REQUIRED` envelope | Planned |
| K3 | Settings "Agents" tab: connected agents, live sessions, approvals inbox, activity feed, budget panel | Planned |
| K4 | Signed report receipts + public verify endpoint | Planned |
| K5 | Agent-first onboarding prompt, router skill, `llms.txt`, sandbox sessions | Planned |
| K6 | Progressive trust ceilings, hierarchical (project/client) budgets, alert delivery | Planned |

## K0 decisions

- **Personal org chain.** Account-scoped audit events use `org_<accountId>`, the id the audit reader already queries. Legacy rows keyed by raw accountId are merged on read, never rewritten, because rewriting `org_id` would invalidate the hash chain.
- **Scope enforcement without breaking live sessions.** New OAuth tokens carry a `scopeEnforced` marker. Tokens without it stay unrestricted until their 30-day TTL drains. Authorize without an explicit scope now requests both scopes, and plan caps still decide what is granted, so Agency clients that omit scope keep paid tools.
- **BYOK passes the scope gate.** `mcp:research` means "may spend hosted research credits". A BYOK call spends the caller's own provider account.
- **Attribution columns, not a new ledger.** `cost_events` gains `credential_kind` and `credential_id`. One spend table stays the source of truth (spec 0014).

## Alternatives considered

- **Chain-anchored identity and payments (Kite L1, x402 settlement).** Rejected for now. Luminara already carries TON, XDC, and Stars surface area; another rail adds risk without user value. The 402-shaped error envelope is kept for agent ergonomics.
- **Deriving per-agent keys cryptographically.** Unnecessary. Hashed bearer tokens plus D1 rows give the same revocation and blast-radius properties for a hosted service.
- **Rewriting legacy audit rows.** Rejected: breaks chain verification.

## Open questions

- Hosted margin over provider list price for K2 estimates.
- Whether sessions become mandatory for new keys after K3 ships.
