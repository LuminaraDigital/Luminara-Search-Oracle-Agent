# ChatSEO competitive gap: what to copy, what to beat, what to skip

Status: v0.2, 2026-10-27, after review round 1 (section 8). Owner brief: study chatseo.app (landing page and product), find what Luminara Suite is missing, and ship what it takes to compete and spread.

Gates, release flow, and the double-check protocol follow section 2 of `docs/plans/zoro-concepts-implementation-plan.md`. Honesty rules follow `AGENTS.md` (never invent metrics) and `docs/plans/conversion-honesty-ship.md` (what the landing probe may claim). This plan does not restate them.

## 1. What ChatSEO does (observed 2026-10-27)

Read on chatseo.app in the browser: the landing page, `/pricing`, `/free-seo-tools`, `/serp-snippet-preview`, and the onboarding at `/dashboard/c/onboarding`. We stopped at the Search Console step, which is a Google OAuth grant. A review agent also read `/mcp`, the help pages, and the sitemap.

**Landing page, top to bottom**

1. Hero: one URL field and one button ("Analyze my website"), rotating engine logos in the headline (Google, Gemini, and others), "Free to start, no credit card", avatars plus stars plus "Used by 20,000+ website owners", and a logo strip. The closing section says it analyzes what Google and the main AI assistants see.
2. Scripted product demo: a chat that shows tool calls (Queries by Page, Content Analysis, SERP Analysis) and ends in three action cards ("Rewrite the title + H1", "Build the service-area pages", "Link the 6 orphaned posts") with an "apply the fix" button. Four tabs: Site Audit, Competitor Watch, Article Writing, Keyword Discovery.
3. Client results with named people and numbers.
4. "Replace your SEO stack": a table of jobs, the tool people pay for today, and its monthly price, summed against ChatSEO's price.
5. Wall of love: 42 dated, named testimonials.
6. MCP and API: "Use your favorite AI", with a Claude transcript answering from Search Console data.
7. FAQ aimed at objections: different from a general chatbot? I am not an SEO, will I manage? Does the AI make things up? Does it change my site? Is my data safe? How soon? Will it work for my site?
8. Closing URL field.

**Footer and site structure.** 12 feature pages (`/features/*`), 4 audience pages (`/solutions/*`, including agencies and web designers), 10 free tools (SERP snippet preview, meta description checker, Open Graph checker, robots.txt generator, schema generator, Google index checker, on-page checker, H1 checker, readability, keyword density), an affiliate program (30% recurring, per the CEO review), French versions, and trust pages (security, DPA, sub-processors). Two French "alternative to" pages (Rank Math, Yoast SEO); no English comparison pages.

**Activation flow.** One conversational screen. In our session the browser may already have been signed in; ChatSEO's help page says the flow runs at first login.

1. "Site read: 16 pages crawled. Here's how Google shows you today", with the homepage rendered as a Google result.
2. A model writes the offer in one paragraph and asks "is that right?" in an editable box.
3. It suggests competitors from the search results ("up to three" on screen; the help page says up to 10 can be saved) and shows a table out of 100, which its help page says is Ahrefs Domain Rating.
4. Then it asks for Search Console ("Read-only, disconnect whenever") to "pull out the query with the most to gain".

**Pricing.** Four tiers by credits (1 credit = 1 message), free to start, monthly or annual (minus 20%), a 7-day money-back guarantee, "76% choose Pro", and API and MCP from the second tier up. CMS publishing: WordPress and Shopify, with Webflow and Wix marked Soon on the rendered pricing page. Also weekly SEO reports and white-label exports. "200,000+ SEO analyses completed".

**Free tool page anatomy.** H1, a live tool (inputs on the left, a Google preview on the right, pixel and character counters, a desktop and mobile toggle, "Copy HTML"), how to use it in four steps, why it matters, an FAQ, and a closing CTA into the product. Their robots.txt generator has no per-crawler AI switches; it shows a hand-written example that blocks GPTBot, CCBot and ClaudeBot.

## 2. What Luminara Suite already has

