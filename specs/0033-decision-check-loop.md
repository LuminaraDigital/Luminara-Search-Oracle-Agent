# 0033: Decision check loop (server re-check and fix retest)

**Status:** design record for Allora Phases 1-2 (`docs/plans/allora-concepts-implementation-plan.md`). Phase 0 groundwork is in draft PRs; Phases 1-2 are not built. Both flags are off.
**Builds on:** the weekly decision loop (`docs/plans/weekly-decision-loop-10x-ship.md`, WDL6a), the findings board, the trust receipts plan (`fix_retested` receipt type).

## What

When a founder commits to a weekly decision, the server reads the page itself and records whether the issue is there. At the verify date it reads the page again and records whether the issue is still there. The decision card shows both results side by side, with the name of the check and the date.

Three checks exist, each a pure function over page source the server fetched:

| Check | Raised by | Pass means |
|---|---|---|
| Organization schema | The missing business identity tag finding, or the "deploy schema" action | The site root carries an organization-type JSON-LD block |
| HowTo schema | The outdated how-to tag finding | The listed pages carry no HowTo JSON-LD |
| Page text length | The thin page finding | The listed pages have at least 250 words of visible text |

A result is `pass`, `fail` or `not_measured`, with a code from a closed list. A row's outcome is one of `cleared`, `still_present`, `not_reproduced`, `not_measured`, `superseded` or `expired`. The server reports an issue as gone (`cleared`) only when it saw the issue itself at the baseline.

Findings with no check (web results that do not name the business, the "rewrite answer" and "citation gap" actions) show "Server re-check: not available for this finding". Nothing here measures AI answers.

## Why

- Findings are produced in the browser and posted as given. Marking a fix done is a tap, with nothing behind it. The server cannot tell that a finding was fixed.
- Without that, nothing downstream can be honest: no retest worth paying for, no quest or level that follows a real result, no outcome data worth keeping.
- The idea comes from scoring a claim against a truth measured later. The paper it comes from (Allora) is used for concepts only; its weighting, tokens and rewards are out of scope.

## How it works

1. **Commit.** The client names a decision, its action and its finding. The server reads the rule id and target pages from the caller's own stored finding, never from the request body, and inserts at most 3 check rows inside one statement that enforces every cap.
2. **Baseline.** The server fetches each target inside one short budget and records the result. A failing baseline opens the row with a fixed due date (14 days after commit, clamped). A passing one is graded `not_reproduced`. A failed fetch is graded `not_measured`, never retried automatically.
3. **Retest.** A daily job, the first thing the daily cron runs, claims due rows (at most one per site per run), fetches with the same method and grades them. Plans that include it get the automatic retest; anyone may ask for one manual retest per decision per day.
4. **Show.** The card shows the check name, the baseline and the retest, the method limit ("reads page source, not AI answers"), and dates. No causal wording.

Fetching goes through one bounded wrapper: GET only, a 5 s deadline over DNS and every hop, at most 3 redirects on the same host or its `www` twin, default port, the Worker's own hosts refused, HTML or plain text only, 512 KB cap. No fetched text is ever stored or returned.

## Invariants

- A client string never widens scope: domain, target host, URL length and every cap are checked by the server.
- No check result comes from the client. The client names a rule; the server measures.
- `cleared` and `still_present` require a failing baseline the server recorded.
- Results are statuses, codes, names and dates. No score, no derived number, no word "confirmed", "verified" or "fixed".
- Each flag is its feature's kill switch, and the KV switch `decision_checks:off` pauses either without a deploy. Pausing never blocks a decision from saving.
- A refusal (caps, rate limit, an unreadable switch) still saves the decision and says why no check ran.

## Limits and caps

- Per account: checks for at most the plan's domain allowance over 30 days; 3 rows per decision; 30 open rows; 20 new rows per 24 hours.
- Per site: at most 12 server fetches per hour across all accounts; no fetch for 24 hours after a 403 or 429.
- Accepted residuals: any signed-in account may name any public site, within those caps; other accounts can use a site's hourly budget, which delays a check and never falsifies one.

## Alternatives considered

| Question | Chosen | Why not the other |
|---|---|---|
| Run checks in the browser and post results | Server fetch | A client-posted result is a claim, not a measurement |
| Check at the verify date only | Baseline at commit and retest later | Without a baseline the server cannot say the issue was ever there |
| A 15-minute cron, or a new cron expression | The existing daily cron | Volume is tiny, and a new cron risks running every job if its mapping is missing |
| Decide retest entitlement at job time | Fixed at commit | Plans last 30 days and the window is 14; a job-time check drops what was sold |
| A public-suffix list for subdomains | Only the domain and its `www` twin | Removes the need for the list |
| Reuse the crawler-file fetcher | A new bounded wrapper | That fetcher is shared with the landing Probe, which must not change |
| Expire rows 7 days past due | Only at `expires_at` | A second rule would silently drop a sold retest |
| Weight or combine several measurements | Not in this version | The live path has one sample per engine; nothing to combine |

## Not in this version

- Retesting whether AI answers changed (WDL6b; needs answer capture).
- Crawler-file checks (`llms.txt`, robots): no finding or action maps to them yet.
- Quests, levels or badges fed by `cleared` (Track SW SW9) and the `fix_retested` receipt (Trust Network).
- The one-off calibration study (Allora Phase 3a), behind its own owner decision.
