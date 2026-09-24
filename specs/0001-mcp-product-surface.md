# MCP product surface

## Status

Accepted (APS A1+)

## Context

Agency-only `/mcp` returned 501. External agents could not call Luminara data and re-audited with WebFetch.

## Decision

Ship streamable JSON-RPC MCP at `/mcp` on the Worker. Growth+ may use free tools. Paid research tools require Agency `apiAccess` or BYOK DataForSEO. Single tool registry shared with future Oracle.

## Alternatives considered

- Agency-only MCP: blocks activation for Growth users who need agent workflows.
- Full OpenSEO SDK fork: wrong stack and license surface for our Worker.
- Chat-only tools: does not work in Cursor/Claude without our app open.

## Not in scope

OAuth marketplace polish beyond API key + session (OAuth is A5 follow-up if needed).