- A hero domain field with a live anonymous check (`/api/visibility/probe-crawl`). It reads robots.txt, llms.txt and ai.txt, and labels the engines Not measured.
- Guest Instant Audit, redacted teasers (`specs/0007-guest-scout-and-teaser.md`), referrals and streaks (`specs/0009-referrals-and-retention.md`).
- Comparison and buyer's guide pages (`/compare/*`, `/best/*`) from one registry (`services/marketing/seoHubPages.ts`), with sourced vendor rows and FAQ JSON-LD.
- Per-path Worker meta and crawler HTML for every marketing path (`services/marketing/pageMeta.ts`, `worker/marketingShell.ts`).
- MCP for Cursor and Claude (Growth and Agency), a competitor map, JSON-LD and llms.txt fix packs, the Enquiry Desk, and the Telegram Mini App.
- Search Console: Instant Audit shows clicks, impressions, CTR and position from a CSV export the user uploads (`components/audit/GscPanel.tsx`). The data does not feed findings or the ranked fix. There is no live connection; `GOOGLE_OAUTH_CLIENT_ID` is declared in `worker/env.ts` but unused.
- CMS: schema fixes can be sent to WordPress or Webflow, or opened as a GitHub pull request (`services/deployment/cmsDeploymentService.ts`). A WordPress deploy counts as done only when the page is read before and after and the schema appears; Webflow and GitHub results say what is left to publish or merge. Articles are not written or published.
- An honesty spine that the competitor does not have: every result is Measured, Estimated or Not measured, there is no blended score, and nothing is invented.

## 3. Gap matrix

Priority: **P0** ships in this plan's first PR or the one after. **P1** is next. **P2** needs an owner decision or real customers first. Effect: activation acts at once on traffic we already have; acquisition (pages that rank) takes weeks to months; conversion multiplies both.

| # | ChatSEO has | Luminara today | Move | Priority |
|---|---|---|---|---|
| 1 | 10 free tools that rank and feed sign-ups | None | Free tools hub plus four tools tuned for AI answers, each ending in the live crawl check | P0, this PR |
| 2 | No English comparison pages | `/compare/*` for five vendors | Add `/compare/chatseo`, sourced from their public pages. Defensive: few agency owners search for it, but AI answers get a page to cite | P0, this PR |
| 3 | "Here's how Google shows you today" before value is asked for | robots.txt and llms.txt only | Probe also reads the homepage head once; the landing shows the snippet the page writes, labeled as read from the page, not as what Google shows (G1c) | P0, next PR |
| 4 | Objection FAQ | Five FAQs, none of those | Three objection answers we can make honestly | P0, this PR |
| 5 | Free tools linked from the footer | n/a | Footer link, no landing strip: the landing keeps one CTA, and the G1c result links to the tools | P0, this PR |
| 6 | Model reads the offer and confirms it | Not in the first-run flow | After sign-in, prefill the project context from the homepage read; the user confirms it | P1 |
| 7 | Competitor suggestions plus an authority table | Competitor map inside the audit | Surface the competitor step in first-run onboarding; authority only where DataForSEO measured it | P1 |
| 8 | Search Console "query with most to gain" | CSV upload, no live connection | Read-only Search Console OAuth connect, then make it the first-run step. Google's review of the read-only scope takes weeks, so file it now | P1 |
| 9 | Weekly SEO report email | Telegram re-audit reminders | Weekly email digest with the one fix and what moved | P1 |
| 10 | Scripted product demo with action cards | Illustrative report card | Labeled-illustrative chat demo ending in one fix card. Real first value on the visitor's own site (G1c) beats an illustration | P2 |
| 11 | Shareable result | Teasers need identity; report shares are Growth+ | `/check/<domain>` link that re-runs the free check on open (noindex), with a text social preview and a per-host cache so a shared link cannot hammer the site it checks | P0, with G1c |
| 12 | 20,000+ users, logos, 42 testimonials, results | None, by rule | 3 to 5 consented quotes from named agencies first; a "checks run" counter only above an owner-set threshold, excluding internal and test domains | P1 (owner work) |
| 13 | "Replace your stack" price table | Hub rule bans competitor prices in figures | Compare by job, not by price | P2 (owner) |
| 14 | Money-back guarantee, annual discount, credits | 30-day passes, no renewal | Owner decision 2 | P1 (owner) |
| 15 | Affiliate cash commission | Referral credits | Owner decision 3; start with 3 hand-picked web-developer partners on the referral system | P2 (owner) |
| 16 | CMS publish of articles (WordPress, Shopify; Webflow and Wix Soon) | Schema deploy to WordPress, Webflow, or a GitHub pull request | Say so on the landing and pricing pages; article publishing stays out of scope | P2 |
| 17 | French site | English only | APAC-first languages after the copy settles | P2 |
| 18 | `/features/*` and `/solutions/*` pages | `/best/*`, `/compare/*` | A web-developer and consultant page first, since they run most agency sites; others once the P0 pages show impressions | P2 |
| 19 | White-label exports | White-label PDF on Starter and up | "Prepared by" sharing on Agency with a small "Checked with Luminara" footer | P2 |

