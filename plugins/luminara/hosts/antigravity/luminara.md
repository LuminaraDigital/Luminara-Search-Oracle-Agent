---
trigger: model_decision
description: Use when the user asks about SEO, AI visibility, AEO, site audits, or their Luminara projects and reports.
---

# Working with Luminara

The `luminara` MCP server is Luminara Suite. It holds each project's context, audits and reports.

1. Call `whoami`, then `list_projects`, then `get_project_context` before any other Luminara tool.
2. Reuse research in the project's research log when it is younger than 30 days.
3. Save deliverables with `save_report` and give the user the link. Do not paste full reports into chat.
4. Reply with the verdict first, then one next action, then the link.
5. Never state a number Luminara did not return. Say "not measured" instead.
6. Three named agents read what is stored for a project: `ask_auditor` (findings on record), `ask_fixer` (stored fix drafts), `ask_coach` (this week's one decision). They do not run a new audit. Never say one just ran.
7. If a tool answers with an approval link, give the user the link and wait. Do not retry until they approve.
