# Luminara MCP

Free MCP on every plan, for Claude, ChatGPT, Cursor, and Grok when that app can call an HTTP MCP server. Free allows 100 calls a day. The included tools are projects, context, and reports. Paid research needs Agency or your own DataForSEO login. Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.

- Docs: https://www.luminarasuite.com/docs/mcp.html
- Endpoint: https://www.luminarasuite.com/api/mcp
- Free: 100 calls a day
- Starter: 300 calls a day
- Growth and Agency: no daily MCP cap
- The daily count is per account. A new token does not reset it.
- Paid research needs Agency or your own DataForSEO login

## Connect

Add the endpoint and sign in with your Luminara account. Your app registers itself, you see who is asking on a Luminara consent page, and you press Allow. No API key is needed. Agents connected this way use the free tools only, and Settings lists every connection with a Disconnect button.

- Grok: grok.com/connectors, New Connector, Custom, paste the endpoint.
- Claude Code: `claude mcp add --transport http luminara https://luminarasuite.com/api/mcp`, then `/mcp` to sign in. Or install the plugin: `claude plugin marketplace add LuminaraDigital/Luminara-Search-Oracle-Agent`, then `claude plugin install luminara@luminara`.
- Claude, ChatGPT: add a custom connector with the endpoint.
- Antigravity: add `{ "mcpServers": { "luminara": { "serverUrl": "https://luminarasuite.com/api/mcp" } } }` to `mcp_config.json`, then Authenticate.
- Cursor: add `{ "mcpServers": { "luminara": { "url": "https://luminarasuite.com/api/mcp" } } }` to `.cursor/mcp.json`.

Send one tools/call per request. A JSON-RPC batch with more than one tools/call is refused.

## Agents

Three named agents answer in every host, from what Luminara has stored for a project. They are free, and they read only: none of them crawls, re-checks or changes anything.

- Luminara Auditor (`ask_auditor`): the findings on record, worst first, with the date of the last audit.
- Luminara Fixer (`ask_fixer`): the fix drafts stored for the site, and the open findings that have none.
- Luminara Coach (`ask_coach`): the decision set for this week, or a candidate when none is set.

Hosts that list MCP prompts show the same three as `auditor`, `fixer` and `coach`. With nothing stored yet, each one points to the free Instant Audit.

When an action needs your approval, the agent gives you a luminarasuite.com link. Sign in, read what it wants to do, and choose Approve once or Deny. The link works for 30 minutes.

## API key (scripts and servers)

For a script with no browser, send a Luminara API key instead:

```json
{
  "mcpServers": {
    "luminara": {
      "url": "https://www.luminarasuite.com/api/mcp",
      "headers": {
        "Authorization": "Bearer lm_live_YOUR_KEY"
      }
    }
  }
}
```
