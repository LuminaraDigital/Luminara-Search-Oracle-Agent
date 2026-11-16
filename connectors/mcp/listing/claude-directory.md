# Claude Connectors Directory: Luminara submission pack

Prepared 2026-11-15 from Anthropic's submission guide, review criteria and Software Directory Policy. The server was checked against them, and branch `fix/claude-directory-readiness` fixed what would have been flagged. Submit after that branch is released to production.

Portal: https://claude.ai/directory/manage → **Submit new** → **MCP connector**. You need a paid Claude plan. The listing belongs to the account that submits it.

Use `https://luminarasuite.com/api/mcp` (no `www`) in the portal. Anthropic checks that the OAuth protected-resource metadata names exactly the URL you submit, and ours names that address.

## 1. What was fixed for review

| # | Was | Now |
|---|---|---|
| F1 | Seven tool descriptions told the model which tool to call first ("Read this first", "Check the research log first", "Prefer get_project_context first"). Policy 2 forbids that in descriptions | Each description says what the tool returns. The research-log and guide advice moved to the server `instructions` |
| F2 | 16 tools that change data sent `destructiveHint: false` | Every tool that is not read-only sends `destructiveHint: true`, which matches the review criteria's "modify or delete" |
| F3 | Claude users saw tools they cannot run: `mint_habitat_token` and `compile_review_to_skill` refuse OAuth connections, and the `browse_*` tools need a crawler that production doesn't set | `tools/list` leaves those two out for OAuth connections, and leaves `browse_*` out while `PATCHRIGHT_URL` is unset. The full catalogue file is unchanged |
| F4 | Internal or promotional wording: "Luminara Digital Engineering Brief", "ClaimLedger", "W5 registry wiring". The PageSpeed tool works but its description said it didn't | Plain descriptions. PageSpeed now describes the live Core Web Vitals call |
| F5 | The privacy policy didn't mention connected assistants or DataForSEO | New section "AI assistants you connect": what a tool call sends, what is stored, Disconnect, the 90-day lapse, and deletion. The example assistants are Claude, Claude Code, ChatGPT, Codex, Grok, or Cursor. The security log keeps only the tool name and the outcome. Because the log is tamper-evident, those are kept after the account is deleted. DataForSEO and PageSpeed Insights added to the providers. Deleting an account now also removes its connector sign-ins and approval requests |

Already in place, checked on production 2026-11-15:

- OAuth discovery: a 401 with `WWW-Authenticate: Bearer resource_metadata=...`, S256 PKCE, a registration endpoint, `token_endpoint_auth_methods_supported: ["none"]`, refresh-token rotation, and a form-encoded token endpoint.
- Dynamic registration accepts Claude's callback `https://claude.ai/api/mcp/auth_callback` and loopback callbacks for Claude Code.
- Every tool sends `title`, `readOnlyHint`, `openWorldHint`, and `destructiveHint`. The longest tool name is 30 characters; the limit is 64.
- Results are capped (32,000 characters of text, 50 items per page).

## 2. Owner checks (only you can do these)

1. **DataForSEO terms.** The keyword, SERP, domain and backlink tools resell DataForSEO data. Confirm that your DataForSEO plan allows its data to be shown to your users through an assistant. The form asks whether the API is your own, proxied with permission, or a third party's.
2. **Live test in Claude.** In Claude, go to Settings → Connectors → Add custom connector, enter `https://luminarasuite.com/api/mcp`, sign in, then run each tool once. The form asks you to confirm you did this. Note any tool that errors.
3. **Test account for reviewers.** Make a separate Luminara account with one project that already has an audit, a saved report and a few findings. Don't put its password in the portal. A reviewer asks for access by email if Luminara is picked for Verified review.
4. **Icon.** Upload `logo-512.png` from this folder. The pages we read didn't give a size or format, so check what the portal asks for.
5. **Security log.** Each tool call is written to the tamper-evident audit log. The log keeps only the tool name and the outcome. Because the log is tamper-evident, those are kept after the account is deleted, and the privacy policy says so.

## 3. Portal answers

**Server URL:** `https://luminarasuite.com/api/mcp` (one URL for everyone)

**Server name:** Luminara Suite

**One-liner (max 200):**
Check how your website shows up in search and AI answers, keep each site's research in one place, and save shareable reports, without leaving Claude.

**Description (max 2,000):**
Luminara Suite connects Claude to your Luminara projects: the websites you track, what Luminara has found on them, and the reports you have saved.

Ask Claude what is wrong with a site and the Luminara Auditor answers from your stored findings and the date of the last audit. Ask what is ready to fix and the Luminara Fixer lists the fix drafts on record. Ask what to do this week and the Luminara Coach gives one decision.

Claude can also read and update a project's context (competitors, key pages, research log), compare checks over time, record which recommended actions you completed, turn the project's check schedule on or off, and save a finished report to your account so you can share the link.

On paid plans, Claude can run keyword research, SERP snapshots, and domain and backlink overviews for a project.

Luminara reports only what it measured. When a number was not measured, the tools say so rather than estimate.

Sign in with your Luminara account. Connections made this way can't make payments or publish to your website without your approval, and Settings in Luminara lists every connected assistant with a Disconnect button.

**Categories (1 to 5):** Marketing, Analytics, Productivity (choose the nearest matches from the portal's list)

**Documentation URL:** https://www.luminarasuite.com/docs/mcp.html

**Privacy policy URL:** https://www.luminarasuite.com/privacy

**Support contact:** support@luminarasuite.com

**Primary use cases:**
1. Find out what is holding a website back in search and AI answers, from stored audits.
2. Keep each client or site's SEO context and research in one place across chats.
3. Save a finished report to the account and share the link.

**What users need before connecting:** A Luminara account (free works). Keyword, SERP, domain and backlink research need a paid Luminara plan.

**Reads or writes:** Both.

**Company:** Luminara Digital Pty Ltd (trading as Luminara Digital), https://www.luminarasuite.com

**Primary contact for review:** use the address you want Anthropic's review emails sent to.

**Authentication requirement:** Always required

**Authentication method:** OAuth sign-in (dynamic client registration; no client secret to enter)

**Data handling:** Your own API (it calls third-party data providers behind it; see owner check 1). Not personal health data. No sponsored content.

**Example prompts (the policy asks for at least three):**
1. "List my Luminara projects and tell me what the Auditor last found on the first one."
2. "What fixes does Luminara have drafted for example.com, and which open findings still have none?"
3. "Add competitor.com to my project's competitors, then save a one-page summary report and give me the link."

## 4. After submitting

The automatic scan lists it as a Community connector by default. Anthropic may pick it for Verified review, which is slower and includes a reviewer running each tool. No timeline is published. Track status in the portal, and email mcp-review@anthropic.com about review questions. The URL slug can't be changed once published. Changing the name later means another review. Tell Anthropic about material changes to tools, data practices or endpoints.

Sources: https://claude.com/docs/connectors/building/submission, https://claude.com/docs/connectors/building/review-criteria, https://claude.com/docs/directory/publish, https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
