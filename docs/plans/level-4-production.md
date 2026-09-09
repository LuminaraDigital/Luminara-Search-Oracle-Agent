# Level 4 Production Implementation Plan

**Goal:** Ship Tim Gabe Level 4 craft (POV / Consistency / Execution = 15/15 target) plus an industry-grade Privacy Policy, verified production-ready (typecheck, tests, build). Deploy only after explicit operator approval.

**Emotional theme:** Fog clearing at first light.

**Date:** 2026-09-10

## Requirements checklist

1. Level 4 P0: Quarantine Labs; Liquid Gold-only product path
2. Level 4 P1: Fog-clearing Plain English voice; remove Neural Core theatre
3. Level 4 P2: Ship-action gate + cite-or-silence on audit results
4. Level 4 P3: Home = Ask / Audit / Memory; DNA lock for full audit; Memory opens on diff
5. Industry-grade Privacy Policy page (truthful to sync, auth, payments, rights)
6. Production readiness: typecheck + relevant tests + build green
7. Loop until done (local monitored wake)

## Non-goals this pass

- Live production deploy (`npm run deploy` / push to main) without explicit user confirm
- Encrypting workspace key bag at rest (tracked as follow-up hardening)
- Automated account-deletion API (document manual path; optional follow-up)

## Phase map

| Phase | Work | Exit test | Status |
|-------|------|-----------|--------|
| P0 | Dashboard three-door; Labs/Harness/theme switcher behind `luminara_advanced_ui`; force Liquid Gold when advanced off | First-run user never sees Tokyo Night or SLM Studio | Done |
| P1 | Rewrite `SYSTEM_INSTRUCTIONS`; audit/report headings founder-brief style | Audit opener reads as founder brief | Done |
| P2 | `ShipActionGate` before full report unlock; evidence chips or "not verified" | Cannot treat report as done without choosing next action | Done |
| P3 | DNA scout vs full audit; Brand Memory default tab `diff` | Stranger states product POV in 10s on home | Done |
| Privacy | Expand `LegalPage` privacy; align claims with workspace sync | No "keys never leave browser" when signed in | Done |
| Verify | `npm run typecheck`, vitest suites, `npm run build` | All green | Done (local) |
| Deploy | `npm run deploy` / push `main` | Operator explicit confirm | Not run |

## Risk notes

- Privacy rewrite corrects factual drift (signed-in workspace sync). Not legal advice; counsel review recommended before treating as counsel-approved.
- Ship-action gate must not brick white-label/agency flows: unlock after explicit commit OR paywalled skip with clear copy.