What we do not copy: an authority figure without a named source, unverifiable user counts, scores that blend measured and guessed inputs, anonymous model calls (`specs/0007-guest-scout-and-teaser.md` rejects anonymous hosted spend), and breadth for its own sake (an article writer, 10 tools, a page per feature).

Where we beat them: AI crawler and llms.txt tooling (ChatSEO has no llms.txt tool and no per-crawler AI switches), evidence labels on every result, real estate depth (agent schema, suburb answers, Enquiry Desk), APAC focus, Telegram and MCP surfaces.

The bigger threats, per the CEO review, are an agency's own web or marketing provider, real estate website and CRM platforms, and SEO suites that bundle AI visibility. Copy ChatSEO's funnel mechanics (value first, free tools), not its breadth.

## 4. Phase G1 (this PR: G1a, G1b, G1d)

### G1a. `/compare/chatseo`

One `ComparePage` entry in `services/marketing/seoHubPages.ts`. The registry already feeds the view, crawler HTML, JSON-LD, sitemap and llms.txt. Rows come only from chatseo.app's own pages read on 2026-10-27, including its help page on where its numbers come from; no prices in figures (registry rule).

### G1b. Free tools

- Registry `services/marketing/freeTools.ts`: path, label, description, H1, lede, how-to steps, why blocks, FAQ. One source for the view, Worker shell, sitemap and llms.txt, like the hub registry. `freeToolsPageForPath` is the one path resolver.
- Pure logic in `services/freeTools/` (no DOM, unit tested): SERP pixel widths and truncation, robots.txt builder and presets, llms.txt builder, JSON-LD builder, and `toHttpUrl` for every typed link.
- Views in `components/marketing/freeTools/`: one page frame plus one panel per tool, in the space design (`lx-*`). The one gold action on each page is the landing's live crawl check (`DomainCheck`, surface `free_tools:<id>`); guests go to sign-up from its result, as on the landing.
- Paths: `/free-tools`, `/free-tools/serp-preview`, `/free-tools/robots-txt-generator`, `/free-tools/llms-txt-generator`, `/free-tools/schema-generator`.
- Tool logic runs in the browser and sends nothing typed. The only tool event is `free_tool_copied` with the tool id. The crawl check sends the domain typed into it, and the copy says so.
- Each generator's last step says to add to an existing file rather than replace it, and "Not sure how? Send it to whoever manages your website."

### G1d. Copy

- Three objection FAQs on the landing (also in FAQPage JSON-LD): how is this different from asking an AI chatbot, does Luminara make up numbers, does it change my website (only if you connect WordPress, Webflow, or GitHub, with what each one confirms).
- Footer link "Free tools".

### G1 acceptance

- Each new path returns its own title, description, canonical, JSON-LD and crawler HTML from the Worker, is in the sitemap and llms.txt, and renders the right view on a cold load. Unknown `/free-tools/*` slugs are Not Found.
- Unit tests for every pure builder, including cross-checks against `evaluateLlmCrawlerReadiness`; route, shell and render tests for every page, asserting each tool's generated output and the live check.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green. Thermo-nuclear review on the branch diff with findings fixed.
- No em dashes in new copy. No new claim that the honesty gates or `tests/claimHonesty.test.ts` reject.
- Design record: `specs/0028-free-tools.md`.

