# Luminara MCP

Free MCP on every plan, for Claude, ChatGPT, Cursor, and Grok when that app can call an HTTP MCP server. Free allows 100 calls a day. The included tools are projects, context, and reports. Paid research needs Agency or your own DataForSEO login. Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.

- Docs: https://www.luminarasuite.com/docs/mcp.html
- Endpoint: https://luminarasuite.com/api/mcp
- Free: 100 calls a day
- Starter: 300 calls a day
- Growth and Agency: no daily MCP cap
- Paid research needs Agency or your own DataForSEO login

## Connect

Add the endpoint and sign in with your Luminara account. Your app registers itself, you see who is asking on a Luminara consent page, and you press Allow. No API key is needed. Agents connected this way use the free tools only, and Settings lists every connection with a Disconnect button.

- Grok: grok.com/connectors, New Connector, Custom, paste the endpoint.
- Claude Code: `claude mcp add --transport http luminara https://luminarasuite.com/api/mcp`, then `/mcp` to sign in. Or install the plugin: `claude plugin marketplace add LuminaraDigital/Luminara-Search-Oracle-Agent`, then `claude plugin install luminara@luminara`.
- Claude, ChatGPT: add a custom connector with the endpoint.
- Antigravity: add `{ "mcpServers": { "luminara": { "serverUrl": "https://luminarasuite.com/api/mcp" } } }` to `mcp_config.json`, then Authenticate.
- Cursor: add `{ "mcpServers": { "luminara": { "url": "https://luminarasuite.com/api/mcp" } } }` to `.cursor/mcp.json`.

Send one tools/call per request. A JSON-RPC batch with more than one tools/call is refused.

## API key (scripts and servers)

For a script with no browser, send a Luminara API key instead:

```json
{
  "mcpServers": {
    "luminara": {
      "url": "https://luminarasuite.com/api/mcp",
      "headers": {
        "Authorization": "Bearer lm_live_YOUR_KEY"
      }
    }
  }
}
```
