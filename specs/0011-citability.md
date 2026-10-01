# Citability

## Status

Accepted for Phase E. Phase 4 social remains on hold.

## Context

Phase 1 shipped a thin `llms.txt`, explicit AI-crawler rules in `robots.txt`, and an Instant Audit probe with two rows: `llms.txt` presence and whether common bots are blocked at `/`. Both rows are pass, fail, or `not_measured`. They do not change the health score.

Suite still had no citeable definition of AEO, no honesty glossary URL, and no sitemap pointer in `llms.txt`. The probe did not say whether `llms.txt` had a title and summary, whether robots hid `/llms.txt` or `/sitemap.xml`, or whether an optional `ai.txt` existed.

## Decision

1. `public/llms.txt` (served by the Worker from `worker/crawlDocuments.ts`) states the method, links the honesty glossary, points at the sitemap, and repeats only published product facts. Agents may cite `/share/teaser/`. Full `/share/` reports stay disallowed. A teaser is a redacted summary, not a verified measurement.
2. `/docs/what-is-aeo.html` is static HTML, the same pattern as `/docs/mcp.html`, so a crawler receives the definition, the method, the glossary, and the FAQ without running the app. `robots.txt` allows that path. `sitemap.xml` lists it. `/docs/what-is-aeo` and `/docs/what-is-aeo/` redirect to that file so the extensionless URL does not fall through to the app shell.
3. The Suite GEO checklist on Instant Audit lists Suite's own crawlable assets. Every row is `not_measured` until a caller supplies a probe status for that row. A client scout does not fill the list. The list is not a score.
4. Instant Audit still fetches robots and `llms.txt` with no redirect follow. It also fetches optional `/ai.txt`. New rows:
   - `llms.txt` structure: pass when the file has a title and a short summary. Fail when the file was read and one of those is missing. `not_measured` when the file was not available. The detail says this is a structure hint, not a score.
   - Cite paths: homepage, `/llms.txt`, and `/sitemap.xml` for the named AI crawlers. Longest robots rule wins. Equal length: Allow wins. A named group does not merge with `User-agent: *`.
   - Optional `ai.txt`: pass when present, fail when the fetch shows it is missing, `not_measured` when the fetch did not complete. Fail means the file was not found. It is not a citation score.
5. Named crawlers are GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Extended, and Applebot-Extended. The root block check is unchanged in spirit: an explicit `Allow: /` or `Allow: /*` still means the bot is not blocked at `/`.
6. Public teasers store crawler rows as `not_measured`. The cap is 8 rows so the five checks are not dropped. Teaser failure sentences stay the original allow-list. New rows show in the in-app crawler section. They do not add a measured badge.
7. Honesty labels from Phase 0 and Phase 1 are unchanged. Missing evidence stays `not_measured`. No row is a 0-100 score.

## Alternatives considered

- An SPA route for What is AEO: rejected. Crawlers already get real HTML from `public/docs/`, and that page does not need the app shell.
- A second methodology page: rejected. How it works already describes the product flow. The AEO page holds the short method, the glossary, and the teaser cite note.
- Mark the Suite checklist pass because the files exist in the repo: rejected. Repo presence is not a live probe.
- Treat a missing optional `ai.txt` as `not_measured`: rejected. A completed 404 is a collected signal. `not_measured` stays for fetches that did not complete. The label and detail say the file is optional and the row is not a score.
- Fail sites that do not name every AI user-agent: rejected. `User-agent: *` with `Allow: /` is not a block. The bot row still fails when a named crawler is blocked at `/`.
- Score crawler readiness out of 100, or publish a citation rate for Suite: rejected. Same rule as specs/0007-guest-scout-and-teaser.md.

## Not in scope

Phase 4 social, monetization packaging, the design-system pass, Ahrefs or IdeaBrowser depth, and a production deploy. Merging this spec's PR deploys `main`. That merge is a separate operator step.
