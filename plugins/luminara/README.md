# Luminara

The official Luminara package for Claude Code, Hermes Agent, Antigravity, Cursor and Codex. It connects your agent to Luminara Suite: AI visibility and SEO audits, each project's memory, and saved reports.

Endpoint: `https://luminarasuite.com/api/mcp`. You sign in with your Luminara account; no API key is needed. Agents connected this way use the free tools only, and Luminara Settings lists every connection with a Disconnect button.

## Install

### Claude Code

```bash
claude plugin marketplace add LuminaraDigital/Luminara-Search-Oracle-Agent
```

```bash
claude plugin install luminara@luminara
```

Then run `/mcp`, pick `luminara`, and sign in. Without the plugin, add only the connector:

```bash
claude mcp add --transport http luminara https://luminarasuite.com/api/mcp
```

### Hermes Agent (Agent Plugins v1)

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

### Antigravity

Copy [`mcp_config.json`](mcp_config.json) into `~/.gemini/config/mcp_config.json` (all workspaces) or `<workspace>/.agents/mcp_config.json`, merging with any servers already there. Open Customizations, Installed, MCP Servers, and choose Authenticate on `luminara`.

For the Luminara reply style, copy [`hosts/antigravity/luminara.md`](hosts/antigravity/luminara.md) into `<workspace>/.agents/rules/`.

### Cursor

Add to `.cursor/mcp.json`:

```json
{ "mcpServers": { "luminara": { "url": "https://luminarasuite.com/api/mcp" } } }
```

Or open the install link on [luminarasuite.com/docs/mcp.html](https://www.luminarasuite.com/docs/mcp.html).

### Grok, Grok Bot, Claude and ChatGPT

These connect without this package. Add a custom connector with the endpoint and sign in. In Grok: grok.com/connectors, New Connector, Custom. For a Grok Bot, paste [`hosts/grok/bot-instructions.md`](hosts/grok/bot-instructions.md) into its instructions.

### Scripts and servers

With no browser to sign in, send a Luminara API key: `Authorization: Bearer lm_live_...`. Self-host: point the URL at your Worker origin `/api/mcp`.

## Named agents

Three agents answer in any connected host, from what Luminara has stored for a project. They are free and read only.

- Luminara Auditor (`ask_auditor`): findings on record, worst first, with the date of the last audit
- Luminara Fixer (`ask_fixer`): stored fix drafts, and open findings that have none
- Luminara Coach (`ask_coach`): this week's decision, or a candidate when none is set

When an action needs your approval, the agent gives you a luminarasuite.com link. Sign in and choose Approve once or Deny.

## Pricing, Scope & Remote Server Disclosure

- **Free MCP tools (36 tools, 0 cents, `mcp:free`):** `whoami`, `list_projects`, `create_project`, `get_project_context`, `get_project_history`, `compare_snapshots`, `get_project_outcomes`, `mark_project_action_done`, `get_project_monitor`, `set_project_monitor`, `list_project_alerts`, `ack_project_alert`, `ask_auditor`, `ask_fixer`, `ask_coach`, `update_project_context`, `list_reports`, `get_report`, `save_report`, `dream_status`, `dream_consolidate`, `get_business_memory`, `review_dream_proposal`, `draft_fix`, `list_enquiries`, `ingest_enquiry`, `propose_booking_slots`, `decide_booking_signoff`, `get_outcomes_funnel`, `classify_cms_remediation`, `prepare_cms_mcp_call`, `create_dev_ticket_from_finding`, `compile_review_to_skill`, `mint_habitat_token`, `browse_observe`, and `browse_close`. Free and Starter plans enforce a daily MCP call cap; Growth and Agency are uncapped. `draft_fix` consumes 1 daily `ask` unit on metered plans; `browse_observe` requires Growth+ or BYOK `x-provider-key`; `compile_review_to_skill` and `mint_habitat_token` require a session or API key (not OAuth/habitat tokens).
- **Paid research & browser action tools (8 tools, 0-1 cent, `mcp:research`):** `research_keywords`, `get_domain_overview`, `get_serp_results`, `get_backlinks_overview`, `get_visibility_snapshot`, `get_pagespeed_summary`, `browse_act`, and `browse_goal`. Hosted calls bill 1 cent against your workspace budget (Agency `apiAccess` + `mcp:research`); calls carrying `x-provider-key` (DataForSEO BYOK) bill 0 hosted cents.
- **Remote transport disclosure:** Configuration-only portable package with no local executable code. Tool calls execute over HTTPS against `https://luminarasuite.com/api/mcp` (or your self-hosted Worker), which logs tool provenance and budget events per workspace. The server is declared `trust: untrusted` so Hermes prompts before mutating or paid calls.

## Included skills (11)

- `luminara-coach`: start here; it finds your project and offers the next step
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
