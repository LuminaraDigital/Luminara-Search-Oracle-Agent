# Evidence-bound decisions (claim integrity)

## Status

Accepted for additive Oracle, MCP, and browse honesty paths. Complements APS, indexed DOM browse, and conversion honesty. Does not replace scrape, DataForSEO, or PointerBench.

## Context

Structured model output is not truth. Vendor System One models (for example TypeSafe Jev) report about 67.8% agreement on their own four-workflow board. A wrong answer that fails faster is still wrong. Luminara's product law is fail closed: code owns measurement status; models may only choose among observed options; independent verifiers and tools mint `measured`.

## Decision

Ship an additive evidence-bound layer under `services/evidenceBound/`:

1. Strict Choice / Score / Noul-shaped validation without a TypeSafe dependency.
2. Intent router with speculative fan-out before paid research and `browse_goal`.
3. Claim ledger: every user-visible claim carries `measured` | `estimated` | `not_measured` | `unknown` plus sources.
4. Citation support gate: unsupported claims rewrite to `unknown` / `not_measured`.
5. Atomic SEO gut-checks with composite weights in code (never a Live invented 0-100 score).
6. Browse hardening: occlusion/stale reject, DONE never proof, required verify checks, honest measurementStatus.

## Alternatives considered

- Adopt TypeSafe/Jev as the product brain: rejected (accuracy mid-tier; vendor lock).
- Prompt-only honesty instructions: rejected (unenforced).
- Confidence-only auto-execution: rejected (generative confidence is not calibrated).
- Nested jev-ultrafast app: rejected (repo structure + Python + TypeSafe).

## Not in scope

Training a custom decision model, public "100x accuracy" claims, Chrome profile attach, replacing Instant Audit scrape, deploy without operator approval.
