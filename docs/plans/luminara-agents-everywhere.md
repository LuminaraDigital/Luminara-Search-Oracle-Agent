# Luminara agents everywhere (Track AE)

**Date:** 2026-11-12
**Status:** draft for owner review. Not yet through the plan review loop.
**Relation to other plans:** additive to Track SW (`founder-swarm-business-brain-additive-plan.md`). It does not change SW's order or its roster (section 4.2). It adds how SW's agents reach people through other hosts, under Luminara's name. It builds on spec 0030 (agent connector sign-in) and the existing `plugins/luminara` package.

---

## 1. The rule

People reach Luminara from the host they already use: Grok and Grok Bot, Claude and Claude Code, Antigravity, Cursor, Codex, ChatGPT. The host is a window. Luminara keeps everything that makes the product ours:

- the named agents (Auditor, Fixer, Coach, and later Analyst and Prospector),
- each project's memory, evidence and run history,
- approvals and spend limits,
- the brand: name, icon, voice, and the link back to luminarasuite.com.

We do not build or ship a Grok Bot clone, and we do not publish into other people's agent products (for example a Rakazo plugin). Every host connects to one endpoint, `https://luminarasuite.com/api/mcp`, through OAuth, and every package we ship is a Luminara package.

## 2. Where the connector stands (tested 2026-11-12)

Checked against production with no account, so the signed-in half is not covered.

| Step | Result |
|---|---|
| `POST /api/mcp` with no token | 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"` |
| Protected resource metadata | 200; resource `https://luminarasuite.com/api/mcp`, scope `mcp:free` |
| Server metadata | 200; S256 PKCE, public clients, registration endpoint present |
| Dynamic registration | Answers with a `mcpc_…` client id (one test client, "Luminara connector self-test", now exists in production) |
| Authorize with no session | 302 to `/?agent_connect=…`, which is the sign-in step |
| Authorize with a callback that was not registered | 400 |
| Token with a bad code | `invalid_grant` |

**Not tested:** sign-in, the consent page, the token, and a real `tools/call` with that token. Those need the owner's account (section 5).

**Problems found:**

1. **Old protocol version.** `initialize` always answers `protocolVersion: '2024-11-05'` (`worker/mcpServer.ts`, the `initialize` branch and the `GET` answer). OAuth and the streamable HTTP transport arrived in later versions. A host that sends a newer version may refuse the older answer. The server should echo the client's version when it supports it and otherwise answer its newest supported version.
2. **No identity for the host to show.** `serverInfo` is `{ name: 'luminara-mcp', version: '1.0.0' }`: no `title`, no icon, no `instructions`. Hosts that show a server's name, icon or instructions show nothing of the brand.
3. **The 401 speaks to people, not agents.** Its body says "Sign in with Firebase or open the app inside Telegram." An agent reading it learns nothing; it should point to the OAuth metadata.
4. **The plugin does not connect.** `plugins/luminara/README.md` says to copy `mcp.json` and paste an `lm_live_` key from Growth or Agency, but the package has no MCP config file at all. Since spec 0030 and free MCP, the right path is OAuth with no key.
5. **No install path for Claude Code.** There is no `marketplace.json`, so `claude plugin marketplace add` has nothing to read.
6. **No Antigravity or Grok package.**
7. **The www host is a second issuer.** `www.luminarasuite.com` serves its own metadata with issuer `https://www.luminarasuite.com`. That is valid, but a token issued on one host must not be accepted as if from the other, and docs should name only the apex URL.

## 3. Named agents in every host

Track SW builds the agents on the server. This track makes them recognisable in any host, the way Grok Bot makes a bot a person you text.

**What carries over from the Grok Bot pattern, and what does not.**

