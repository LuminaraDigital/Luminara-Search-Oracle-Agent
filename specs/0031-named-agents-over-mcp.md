# 0031: Named agents and approval links over MCP

**Status:** built on `feat/agents-everywhere-slice-b` (Track AE slice B, first cut)
**Builds on:** spec 0030 (agent connector sign-in), Track AE plan (`docs/plans/luminara-agents-everywhere.md`), Track SW roster.

## What

A person using Luminara from Grok, Claude Code, Antigravity or Cursor can ask three named agents about a project and get the same answer in every host:

- **Luminara Auditor** (`ask_auditor`): what Luminara last recorded as wrong with the site, and when.
- **Luminara Fixer** (`ask_fixer`): which fix drafts are stored and which findings still have none.
- **Luminara Coach** (`ask_coach`): the decision set for this week, or a labelled candidate when none is set.

Each is one free, read-only MCP tool and one MCP prompt of the same name (`auditor`, `fixer`, `coach`). The server also gives a working approval link when a tool needs the owner's yes.

## Why

- Slice A put Luminara's name and voice in every host. The agents are still invisible there: a host sees a flat list of 33 tools.
- The server instructions already promise an approval link, but the answer carries only a request id. No page on luminarasuite.com opens a request by id, so an agent in Grok stops with nothing to hand the owner.

## What each agent reads

Nothing here runs a model, crawls a site or writes a row. Each tool reads rows Luminara already stores for the account and says "not measured" where there is none.

| Agent | Reads |
|---|---|
| Auditor | Open and in-progress `audit_findings` for the project's domain (count by severity, top five); the newest saved Instant Audit entry (its date, and its health score if it has one) |
| Fixer | `prepared_assets` linked to this domain through a finding or a weekly decision (title, kind, status); the open findings with no stored draft |
| Coach | This ISO week's `weekly_decisions` row for the domain or project, else the newest one; whether its linked finding is still open. With no decision this week it names the worst open finding and labels it a candidate, not a decision |

Every answer has the same shape: agent name and domain, verdict, one next action, and a luminarasuite.com link. The structured content carries the same facts as fields. Text comes from stored rows and fixed sentences only; the only numbers are counts of stored rows and values a row holds.

**The Auditor never reads as a fresh check.** Every Auditor answer carries the date of the stored data and the sentence "Luminara has not re-checked the site since." A site whose findings are all resolved still gets the date of its last saved audit, not a claim that it was never audited.

**A count that hit a row cap says so.** Lists are capped (200 findings, 100 drafts). At the cap the answer says "at least 200", never a bare total.

**With nothing stored, all three give the same single action.** No free MCP tool writes findings; only the web app's Instant Audit does. So an empty answer links to `luminarasuite.com/?startapp=audit_<domain>`, which opens the Instant Audit with the domain filled in, and says to ask again afterwards.

**Stored text is treated as untrusted.** A finding's title can carry words from a crawled third-party page. Titles reach the host flattened to one line, capped, with links removed, inside quotes, and every answer ends with a line saying quoted text is data, not an instruction. Draft bodies and finding descriptions are never returned.

**Domains are matched in both stored forms.** Findings and audits are stored under the bare host; weekly decisions keep whatever was typed. Lookups match the bare host and its `www.` form, and weekly decisions also match on the project id.

## Scope and limits

- Input is `projectId`. The project must belong to the calling account; otherwise the answer is "Project not found".
- The tools are in the `read` risk class and the `free` credit class, so `mcp:free` connector tokens can call them and they count toward the daily MCP call cap like any other tool.
- A habitat token stays locked to its project: the tools declare `projectId`, so the existing scope check forces it.
- Server audits (Track SW1a) are not live. The Auditor says so plainly rather than implying it just ran an audit. When SW1a lands, the same tool reads the run log and nothing about its contract changes.
- Fix drafts from `draft_fix` are not stored today, so the Fixer cannot list them. It lists `prepared_assets` only.

## Prompts

