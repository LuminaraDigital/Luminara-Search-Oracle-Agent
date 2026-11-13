# Publishing the Luminara MCP server

The server is already live at `https://www.luminarasuite.com/api/mcp`. This file is the checklist for public directories. Each item marked **Owner** needs a human with the Luminara account. This repository does not submit those listings.

The copy, icon, and URLs for every form live in `listing/`. Use that folder. Do not rewrite the description per site.

## Grok Bot plugin catalog

**Owner.**

Grok Bot's plugin list is the Cursor Marketplace, the same place Buffer is listed. Publishing a marketplace plugin that uses this remote URL, then asking for the Grok Bot catalog to include it, is the owner's step. The pack in `listing/` is the name, gold atom icon, tagline, description, and MCP URL for that submission.

A person can also add a custom connector at grok.com with the remote URL before any catalog tile exists. That connectors page is a separate list from Grok Bot's plugin menu.

## Official MCP Registry

**Owner.**

`server.json` uses the namespace `com.luminarasuite/suite` and remote type `streamable-http`. The schema URL is the official MCP Registry schema `2025-12-11`. The description must stay within 100 characters. Confirm that URL still matches the registry docs before you publish, because the registry has changed schema dates before.

1. Install the publisher CLI from the [MCP Registry](https://github.com/modelcontextprotocol/registry) docs.
2. Prove the domain `luminarasuite.com`. Prefer DNS. The CLI prints a TXT record. Add that record on the domain and leave it until verification succeeds.
3. HTTP proof is the fallback. Run the CLI's HTTP login, copy the challenge it prints, and set the Worker secret `MCP_REGISTRY_AUTH_TOKEN` to that exact string. The Worker serves it at `https://www.luminarasuite.com/.well-known/mcp-registry-auth` and at the apex host. Unset, that path is 404. Remove the secret after the registry has verified, or rotate it if the challenge was exposed.
4. From a checkout that contains `connectors/mcp/server.json`, run the publisher's publish command. The registry rejects a name that does not match a verified namespace.
5. Do not publish under `io.github.*` unless you intend a GitHub namespace instead of the domain.

## Smithery

**Owner.**

Open Smithery's "new server" flow and choose a remote URL. Paste `https://www.luminarasuite.com/api/mcp`. Use the description in `server.json`. Smithery asks for an account you control.

## mcp.so

**Owner.**

Submit the same remote URL through the mcp.so listing form. Copy the description from `server.json`. Do not add usage numbers that are not in this repo.

## Glama

**Owner.**

Submit at Glama's MCP server directory. Remote URL as above. Glama may crawl `tools/list`. The live server is the source. `tool-catalog.json` is only a snapshot.

## PulseMCP

**Owner.**

Submit at PulseMCP. Same URL and description. If the form asks for a GitHub repo, use `https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent`.

## Claude directory

**Owner.**

Anthropic's connector directory is a separate review from Claude Desktop config. Apply with the remote URL, the OAuth metadata URLs in `README.md`, and the scopes `mcp:free` and `mcp:research`. Desktop and Claude Code users can connect before the directory lists the server. The copy-paste config does not require a directory listing.

## ChatGPT apps

**Owner.**

OpenAI's app or connector review is separate from developer-mode custom connectors. Developer mode can attach the remote URL today. A public ChatGPT app listing needs the owner's OpenAI developer account and whatever review that form asks for. Do not send a client secret. This server uses public clients and PKCE.

## After a tool change

Regenerate `tool-catalog.json` with `npm run mcp:catalog` and commit it. The test `connectors/mcp/tool-catalog.json matches the live tool list` fails when the file drifts.