| Grok Bot idea | Luminara version | Not copied |
|---|---|---|
| A bot has a name, a look and one thread | Each roster agent has a name, a shape icon in the brand palette, and one run history per project, held by Luminara | A separate chat app; the host's own chat is the window |
| Bots work while you are away | Server runs (SW1a), scheduled audits (decision 22) | A rented computer per user |
| Approval cards | The existing `mcp_action_requests` flow: the tool answers with a short card and a Luminara approval link | Approving inside a host's private UI |
| Routines | SW's scheduled audits, set from any host with one tool | A general workflow builder |
| Many apps through one catalogue | Not needed: Luminara is the app the host connects to | Composio-style catalogues |

**How a host sees an agent.**

1. **MCP prompts.** The server adds the `prompts` capability with one prompt per live agent: `auditor`, `fixer`, `coach`. A host that lists prompts shows them as "Luminara Auditor" and so on. Each prompt carries that agent's job and reply shape, taken from the roster entry, not from free text.
2. **Agent tools.** One entry tool per agent, named for the job (`ask_auditor`, `ask_fixer`, `ask_coach`), with a `title` such as "Luminara Auditor". Each returns the agent's latest state for the project: open run, last deliverable, pending approval. Until SW1a lands, `ask_auditor` returns the last audit report and says server audits are not live yet.
3. **One thread per agent per project.** The thread is the run log Track SW already stores (provenance runs and events). `ask_*` reads it, so any host, on any day, sees the same history. No host keeps it.
4. **Cards in plain text, richer where supported.** Every card has a text form that reads well in any chat: the agent's name, the result in one line, one action, and the luminarasuite.com link. Hosts that render MCP Apps (`ui://` resources) get a small branded card. The text form is the contract; the rich form is optional.
5. **Server instructions.** `initialize` returns `instructions` that name Luminara, list the agents and say how to reply (verdict, one action, link). This is how the brand voice reaches a host's model.

**Limits that stay as Track SW sets them.** Connector tokens carry `mcp:free` only (spec 0030). No host can make an agent spend, publish, or skip an approval. The SW output check (section 4.3) applies to whatever an agent returns through MCP.

## 4. Packages we ship

One folder, `plugins/luminara`, one name, one icon, one version. Each host gets the file it reads:

| Host | What we ship | How a user installs |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` with the MCP server, skills, and `/luminara-audit`, `/luminara-fix`, `/luminara-coach` commands; a `marketplace.json` at the repo root or in a public `LuminaraDigital/luminara-plugins` repo | `claude plugin marketplace add LuminaraDigital/luminara-plugins`, then install `luminara` |
| Claude (web and desktop) | The connector URL and a listing request to Anthropic's connector directory | Add custom connector with the URL |
| Grok and Grok Bot | A one-page guide and a ready Grok Bot instruction block: "You work with Luminara's Auditor, Fixer and Coach through the Luminara connector" | Add custom connector with the URL |
| Antigravity | An MCP config snippet using the remote URL, and a Luminara rules file | Paste into Antigravity's MCP settings |
| Cursor and Codex | The existing manifests plus the MCP config, and a Cursor install deep link | One click or paste |
| ChatGPT | The connector URL in developer mode | Add connector |

The host-specific details (Antigravity's config key for a remote server, Claude Code's marketplace format, which hosts render MCP Apps and prompts) must be checked against each host's current docs before the files are written. They are not assumed here.

## 5. Owner steps for the live test

Each takes about five minutes. Do them on production, signed in as yourself, and note what you see.

1. **Grok:** add a custom connector with `https://luminarasuite.com/api/mcp`. Pass: Grok opens Luminara's sign-in, then a consent page naming Grok, you press Allow, and asking "list my Luminara projects" returns your projects.
2. **Claude Code:** run `claude mcp add --transport http luminara https://luminarasuite.com/api/mcp`, then `/mcp` and authenticate. Pass: the same as above.
3. **Antigravity:** add the same URL as a remote MCP server. Pass: the same.
4. After each, open Settings and check that the connection is listed by name and that Disconnect ends it (the next call returns 401).

If any host fails, note the step and the message. The likeliest causes are problem 1 (protocol version) and which registration method the host uses (spec 0030 lists Client ID Metadata Documents as not built).

## 6. Tasks

