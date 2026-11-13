# Listing pack

This folder is what an owner pastes into a directory form. It does not submit itself.

The icon is the gold atom from `public/brand/luminara-logo.png`, resized to 512 pixels. `logo.svg` is that same square image. Upload `logo-512.png` when a form asks for a raster icon.

## Fields

| Field | Value |
| --- | --- |
| Name | Luminara Suite |
| Tagline | Projects, context, and reports for one Luminara account. |
| Category | Marketing |
| Remote URL | https://www.luminarasuite.com/api/mcp |
| Transport | streamable-http, no session stickiness |
| Privacy | https://www.luminarasuite.com/privacy |
| Terms | https://www.luminarasuite.com/terms |
| Support | support@luminarasuite.com |
| Publisher | LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281) |

Machine-readable copy is `listing.json`.

## Grok Bot plugin catalog

Grok Bot lists plugins from the Cursor Marketplace. Buffer is one of those plugins. A Luminara tile in Settings, Plugins needs the owner to publish a marketplace plugin that points at this remote server, then ask for it to be included the same way Buffer is included.

Use this pack for the name, icon, description, and MCP URL. Do not send a client secret. The server uses public clients and PKCE.

A custom connector on grok.com can use the remote URL before any catalog tile exists. That catalog is a different list from Grok Bot's plugin menu.

## Other directories

Smithery, mcp.so, Glama, PulseMCP, the Claude directory, and ChatGPT apps can take the same name, icon, description, and URL. Steps for each stay in `../PUBLISHING.md`.

## OAuth for a hosted client

Registration accepts an https callback with no username, no password, and no fragment. It also accepts loopback http(s) and the `cursor:`, `vscode:`, and `vscode-insiders:` schemes.

It rejects `javascript:`, `data:`, and http on a public host.

Authorize never redirects to a URI that is not on that client's registered list. A request with no `client_id` cannot use an arbitrary https callback.

The allow screen grants `mcp:free`. `mcp:research` is for an Agency authorization that is not this hosted screen. A hosted client can still send `x-provider-key` with its own DataForSEO login.

Clients that register `refresh_token` receive one with the access token. That access token lasts 1 hour. A retry within 30 seconds returns the same new tokens. After that, presenting the old refresh token revokes the family. The daily call counter stays one key per account and UTC day.

Discovery documents answer GET and OPTIONS with `Access-Control-Allow-Origin: *`. Each MCP POST stands alone. The server does not issue `mcp-session-id` and does not need the next request to hit the same machine.
