# 0030: Agent connector sign-in

## What

Any hosted agent that speaks MCP can connect to a Luminara account through OAuth. The first target is Grok (custom connectors, and Grok Bot where it can use them). The owner adds `https://luminarasuite.com/api/mcp`, signs in to Luminara, sees who is asking and what it can do, and presses Allow. The agent then works through MCP as that account.

## Why

Agents are becoming the operators of software, and the account holder is still the person who pays. MCP already gave coding apps access, but only with a pasted key or a localhost callback, so a hosted agent could not connect at all.

## Design

- **The agent is a delegate, not a user.** Every token belongs to a human account and names the client on it. There is no account or email for the agent, so quotas, deletion and consent keep working.
- **Discovery.** A 401 from `/api/mcp` names protected resource metadata (RFC 9728), which leads to server metadata (RFC 8414). Both are served outside `/api` and before the www redirect, so the issuer does not move.
- **Registration.** Open dynamic registration (RFC 7591) for public clients with PKCE. Any https callback may register, so the exact-match check at authorize and the consent screen are the protection. The chosen name is shown as self-reported.
- **Consent.** A server-rendered page bound to the signed-in user, with one-time approval records and a page-specific CSP. Its `form-action` names the callback because browsers apply that rule to the redirect after submit.
- **Money.** Connector tokens carry `mcp:free` only, whatever the plan. An agent cannot pay or spend research credits. A plan without agent access sees an upgrade page instead of Allow.
- **Revoke.** Settings lists every OAuth connection by name, on any plan, and Disconnect ends the token. The list id is the token hash, never the token.
- **Existing clients.** A request without `client_id` keeps today's localhost and IDE behaviour.

## Alternatives

- **An account for each agent, such as a Grok Bot email.** Rejected. It splits billing from the human, gives us no consent record, and holds a credential that can be shared across every Bot on a machine.
- **Password sign-in inside the agent's browser.** It works without us, but the agent holds the owner's real credentials with full account power. Connectors are the supported path.
- **Client ID Metadata Documents only.** The newer MCP default, and the better long-term choice because the client's identity is a URL we can check. Registration ships first because it is what we can serve without knowing which method Grok uses. Add it once a live connection shows what Grok sends.
- **Web Bot Auth.** Useful for proving which operator sent a request, but it does not say which human approved it, and we found no evidence that xAI signs requests.

## Data

Free agent access is meant to build Luminara's outcome data. That use needs a change to the privacy policy first: today it lists the purposes for personal information and says we do not sell it. Connector sign-in collects no new data class and changes no retention rule.

## Not in this slice

Refresh tokens (a connection lasts 30 days, then the owner reconnects) and agent payment rails. Free-plan access follows the plan entitlements, so it arrives with the free MCP packaging change.