Slice A needs nothing from Track SW and can start now. Slice B rides on SW.

| Id | Task | Files | Check |
|---|---|---|---|
| AE-1 | Negotiate the protocol version; answer the client's version when supported | `worker/mcpServer.ts`; tests | A client sending `2025-06-18` gets `2025-06-18`; an unknown version gets the newest supported one |
| AE-2 | Brand identity in `initialize`: `title`, icon URL, `instructions` | `worker/mcpServer.ts`; `public/` icon | The answer has all three; the icon URL returns 200 |
| AE-3 | Agent-readable 401 body that points to the OAuth metadata | `worker/` auth path for `/api/mcp` | 401 body names the metadata URL; the header is unchanged |
| AE-4 | Plugin connects by OAuth: add the MCP config, drop the API-key steps from the README | `plugins/luminara/*` | Fresh install in Claude Code reaches the sign-in page with no key |
| AE-5 | Claude Code marketplace file | repo root or new public repo (decision AE-a) | `claude plugin marketplace add` lists `luminara` |
| AE-6 | Grok, Antigravity, ChatGPT guides and snippets; update `public/mcp.md` and `public/docs/mcp.html` | `plugins/luminara/hosts/*`; `public/` | Each guide's steps work end to end in section 5 |
| AE-7 | Client ID Metadata Documents, if the live test shows a host uses them | `worker/mcpOAuth.ts`; spec 0030 | That host connects |
| AE-8 | `prompts` capability with `auditor`, `fixer`, `coach` | `worker/mcpServer.ts`; `services/swarm/roster.ts` once SW2-3 adds it | `prompts/list` returns only agents that are live |
| AE-9 | `ask_auditor`, `ask_fixer`, `ask_coach` reading the run log | `worker/mcpServer.ts` | Two hosts on one account see the same thread |
| AE-10 | Approval cards over MCP using `mcp_action_requests` and a Luminara approval link | `worker/mcpGovernance.ts` | An approval made on luminarasuite.com resumes the run; one made nowhere expires |
| AE-11 | Routines from a host: set or pause the scheduled audit | `worker/mcpServer.ts`; SW decision 22 | Pausing from Grok stops the next run |
| AE-12 | Optional MCP Apps card for hosts that render it | `ui://` resource | The text card is unchanged when the host does not render it |

**Slice A status (branch `feat/agents-everywhere-slice-a`):** AE-1 to AE-6 done. AE-1 uses the negotiation that landed on staging in `3184301` (2024-11-05 to 2025-06-18, and a 400 for an unsupported `MCP-Protocol-Version` header). 2025-11-25 stays off until the server checks `Origin`, which that revision requires. Slice A adds a 405 when a client asks for a server stream. The MCP spec's current revision, 2026-07-28, drops the handshake and adds `server/discover`. That is not served yet; add it once a host is seen using it. AE-7 waits on the live test.

Slice A: AE-1 to AE-7. Slice B: AE-8 to AE-12, each after the SW task that makes its agent real (Auditor after SW1a, Fixer and Coach after SW1-15 and SW1-18, approvals after SW2-5).

## 7. Decisions for the owner

| Id | Decision | Default |
|---|---|---|
| AE-a | Marketplace in this repo or in a separate `LuminaraDigital/luminara-plugins` repo | This repo, which is already public (slice A ships `.claude-plugin/marketplace.json` at its root). Move it if you want a shorter install name |
| AE-b | Agent names shown in hosts (SW decision 24) | "Luminara Auditor", "Luminara Fixer", "Luminara Coach" |
| AE-c | Apply to Anthropic's connector directory and any Grok or Google listing | Yes, after section 5 passes |
| AE-d | Delete the "Luminara connector self-test" client made during testing | Leave it; it holds no token |

## 8. Not in this track

- A Luminara chat app of its own that copies Grok Bot.
- Plugins for third-party agent products such as Rakazo or Hermes.
- Computer use or a VM per user.
- Any change to spend, scopes or approvals beyond what spec 0030 and Track SW set.