## 4a. G1c and the share link (next PR, branched from this one)

Status 2026-10-28: built on `feat/g1c-homepage-snippet`, stacked on the G1 PR. Design record: `specs/0029-homepage-snippet-check.md`. The honesty plan carries the dated amendment. Live reads that day: luminara.digital, jelliscraig.com.au and chatseo.app read in 0.2 to 2 seconds; raywhite.com answers bots with 403 and shows as "blocked".

The single biggest activation gap: ChatSEO shows a site its own search snippet in its first screen; our free check shows two file names. Split out because:

- `docs/plans/conversion-honesty-ship.md` rules that the landing probe never labels a Google or AI engine row Measured and never becomes an HTML proxy. G1c returns parsed head fields only, never page HTML, and labels the snippet "as your page writes it", Measured from the page fetch, with "Google can rewrite it" beside it. Google stays Not measured. That plan's line needs an explicit amendment in the same PR.
- The redirect path in `worker/llmCrawlerRoute.ts` checks protocol, same site and DNS on each hop, but does not re-run `safePublicUrl` or check the port, and `resolvesToPublicAddress` has no timeout. `fetchPublicUrl` also follows cross-host redirects and has no timeout or size cap of its own. A homepage fetch is a bigger target than three text files, so those gaps close first.

Scope:

1. Harden the shared guard: DNS lookup timeout, default-port-only redirects, `safePublicUrl` on every hop.
2. `probe-crawl` adds one GET of the homepage through `fetchPublicUrl` with a 5 second timeout, a 256 KB cap, `content-type: text/html` only, a `LuminaraProbe/1.0` user agent, and no cookies. It returns `page: { status, finalUrl, title, description, canonical, h1, ogImage, jsonLdTypes, noindex }` or `page: null` with a reason code, and logs the reason code so we learn what share of agency homepages we can read. Parsing extends `extractPageSample` (`services/ideaScout/rules.ts`, already in the Worker; today it returns title, meta description and headings only); no new dependency.
3. The landing result renders the snippet with the G1b SERP component and its length checks, and links each failing field to the free tool that fixes it.
4. Copy that says the check reads "robots.txt and llms.txt" changes in the same PR: `GUEST_HERO_NOTE` and "crawl files only" in `services/audit/hostedScoutRail.ts`, the FAQ in `services/marketing/marketingFaqContent.ts`, `components/marketing/SeoHubPage.tsx`, the buyer's guide copy in `services/marketing/seoHubPages.ts`, and `FREE_TOOLS_CLOSING.body` in `services/marketing/freeTools.ts`, with `tests/playtestHigh14.test.ts` updated.
5. Item 11: `/check/<domain>` share link, noindex, cached per host.
6. Tests: good page, missing head, non-HTML, oversized body, redirect to another host, redirect to a private address, blocked by a challenge page, DNS timeout.

## 5. Later phases

- **G2 (P1):** items 6 to 9, 12 and 14. Needs a spec for the first-run flow (offer prefill, competitor step, Search Console step) and a spec for the weekly email.
- **G3 (P2):** items 10, 13, 15 to 19, each gated on the owner decision or the data named in the matrix.
- **Nice-to-haves from review:** an "Email this to my web developer" button on each generator; a warning while the output still holds the example business; an `/free-tools/ai-crawler-checker` page that wraps the probe; owner-language H1s ("Google result preview"); a dated, aggregate study of robots.txt and llms.txt across Australian independent agency sites (Measured, names no agency) as a press asset.

## 6. How we'll know

Events that already exist, read from D1:

- `page_view` with `FREE_TOOLS:<path>` and `COMPARE:/compare/chatseo`.
- `free_tool_copied` by tool.
- `probe_completed` by `surface` (`landing_inline` against `free_tools:<id>`).
- `signup_completed`, joined to the above by session.

Take the baseline from D1 before merge, then check at 4 and 8 weeks after release. No targets are set in advance; the first read sets them.

## 7. Owner decisions

