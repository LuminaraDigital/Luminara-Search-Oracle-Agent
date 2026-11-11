# Luminara MCP

Free MCP on every plan, for Claude, ChatGPT, Cursor, and Grok when that app can call an HTTP MCP server. Free allows 100 calls a day. The included tools are projects, context, and reports. Paid research needs Agency or your own DataForSEO login. Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.

- Docs: https://www.luminarasuite.com/docs/mcp.html
- Endpoint: https://luminarasuite.com/api/mcp
- Free: 100 calls a day
- Starter: 300 calls a day
- Growth and Agency: no daily MCP cap
- Paid research needs Agency or your own DataForSEO login

Send one tools/call per request. A JSON-RPC batch with more than one tools/call is refused.

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
