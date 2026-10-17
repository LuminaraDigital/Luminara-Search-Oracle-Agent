# Recursive Language Model (RLM) Subsystem (`services/rlm/`)

Ported and adapted from [`alexzhang13/rlm`](https://github.com/alexzhang13/rlm) (`MIT License`, Copyright (c) 2026 Alex Zhang).

## Purpose

Instead of stuffing entire multi-page crawls or long conversation histories into a single LLM prompt, `services/rlm/` offloads unbounded evidence into a persistent variable store (`RlmContextStore`) and lets a root orchestrator model iteratively probe, regex-filter, chunk, and dispatch parallel sub-LLM calls (`llm_query_batched` / `rlm_query`) before submitting an evidence-bound final answer.

## Invariants

1. **Zero `eval()` / Cloudflare Worker Safe**: Never use `eval()` or `new Function()`. All REPL blocks (` ```repl `) execute deterministic JSON/DSL operations (`probe`, `slice`, `regex_search`, `chunk`, `llm_query`, `llm_query_batched`, `rlm_query`, `show_vars`, `submit_answer`) inside `RlmContextStore`.
2. **Untrusted Content Fencing**: Every variable injected into a sub-LLM call (`llm_query`, `llm_query_batched`, `rlm_query`) is automatically wrapped in `<<<UNTRUSTED_REPL_...>>>` delimiters via `wrapUntrustedContent`.
3. **Evidence-Bound Answer Gate**: Setting `ready: true` via `submit_answer` validates structured claims against `ClaimLedger` and `citationSupportHeuristic`. Any `measured` claim lacking sources or failing evidence overlap is rejected into `REPLResult.stderr` with `ready: false` so the model self-corrects on the next turn.
4. **Hard Iteration & Budget Guards**: `RLMRunner` enforces `maxIterations`, `maxTokens`, `maxBudgetUsd`, `maxTimeoutMs`, and `maxErrors` consecutive error limits, returning `bestPartialAnswer` gracefully on breach.
5. **No Em Dashes**: Never use U+2014 in prompts, comments, or outputs.
