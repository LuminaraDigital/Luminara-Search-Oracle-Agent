---
name: luminara-browse
description: Interactive page observe/act via indexed DOM tools. Prefer DOM before pixels. Never invent outcomes when the crawler is down.
---

# Luminara Browse

1. `get_project_context`. Fill business_overview/current_goal if empty (minimal), else continue.
2. Prefer project domain and a bounded interactive goal (cookie, FAQ, tab, on-page search). Check research log for a recent browse result on the same URL/goal.
3. `browse_observe` first. Use returned element ids only. Never invent selectors, coordinates, or JS.
4. For a single mutation use `browse_act`. For a multi-step goal use `browse_goal`. Cap steps; stop on `DONE`, `BLOCKED`, or verifier fail.
5. Verify independently. Pass `checks` (urlIncludes / textIncludes / titleIncludes) on every `browse_goal`. Agent `DONE` is not proof. Goal-overlap and verifier must both pass before treating the run as measured. If the crawler is unset, unhealthy, or returns `BROWSER_UNAVAILABLE`, label `not_measured` and stop. Do not invent UI state. Prefer `luminara-evidence` for claim ledger / citation gates.
6. Prefer this path over grounding when DOM ids exist. Prefer scrape/DFS when the task is one-shot evidence or SERP/KW/backlinks, not interaction.
7. Deliver through `luminara-report` / `save_report` with skill `luminara-browse`. Chat: verdict + one action + report link.
8. `browse_close` when finished.
