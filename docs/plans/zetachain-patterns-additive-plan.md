# ZetaChain Architectural Patterns: Additive Plan (Track ZP)

**Status:** v1.0. Approved 2026-10-07. Additive and complementary to existing tracks.
**Date:** 2026-10-07
**Pattern source:** ZetaChain Whitepaper v0.5.0 (*ZetaChain: A Blockchain with Native Cross-chain Smart Contracts*). Concepts and architectural patterns only; Luminara brand, SQLite/D1 tables, and clean copy.
**Companions (binding):** `specs/0017-trust-receipts.md`, `specs/0016-agent-passport.md`, `docs/plans/oracle-operations-layer-additive-plan.md`, `docs/plans/trust-network-additive-plan.md`, `docs/plans/budget-policies-and-enforcement.md`, APS invariants in `AGENTS.md`.

---

## 0. Verdict

### 0.1 The Core Insights

ZetaChain solved extreme cross-network fragmentation (incompatible UTXO vs EVM vs SVM chains, disparate gas currencies, state sync bloat across asynchronous chains, and unrecoverable partial failures) by establishing:
1. **Universal Execution Gateway (`onCall`)**: Centralizing execution logic into a single deterministic hub rather than duplicating logic across fragmented platforms.
2. **Synthetic UTXO Lifecycle with First-Class Revert (`onRevert`)**: Tracking state transitions atomically with automatic refund and repair on failure.
3. **Universal Gas Abstraction**: Enabling users to transact with a single balance while the system synchronously handles external resource fees.
4. **Observer-Attester Separation**: Decoupling raw external observations from authenticated signing actions.
5. **Universal Entity Interface (ZRC-20 Analogue)**: Treating heterogeneous external assets under a single canonical contract interface.

In Luminara Suite, these same architectural concepts solve our primary friction points:
- **Zero Wasted Quota**: If an audit or tool execution drops midway (429 rate limit or network error), `onRevert` automatically refunds the user's daily quota/credits and records the diagnostic state.
- **Unified Omnichannel Runtime**: Web, Telegram Mini App, Desktop Electron, and MCP agents execute through the exact same `UniversalOracleGateway`.
- **Resource Tank**: Eliminates multi-key confusion (Groq vs NIM vs Ollama vs Tavily vs Firecrawl) by auto-resolving credentials and synchronously falling back to healthy providers.
- **Universal Brand Passport**: Unifies Business DNA, domain ownership receipts, and trust badges into a portable, verified brand identity.

### 0.2 Non-Goals (Locked)

- No token, no cryptocurrency, no smart contracts deployed to public blockchains, no staking, no yield.
- No custody: the Worker never holds user private keys or user funds.
- No em dashes (U+2014) anywhere in new copy or code comments. Use `-`, `:`, or `.`.
- No invented SEO or AEO metrics: unmeasured parameters stay `not_measured`.
- No disruption or breaking changes to existing routes or interfaces.

---

## 1. Technical Specification

### 1.1 Synthetic Task Lifecycle Engine (`worker/taskLifecycle.ts`)

Every analytical task (Instant Audit, Deep Scrape, Citation Integrity, Agent Job) runs inside `executeWithLifecycle`:

```typescript
export type TaskState = 'initiated' | 'observing' | 'executing' | 'settled' | 'reverted';

export interface TaskLifecycleContext {
  taskId: string;
  accountId: string;
  surface: 'web' | 'tma' | 'mcp' | 'cron';
  targetDomain: string;
  state: TaskState;
  refundOnRevert: boolean;
  diagnostics: string[];
}
```

Lifecycle flow:
1. **Initiate**: Assign unique `taskId`, verify authentication, check rate limit and budget.
2. **Observe**: Fetch live external data (SERP, site scrape, DNS). If an unrecoverable network or provider failure occurs, trigger `onRevert`.
3. **Execute**: Run LLM reasoning or analytical synthesis using the configured model failover chain.
4. **Settle**: Return final payload, write `audit_runs` status `completed`, and emit telemetry.
5. **Revert**: If any unhandled error or fatal upstream failure occurs:
   - Restore daily quota or held credits for the account.
   - Record `reverted = 1` in `cost_events` / `audit_runs`.
   - Return clean, instructive diagnostic error without leaking internal secrets.

### 1.2 Universal Resource Tank (`worker/resourceTank.ts`)

The Resource Tank provides synchronous provider resolution:
- Reads available BYOK keys from headers (`x-provider-key`) or local client config.
- Checks hosted keys and server health (`loadServerHealth`).
- Determines the active subscription plan and credit balance.
- Assembles an optimal execution plan (Primary LLM: Groq -> NIM -> Gemini; Search: Tavily -> Local SERP -> Free Web Search).
- In the event of a 429 or 503, switches seamlessly to the next tier without user intervention.

### 1.3 Universal Brand Passport (`services/trust/brandPassport.ts`)

Unifies brand identity under a standard representation:
- Domain ownership verification (via `worker/domainVerification.ts` & `specs/0017`).
- Business DNA (name, mission, audience, competitors).
- Cryptographic Trust Receipts (Ed25519 signed by Luminara).
- Canonical JSON-LD export (`Organization` schema with verified `sameAs` entity links).

### 1.4 Dual-Representation Private Memory (`services/vfs/vfsMemoryService.ts`)

Implements ZetaChain's dual-representation memory architecture:
- **Local sovereign representation**: Structured categories in VFS storage (`profiles`, `preferences`, `entities`, `events`, `cases`, `constraints`). Negative constraints ("WHAT TO NEVER BRING UP", banned claims, off-limit competitors) are directly editable by the user.
- **Sanitized prompt projection (`getSanitizedMemoryProjection`)**: Before memory items are dispatched to external inference engines (Groq, NVIDIA NIM, Gemini, OpenRouter), payloads pass through `sanitizePii()`. Personal identifiers (emails, phone numbers) and sensitive credentials (API keys, JWTs, Bearer tokens) are redacted, returning a clean, secure prompt block.

### 1.5 State of AI Router Telemetry Board (`components/settings/RouterTelemetryBoard.tsx`)

Modeled after the ZetaChain Research "State of Private AI" network telemetry board:
- Real-time provider request share distribution across Groq, NVIDIA NIM, Ollama, OpenRouter, and FreeLLM.
- Total token volume and latency tracking from `luminara_inference_usage_v1`.
- Dynamic commercial savings calculation against standard proprietary LLM rates.
- Status badge certifying Zero-Loss Task Lifecycle protection.

---

## 2. Quality Gates & Verification

All quality gates passed and verified in production build:
1. `npm run typecheck` (tsc + worker tsc + honesty gates: 0 errors, 0 new violations).
2. `npm run lint` (ESLint: 0 errors, 113 grandfathered warnings under 400 cap).
3. `npm test` (Vitest: 161 test files passed, 1514 tests passed).
4. `npm run build` (Vite production bundle built cleanly).
5. Zero-loss task rollback and dual-representation memory sanitizer verified by unit test suites.

