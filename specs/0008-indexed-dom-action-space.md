# Indexed DOM action space (agent browse)

## Status

Accepted for additive agent browse paths. Complements Instant Audit scrape, paid research tools, and PointerBench grounding. Does not replace any of them.

## Context

SEO agents often need interactive page state: dismiss consent, open nav, expand FAQ, switch tabs. One-shot HTML/markdown scrapes miss that. Screenshot-only click grounding (`services/grounding/`) solves pixel pointing, not a full DOM action loop.

browser-use/jev-ultrafast (MIT) shows a pattern: atomic indexed controls, one decision for operation + target, text LLM only for fills, model never emits selectors or JS. Luminara ports that contract into the existing Patchright crawler + TypeScript tool stack without TypeSafe or a nested Python app.

## Decision

Ship an additive indexed DOM action layer:

1. Crawler sessions: `/session`, `/session/:id/observe`, `/session/:id/act` beside existing `/scrape`.
2. Policy under `services/browserAction/`: action space, choose, field text helper, predict/act loop, independent DONE verification.
3. MCP/Oracle tools: `browse_observe` (free Growth+), `browse_act` / `browse_goal` (paid or Agency), `browse_close` (free).
4. Prefer DOM ids when present; fall back to grounding only for screenshot-only or missing controls.
5. Unavailable crawler returns instructive `BROWSER_UNAVAILABLE` / `not_measured`, never invented interaction outcomes.

## Alternatives considered

- Fork jev-ultrafast into the monorepo: rejected (nested app, Python, TypeSafe lock-in).
- Put browse policy inside `services/grounding/`: rejected (different job: pixels vs indexed DOM).
- Drive Chromium from Cloudflare Workers: impossible; keep execution in `crawler/`.
- Replace `/scrape` with sessions: rejected; scrape remains the cheap Instant Audit path.

## Not in scope

Shadow DOM / iframe / canvas completeness, TypeSafe dependency, Chrome profile attach, replacing DataForSEO tools, training a custom pointer model, deploy without operator approval.
