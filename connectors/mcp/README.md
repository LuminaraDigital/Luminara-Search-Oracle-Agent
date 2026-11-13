# Luminara Suite MCP

Remote server for AI agents. The canonical URL is `https://www.luminarasuite.com/api/mcp`.

Transport is streamable HTTP. The server accepts protocol versions `2025-06-18`, `2025-03-26`, and `2024-11-05`. Send one `tools/call` per request.

`https://luminarasuite.com/api/mcp` also answers. OAuth discovery uses the host you called. Use `www` so the issuer matches the site.

## Sign in

Two ways. Both share one daily counter per account. A new token or API key does not reset it.

### API key

In Settings, create a key that starts with `lm_live_`. Send it as `Authorization: Bearer lm_live_...`.

### OAuth 2.1

Public clients use authorization code and PKCE (`S256`), plus dynamic client registration.

| Step | Method and URL |
| --- | --- |
| Register | `POST https://www.luminarasuite.com/api/oauth/mcp/register` |
| Authorize | `GET https://www.luminarasuite.com/api/oauth/mcp/authorize` |
| Token | `POST https://www.luminarasuite.com/api/oauth/mcp/token` |
| Revoke | `POST https://www.luminarasuite.com/api/oauth/mcp/revoke` |

Protected resource metadata is `https://www.luminarasuite.com/.well-known/oauth-protected-resource/api/mcp`.

Authorization server metadata is `https://www.luminarasuite.com/.well-known/oauth-authorization-server`.

The person who owns the Luminara account must open the authorize URL and press Allow. Agents cannot buy a plan.

Registration accepts any https callback that has no username, no password, and no fragment. It also accepts loopback http(s) and the `cursor:`, `vscode:`, and `vscode-insiders:` schemes. It rejects `javascript:`, `data:`, userinfo, fragments, and http on a public host. Authorize redirects only to a URI that client registered. A loopback URI may use a different port. The scheme, host, path, and query must still match. A public https host may not change port. A missing `client_id` cannot use an arbitrary https callback.

Hosted clients receive `mcp:free` from the allow screen. The server does not pin a request to one machine, and it does not issue `mcp-session-id`. Discovery GET and OPTIONS send `Access-Control-Allow-Origin: *`.

Registration accepts `grant_types` of `authorization_code` and `refresh_token`. If you omit `grant_types`, both are registered. Authorization server metadata lists both in `grant_types_supported`.

The token response includes a `refresh_token` when the client registered that grant. That access token lasts 1 hour. A client that did not register `refresh_token` still receives a 30-day access token. The refresh token lasts 90 days. Send it to the token endpoint as `grant_type=refresh_token` with the same `client_id`. Each success returns a new access token and a new refresh token. Token responses send `Cache-Control: no-store` and `Pragma: no-cache`. RFC 9700 rotates refresh tokens. A retry of the token you just sent, within 30 seconds, returns that same new pair so a lost response is not treated as theft. After that, sending it revokes the family: every access token from that consent, and the newer refresh token. Rotation is one conditional update in D1 (`0051_mcp_oauth_refresh_family.sql`). A refresh cannot ask for a wider scope than the consent. The account's current plan is checked again, and a scope the plan no longer allows is dropped. If that plan read fails, the refresh fails and can be retried. A deleted account cannot refresh. `POST` to the revoke endpoint with the refresh token revokes that same family. The server stores SHA-256 hashes. The new pair is encrypted for the 30 second retry window and then cleared.

A revoked, expired, or unknown `mcp_` token returns HTTP 401 `invalid_token` with the message `token revoked or expired, reconnect`. `WWW-Authenticate` points at the protected resource metadata. If you still hold a live refresh token, refresh it. Otherwise reconnect. Do not retry the same bearer.

## Scopes

- `mcp:free` covers projects, context, and reports on every plan.
- `mcp:research` covers hosted paid research. It is granted on Agency.

Send your own DataForSEO login as `x-provider-key: login:password` to run paid tools on `mcp:free`. That path spends your provider account, not hosted research.

Call `get_project_context` for a project before a paid tool on that project.

## Limits

The daily key is the account id and the UTC day.

| Plan | MCP calls per UTC day | Hosted paid calls per UTC day |
| --- | --- | --- |
| Free | 100 | none |
| Starter | 300 | none |
| Growth | no daily cap | none |
| Agency | no daily cap | 200 |

Hosted paid calls are an abuse ceiling so one token cannot resell DataForSEO results. BYOK calls are not counted. Growth and Agency still stop at the burst limits below.

- 30 tool calls per minute per account.
- 30 tool calls per minute per OAuth `client_id`. API keys and browser sessions have no `client_id`, so only the account burst applies.
- 10 registration posts per minute per IP.
- 30 token exchanges per minute per IP.
- List tools return at most 50 rows. Pass `cursor` from `nextCursor` for the next page.
- Report HTML and other tool text are cut at 32000 characters.

A denied call is JSON-RPC error `-32000`. `error.data` includes `code`, `limit`, `remaining`, and `resetAt` (unix seconds). The response also sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` when the call is blocked. `whoami` returns `callsUsedToday`, `callsRemainingToday`, `plan`, and `resetAt`. A limit of `0` means that counter has no daily cap. `callsRemainingToday` is null in that case.

## Tools

`tool-catalog.json` is generated from the server. Do not edit it. From the Suite repo, run `npm run mcp:catalog`.

`whoami` is the right first call. It confirms the account, the plan, and how many calls are left today.

## Client configs

Files in this folder are meant to be copied.

### Claude Desktop

Copy `claude-desktop.json` into the `mcpServers` object of `claude_desktop_config.json`.

OAuth clients can omit the `headers` block. Desktop then follows the 401 metadata and opens the authorize page.

### Claude Code

```
claude mcp add --transport http luminara https://www.luminarasuite.com/api/mcp --header "Authorization: Bearer lm_live_YOUR_KEY"
```

Drop the header flag when the client should use OAuth instead of an API key.

### claude.ai custom connector

Add a custom connector with the remote URL `https://www.luminarasuite.com/api/mcp`. Leave the URL on `www`. Sign in when Claude opens the Luminara allow page.

### ChatGPT connectors

In developer mode, add a remote MCP server with the same URL. ChatGPT follows OAuth when the server answers 401 with protected-resource metadata.

### Cursor

Copy `cursor.mcp.json` to `.cursor/mcp.json` in the project, or merge the `mcpServers` entry into the user MCP config.

### VS Code

Copy `vscode.mcp.json` to `.vscode/mcp.json`.

### Generic MCP clients

Use `generic.mcp.json`. Any client that speaks streamable HTTP can use the URL. If it only supports stdio, put a streamable-HTTP proxy in front and point that proxy at this URL. This folder does not ship a proxy.

## Publishing listings

See `PUBLISHING.md`. The form fields and the gold atom icon are in `listing/`. Listing the server on Grok Bot, the official MCP Registry, or any other directory is an owner step. Nothing in this folder publishes itself.
