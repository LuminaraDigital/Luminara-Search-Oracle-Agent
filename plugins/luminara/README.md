# Luminara for Hermes Agent / Cursor / Claude / Codex

SEO, AEO, and AI-visibility workflows grounded in your Luminara projects, evidence ledgers, and shareable audit reports.

## Connect (Cursor / Claude Code / Codex)

1. Install this plugin (or copy `mcp.json` into your MCP config).
2. Create an API key in Luminara Settings (available on every plan): `POST /api/api-keys`.
3. Configure the MCP server URL `https://luminarasuite.com/api/mcp` with `Authorization: Bearer lm_live_...`.

Self-host: point the URL at your Worker origin `/api/mcp`.

## Connect (Hermes Agent - Agent Plugins v1)

1. Install the portable package:
   ```bash
   hermes plugins install ./plugins/luminara
   ```
2. Add your Luminara API key (and optional DataForSEO BYOK credential) under `~/.hermes/config.yaml` (never commit keys into `mcp.json`). Hermes automatically merges the `trust: untrusted`, `costs`, and `spend_limit: 100` policy declared in `plugin.json`:
   ```yaml
   mcp_servers:
     luminara:
       url: https://luminarasuite.com/api/mcp
       headers:
         Authorization: Bearer lm_live_YOUR_KEY
         # Optional BYOK DataForSEO (login:password) so paid research tools bill 0 hosted cents:
         # x-provider-key: login:password
   ```

## Pricing, Scope & Remote Server Disclosure

- **Free MCP tools (25 tools, 0 cents, `mcp:free`):** `whoami`, `list_projects`, `create_project`, `get_project_context`, `update_project_context`, `list_reports`, `get_report`, `save_report`, `dream_status`, `dream_consolidate`, `get_business_memory`, `review_dream_proposal`, `draft_fix`, `list_enquiries`, `ingest_enquiry`, `propose_booking_slots`, `decide_booking_signoff`, `get_outcomes_funnel`, `classify_cms_remediation`, `prepare_cms_mcp_call`, `create_dev_ticket_from_finding`, `compile_review_to_skill`, `mint_habitat_token`, `browse_observe`, and `browse_close`. Free and Starter plans enforce a daily MCP call cap; Growth and Agency are uncapped. `draft_fix` consumes 1 daily `ask` unit on metered plans; `browse_observe` requires Growth+ or BYOK `x-provider-key`; `compile_review_to_skill` and `mint_habitat_token` require a session or API key (not OAuth/habitat tokens).
- **Paid research & browser action tools (8 tools, 0-1 cent, `mcp:research`):** `research_keywords`, `get_domain_overview`, `get_serp_results`, `get_backlinks_overview`, `get_visibility_snapshot`, `get_pagespeed_summary`, `browse_act`, and `browse_goal`. Hosted calls bill 1 cent against your workspace budget (Agency `apiAccess` + `mcp:research`); calls carrying `x-provider-key` (DataForSEO BYOK) bill 0 hosted cents.
- **Remote transport disclosure:** Configuration-only portable package with no local executable code. Tool calls execute over HTTPS against `https://luminarasuite.com/api/mcp` (or your self-hosted Worker), which logs tool provenance and budget events per workspace. The server is declared `trust: untrusted` so Hermes prompts before mutating or paid calls.

## Included skills (11)

- `luminara-coach`
- `luminara-project-setup`
- `luminara-report`
- `luminara-audit`
- `luminara-keyword-research`
- `luminara-competitor-analysis`
- `luminara-visibility`
- `luminara-local`
- `luminara-aeo-hub` (transcript or audit to a reviewed `/compare` or `/best` entry plus a syndication pack; Prepare mode)
- `luminara-browse` (bounded indexed DOM observation and verified browser actions)
- `luminara-evidence` (evidence-bound claims and citation verification)

## Invariant

Every workflow skill runs `get_project_context` -> check research log (30-day window) -> MCP tools -> `save_report` via `luminara-report`. Chat returns verdict + one action + report link, never unmeasured metrics.