1. **Price table.** Recommendation: compare by job only. Agency owners do not pay for most of those tools, and dated prices go stale.
2. **Money-back guarantee.** Recommendation: yes, 7 days on the first card pass, once per customer, stated on the pricing page. Telegram Stars stay out of it.
3. **Affiliates.** Recommendation: keep credits for customers. Pay cash only to web-developer and consultant partners, by hand, once there are about 10 paying customers.
4. **"Checks run" counter.** Recommendation: not yet. Build it behind a flag that excludes internal and test domains, and show it only above a threshold you set.
5. **Audit treatment of training-only crawlers.** The audit fails a site that blocks GPTBot, ClaudeBot or Applebot-Extended, although OpenAI and Anthropic document those as training crawlers that do not decide search citations. The free tool's "answers yes, training no" preset therefore shows as blocked in Instant Audit (the preset note says so). Recommendation: report blocked training-only crawlers as information, not a fail, in its own PR, with `tests/guestScoutHonesty.test.ts` and `tests/citability.test.ts` updated.
6. **Free share.** May free users share their verdict and one fix publicly (item 11)? Recommendation: yes; the full report share stays Growth and up.
7. **Search Console.** Start Google's review of the read-only scope now? Recommendation: yes.
8. **Proof.** Who collects 3 to 5 consented agency quotes this month, and with what consent wording?
9. **Aggregate study.** Publish the dated agency robots.txt and llms.txt study?

## 8. Review record

**Round 1 (2026-10-27).** Four independent reviewers on commit 57bf789 and this plan.

- **CEO gate: GO WITH CHANGES.** Required: make the tool pages' gold action run the real check instead of a sign-in wall; start owners at the check, not the generator; fix the Google-Extended treatment; tell owners to add to an existing robots.txt and to forward files to whoever runs their site; correct the ChatSEO CMS list and add its free start and its AI-assistant claim; soften three overstated lines; add the measurement section; move the share link into the G1c week; scope the "nothing you type" copy to the tools. All applied.
- **Code quality (thermo-nuclear): ship after fixes.** Applied: one path resolver and a `PATH_DRIVEN_VIEWS` set in App; one shared FAQ component and section styles; native radio groups; crawler switches with a fixed label and a state-safe updater; refusing `/` and `/*` as private paths; the shared `escapeHtml` and `toHttpUrl` in the SERP breadcrumb; `matchingPreset` moved to the builder with tests; tests that assert each tool's output and the public view; stable row keys; an `itemListNode` helper; a copy fallback when the clipboard is unavailable; device-labelled counters; input modes; a hub h2. Not applied: explicit `Allow: /free-tools` lines in robots.txt and ai.txt (`Allow: /` already covers them, and another session is working on ai.txt).
- **Correctness and security: fix 4 before merge.** Applied: Google-Extended, the overstated block preset and robots.txt FAQ, Claude-User, the schema FAQ visibility rule, the CMS FAQ wording, robots.txt comment and URL handling, llms.txt heading and parenthesis handling, the breadcrumb host and bad escapes, unused constants. Raised to the owner instead of changed here: the audit's treatment of training-only crawlers (decision 5). Not applied: lowercasing paths, because `/compare/*` is case sensitive by design and these pages follow it.
- **Fact check:** corrected the ChatSEO CMS list, audience, authority source (Ahrefs Domain Rating, now cited), comparison pages, robots.txt generator, activation flow details, and headline; our Search Console and "Measured" FAQ wording; the spec's network invariant; this plan's citations and spec file names.

**Round 2 (2026-10-27).** An independent verifier checked all 17 round-1 items against commit b7f418d: all fixed, and the three skips judged reasonable. Verdict GO for a draft PR. It found two new issues, both fixed: the llms.txt heading filter also stripped "#1 agency" (now only a real Markdown heading is removed, with a test), and the hub FAQ implied the free check detects blocked crawlers (it only reports whether the files exist; Instant Audit shows the blocks). Nits also fixed: "asked not to read" instead of "can no longer read", the audit's failed-check wording, the copy fallback text, and the crawler switches now take their name from the visible crawler label. Left as a follow-up: `/compare/*` and `/best/*` CTAs still open Instant Audit for guests instead of the live check or sign-up (older behaviour, not in this PR's scope); the shared `escapeHtml` encodes apostrophes in a copied title, which is valid HTML.