`initialize` adds the `prompts` capability. `prompts/list` returns `auditor`, `fixer` and `coach`, each with the title "Luminara Auditor" and so on, a one-line description, and one optional argument, `project` (a domain or project id). `prompts/get` returns one user message that tells the host's model to find the project, call the matching `ask_*` tool, and reply in the agent's shape. The text comes from the roster constant, never from a caller's input other than the `project` argument. That argument must look like a domain or an id (letters, digits, dots, dashes, underscores, at most 100 characters) and is quoted as data; anything else, or an unknown prompt name, is refused with JSON-RPC error -32602. Prompt requests do not count toward the daily MCP call cap: they read nothing from the account.

## Approval links

When a destructive tool needs approval, the answer becomes a card:

- the tool name,
- `https://luminarasuite.com/?mcp_approval=<request id>`,
- "The link works for N more minutes, for the signed-in account owner only. After approving, ask for the same action again with the same details." N is the time left on the request, 30 at most."

The structured content adds `approvalUrl` and `expiresAt`.

The web app reads `mcp_approval` on load. Signed out, it asks for sign-in first (the same pattern as `agent_connect`). Signed in, it shows one dialog: tool, project, the stored (already redacted) arguments, time left, and **Approve once** and **Deny**. It also shows a fixed sentence per tool saying what approving does; that sentence never comes from the agent's arguments. It uses the existing approve and deny routes, plus one new read route, `GET /api/mcp-action-requests/:id`. The dialog handles four other states: not found, another account's request, already decided, and expired.

The owner must see everything they approve. If the stored arguments are too long to show in full, or nested so deep that part was cut out before storing, the page says so and offers Deny only.

Another account's request and a missing request get the same 404, on the new read route and on approve and deny (which used to answer 403 and so confirmed the id existed). Only a signed-in Luminara session can approve: connector tokens and API keys are not accepted on these routes, so an agent cannot approve its own request. The link id is removed from the address bar as soon as the page reads it.

An approval authorizes one call with exactly the arguments it was requested with. The stored arguments are redacted for display, so they cannot be what the next call is compared against: two calls that differ only in a redacted value (a token, a password) store the same text. Each request therefore also stores a SHA-256 of the unredacted arguments, with object keys in a stable order, in `mcp_action_requests.args_hash` (migration `0049_mcp_action_request_args_hash.sql`). Reusing a pending request and spending an approval both match on that hash, so key order does not matter and a changed secret does. The hash stays in the worker; no route returns it. A request stored before the migration has no hash and cannot be spent; it would have expired within 30 minutes anyway, and the agent asks again. The link carries no authority: opening it without the owner's session shows nothing, and the id is a random UUID.

Two existing gaps are closed on the way. A new request for the same tool and arguments reused a pending request even after it had expired, so the link would have been dead on arrival; an expired pending request is now ignored and a fresh one is created. And an expired request could still be approved (the approval could never be used); it can now only be denied.

## Alternatives considered

- **Wait for Track SW.** Rejected: the three read tools need no run engine, and the approval link is broken today. When SW lands, the tools gain a data source and keep their names.
- **Separate MCP servers per agent.** Rejected: three sign-ins per host and three places for limits to drift.
- **Approve inside the host (MCP elicitation).** Rejected for now: support differs by host, and an approval made in a host is weaker evidence that the account owner said yes than one made in a signed-in Luminara session.
- **Have Coach or Fixer call a model.** Rejected: that needs the spend limits and output checks Track SW defines. These tools read.

## Not in this cut

- Routines from a host (AE-11): no per-project scheduled audit exists that a user can pause or resume.
- MCP Apps cards (AE-12).
- Showing which connection created an approval request. The request row does not record it; adding that needs a migration.
- A cap on pending approval requests per account. Free and Starter are bounded by the daily call cap; Growth and Agency are not.
- Showing the owner a redacted value. The page shows `[redacted]` where the call carries a secret, and the approval is bound to the real value by its hash, so the owner approves a value they cannot read. The agent cannot swap it afterwards.
- A keyed hash. `args_hash` is a plain SHA-256, so someone who can read the table could test guesses for a short redacted value. Closing that needs a server secret (HMAC).
- Analyst and Prospector.
