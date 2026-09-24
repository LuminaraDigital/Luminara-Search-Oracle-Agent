# Product skills and plugin

## Status

Accepted (APS A5-A6)

## Decision

`plugins/luminara/` ships mcp.json + thin skills. Methodology stays in `.claude/skills/seo*`. Product skills always: load context → check research log → MCP → luminara-report.

v1 skills: coach, project-setup, report, audit, keyword-research, competitor-analysis, visibility, local.

## Alternatives considered

- Replace methodology skills: loses AEO/GEO depth.
- Skills that call Python scripts: runtime not shipped.
