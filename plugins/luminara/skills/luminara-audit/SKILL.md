---
name: luminara-audit
description: Audit a site via Luminara MCP and save a one-page report. Methodology depth lives in seo-audit references.
---

# Luminara Audit

1. `get_project_context`. Fill business_overview/current_goal if empty (minimal), else continue.
2. Check research log for a recent audit. `ask_auditor` returns the findings on record and the date of the last audit; it does not run a new one.
3. Prefer project domain. Use free tools first; paid tools only with entitlement/BYOK.
4. Do not invent metrics. Label `not_measured` when tools return that status.
5. Deliver through `luminara-report` with skill `luminara-audit`.
6. For deep methodology, consult `.claude/skills/seo-audit` as reference only (no Python runtime).
