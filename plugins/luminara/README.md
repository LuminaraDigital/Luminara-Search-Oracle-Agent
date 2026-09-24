# Luminara for Cursor / Claude / Codex

SEO and AI-visibility workflows grounded in your Luminara projects.

## Connect

1. Install this plugin (or copy `mcp.json` into your MCP config).
2. Create an API key in Luminara Settings (Growth or Agency): `POST /api/api-keys`.
3. Configure the MCP server URL `https://luminarasuite.com/api/mcp` with `Authorization: Bearer lm_live_...`.

Self-host: point the URL at your Worker origin `/api/mcp`.

## Included skills

- luminara-coach
- luminara-project-setup
- luminara-report
- luminara-audit
- luminara-keyword-research
- luminara-competitor-analysis
- luminara-visibility
- luminara-local

## Invariant

Every workflow skill: `get_project_context` → check research log → MCP tools → `save_report` via luminara-report. Chat returns verdict + one action + link.
