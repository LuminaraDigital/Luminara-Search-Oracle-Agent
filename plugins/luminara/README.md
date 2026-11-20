# Luminara

The official Luminara package for Claude Code, Antigravity, Cursor and Codex. It connects your agent to Luminara Suite: AI visibility and SEO audits, each project's memory, and saved reports.

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

With no browser to sign in, send a Luminara API key: `Authorization: Bearer lm_live_...`.

## Named agents

Three agents answer in any connected host, from what Luminara has stored for a project. They are free and read only.

- Luminara Auditor (`ask_auditor`): findings on record, worst first, with the date of the last audit
- Luminara Fixer (`ask_fixer`): stored fix drafts, and open findings that have none
- Luminara Coach (`ask_coach`): this week's decision, or a candidate when none is set

When an action needs your approval, the agent gives you a luminarasuite.com link. Sign in and choose Approve once or Deny.

## Included skills

- luminara-coach: start here; it finds your project and offers the next step
- luminara-project-setup
- luminara-report
- luminara-audit
- luminara-keyword-research
- luminara-competitor-analysis
- luminara-visibility
- luminara-local
- luminara-aeo-hub (transcript or audit to a reviewed /compare or /best entry plus a syndication pack; Prepare mode)
- luminara-browse
- luminara-evidence

## Invariant

Every workflow skill: `get_project_context` → check research log → MCP tools → `save_report` via luminara-report. Chat returns verdict + one action + link.
