# ChatSEO competitive gap: what to copy, what to beat, what to skip

Status: draft v0.1, 2026-10-27. Owner brief: study chatseo.app (landing page and product), find what Luminara Suite is missing, and ship what it takes to compete and spread.

Section 2 of `docs/plans/zoro-concepts-implementation-plan.md` applies (honesty rules, review loop, release flow). This plan does not restate it.

## 1. What ChatSEO does (observed 2026-10-27)

Read on chatseo.app in the browser: the landing page, `/pricing`, `/free-seo-tools`, `/serp-snippet-preview`, and the guest onboarding at `/dashboard/c/onboarding` (walked up to the Search Console OAuth step, which needs a Google sign-in and was not granted).

**Landing page, top to bottom**

1. Hero: one URL field and one button ("Analyze my website"), a rotating engine name in the headline (Google, Perplexity, ChatGPT), "Free to start, no credit card", avatars plus stars plus "Used by 20,000+ website owners", and a logo strip.
2. Scripted product demo: a chat that shows tool calls (Queries by Page, Content Analysis, SERP Analysis) and ends in three action cards ("Rewrite the title + H1", "Build the service-area pages", "Link the 6 orphaned posts") with an "apply the fix" button. Four tabs: Site Audit, Competitor Watch, Article Writing, Keyword Discovery.
3. Client results with named people and numbers.
4. "Replace your SEO stack": a table of jobs, the tool people pay for today, and its monthly price, summed against ChatSEO's price.
5. Wall of love: about 40 dated, named testimonials.
6. MCP and API: "Use your favorite AI", with a Claude transcript answering from Search Console data.
7. FAQ aimed at objections: different from ChatGPT? I am not an SEO, will I manage? Does the AI make things up? Does it change my site? Is my data safe? How soon? Will it work for my site?
8. Closing URL field.

**Footer and site structure.** 12 feature pages (`/features/*`), 4 audience pages (`/solutions/*`), 10 free tools (SERP snippet preview, meta description checker, Open Graph checker, robots.txt generator, schema generator, Google index checker, on-page checker, H1 checker, readability, keyword density), an affiliate program, a language switcher, and trust pages (security, DPA, sub-processors).

**Activation flow (no account).** One conversational screen:

1. "Site read: 16 pages crawled. Here's how Google shows you today", with the homepage rendered as a Google result.
2. A model writes the offer in one paragraph and asks "is that right?" in an editable box.
3. It finds up to three competitors from the SERP, offers them as chips, and shows a domain authority table (us against them, out of 100).
4. Only then does it ask for Search Console ("Read-only, disconnect whenever") to "pull out the query with the most to gain".

Sign-up comes after the first value, not before it.

**Pricing.** Four tiers by credits (1 credit = 1 message), monthly or annual (minus 20%), a 7-day money-back guarantee, "76% choose Pro", and API and MCP from the second tier up. Also: CMS publishing (WordPress, Shopify), weekly SEO reports, and white-label exports.

**Free tool page anatomy.** H1, a live tool (inputs on the left, a Google preview on the right, pixel and character counters, a desktop and mobile toggle, "Copy HTML"), how to use it in four steps, why it matters, an FAQ, and a closing CTA into the product.

## 2. What Luminara Suite already has

- A hero domain field with a live anonymous check (`/api/visibility/probe-crawl`). It reads robots.txt, llms.txt and ai.txt only, and labels the engines Not measured.
- Guest Instant Audit, redacted teasers, referrals and streaks (specs 0007 and 0009).
- Comparison and buyer's guide pages (`/compare/*`, `/best/*`) from one registry (`services/marketing/seoHubPages.ts`), with sourced vendor rows and FAQ JSON-LD.
- Per-path Worker meta and crawler HTML for every marketing path (`services/marketing/pageMeta.ts`, `worker/marketingShell.ts`).
- MCP for Cursor and Claude (Growth and Agency), a competitor map, JSON-LD and llms.txt fix packs, the Enquiry Desk, and the Telegram Mini App.
- Search Console: the audit reads a CSV export the user uploads (`components/audit/GscPanel.tsx`). There is no live Search Console connection.
- CMS: schema fixes can be sent to WordPress or Webflow, or opened as a GitHub pull request (`services/deployment/cmsDeploymentService.ts`). A WordPress deploy counts as done only when the page is read before and after and the schema appears. Articles are not written or published.
- An honesty spine that the competitor does not have: every result is Measured, Estimated or Not measured, there is no blended score, and nothing is invented.

## 3. Gap matrix

Priority: **P0** ships in this plan's first PR. **P1** is the next PR. **P2** needs an owner decision or real customers first.

| # | ChatSEO has | Luminara today | Move | Priority |
|---|---|---|---|---|
| 1 | 10 free tools that rank and feed sign-ups | None | Free tools hub plus four client-side tools tuned for AI answers: SERP preview, robots.txt generator with AI bot switches, llms.txt generator, real estate schema generator | P0 |
| 2 | No comparison pages of its own | `/compare/*` for five vendors | Add `/compare/chatseo`, sourced from their public pages | P0 |
| 3 | "Here's how Google shows you today" before sign-up | robots.txt and llms.txt only | Probe also reads the homepage head once and the landing shows the snippet the page writes, labeled as read from the page, not as what Google shows. Own PR (G1c) | P0, next PR |
| 4 | Objection FAQ (ChatGPT? made-up data? changes my site?) | Five FAQs, none of those | Add the three objection answers we can make honestly | P0 |
| 5 | Free tools linked from nav and footer | n/a | Footer column plus one landing strip | P0 |
| 6 | Model reads the offer and confirms it | Not in guest flow | After sign-in, prefill the project context from the homepage read; the user confirms it | P1 |
| 7 | Competitor chips from the SERP plus authority table | Competitor map inside the audit | Surface the competitor step in first-run onboarding; authority only where DataForSEO measured it | P1 |
| 8 | Search Console "query with most to gain" | CSV upload in the audit, no live connection | Read-only Search Console OAuth connect, then make it the first-run step after the first value | P1 |
| 9 | Weekly SEO report email | Telegram re-audit reminders | Weekly email digest with the one fix and what moved | P1 |
| 10 | Scripted product demo with action cards | Illustrative report card | Scripted, labeled-illustrative chat demo ending in one fix card | P1 |
| 11 | Shareable result | Teasers need identity | A shareable `/check/<domain>` link that re-runs the free check on open (noindex) | P1 |
| 12 | 20,000+ users, logos, 40 testimonials, results | None, by rule | Only real proof: a live "checks run" counter from D1, then real customer quotes with consent | P2 (needs data) |
| 13 | "Replace your stack" price table | Hub rule bans competitor prices in figures | Compare by job, not by price, or get owner sign-off to cite dated list prices | P2 (owner) |
| 14 | Money-back guarantee, annual discount, credits | 30-day passes, no renewal | Business decision | P2 (owner) |
| 15 | Affiliate cash commission | Referral credits | Business decision on payouts | P2 (owner) |
| 16 | CMS publish of articles (WordPress, Webflow) | Schema deploy to WordPress, Webflow, or a GitHub pull request | Say so on the landing and pricing pages; article publishing stays out of scope | P2 |
| 17 | Language switcher | English only | APAC-first languages after the copy settles | P2 |
| 18 | `/features/*` and `/solutions/*` pages | `/best/*`, `/compare/*` | Extend the hub registry once the P0 pages show search impressions | P2 |

What we do not copy: invented "domain authority" without a measured source, unverifiable user counts, scores that blend measured and guessed inputs, and anonymous model calls (spec 0007 rejects anonymous hosted spend).

Where we beat them: AI crawler and llms.txt tooling (ChatSEO has no llms.txt tool and no AI bot switches in its robots.txt generator), evidence labels on every result, real estate depth (agent schema, suburb answers, Enquiry Desk), APAC focus, Telegram and MCP surfaces.

## 4. Phase G1 (this PR: G1a, G1b, G1d)

### G1a. `/compare/chatseo`

One `ComparePage` entry in `services/marketing/seoHubPages.ts`. The registry already feeds the view, crawler HTML, JSON-LD, sitemap and llms.txt. Rows come only from chatseo.app's own pages read on 2026-10-27; no prices in figures (registry rule).

### G1b. Free tools

- Registry `services/marketing/freeTools.ts`: path, label, description, H1, lede, how-to steps, why blocks, FAQ. One source for the view, Worker shell, sitemap and llms.txt, like the hub registry.
- Pure logic in `services/freeTools/` (no DOM, unit tested): SERP pixel widths and truncation, robots.txt builder, llms.txt builder, JSON-LD builder.
- Views in `components/marketing/freeTools/`: one page frame plus one panel per tool, in the space design (`lx-*`), one gold CTA per view.
- Paths: `/free-tools`, `/free-tools/serp-preview`, `/free-tools/robots-txt-generator`, `/free-tools/llms-txt-generator`, `/free-tools/schema-generator`.
- Tools run in the browser. No network calls, no account, no storage. Output is copied, never published.

### G1d. Copy

- Three objection FAQs on the landing (also in FAQPage JSON-LD): how is this different from asking an AI chatbot, does Luminara make up numbers, does it change my website (only if you connect a CMS).
- Footer link "Free tools". Each free tool page ends with the free crawl check CTA.

### G1 acceptance

- Each new path returns its own title, description, canonical, JSON-LD and crawler HTML from the Worker, is in the sitemap and llms.txt, and renders the right view on a cold load. Unknown `/free-tools/*` slugs are Not Found.
- Unit tests for every pure builder, including a cross-check against `evaluateLlmCrawlerReadiness`; route, shell and render tests for every page.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green. Thermo-nuclear review on the branch diff with findings fixed.
- No em dashes in new copy. No new claim that the honesty gates or `tests/claimHonesty.test.ts` reject.
- Design record: `specs/0028-free-tools.md`.

## 4a. G1c (own PR, after G1 lands)

The single biggest activation gap: ChatSEO shows a site its own search snippet before sign-up; our free check shows two file names. It is split out because:

- `docs/plans/conversion-honesty-ship.md` rules that the landing probe never labels a Google or AI engine row Measured and never becomes an HTML proxy. G1c returns parsed head fields only, never page HTML, and labels the snippet "as your page writes it", Measured from the page fetch, with "Google can rewrite it" beside it. Google stays Not measured. That plan's line needs an explicit amendment in the same PR.
- The redirect path in `worker/llmCrawlerRoute.ts` does not re-run `safePublicUrl` or check the port, and `resolvesToPublicAddress` has no timeout. A homepage fetch is a bigger target than three text files, so those gaps close first.

Scope:

1. Harden the shared guard: DNS lookup timeout, default-port-only redirects, `safePublicUrl` on every hop.
2. `probe-crawl` adds one GET of the homepage with `fetchPublicUrl`, a 5 second timeout, a 256 KB cap, `content-type: text/html` only, a `LuminaraProbe/1.0` user agent, and no cookies. It returns `page: { status, finalUrl, title, description, canonical, h1, ogImage, jsonLdTypes, noindex }` or `page: null` with a reason code. Parsing reuses `extractPageSample` (already in the Worker) plus small additions; no new dependency.
3. The landing result renders the snippet with the G1b SERP component and its length checks, and points to the free tools for each failing field.
4. Copy that says the check reads "robots.txt and llms.txt only" (hosted scout rail, FAQ, methodology, hub closing) changes in the same PR, with `tests/playtestHigh14.test.ts` updated.
5. Tests: good page, missing head, non-HTML, oversized body, redirect to another host, redirect to a private address, blocked by a challenge page, DNS timeout.

## 5. Later phases

- **G2 (P1):** items 6 to 11. Needs a spec for the first-run flow (offer prefill, competitor step, GSC step) and a spec for the weekly email.
- **G3 (P2):** items 12 to 18, each gated on the owner decision or the data named in the matrix.

## 6. Owner decisions

1. Cite competitor list prices with a date on a "replace your stack" table, or compare by job only (default: by job only, as the hub rule says).
2. Offer a money-back guarantee on card passes.
3. Pay affiliates in cash or keep referral credits.
4. Show a live "checks run" counter on the landing.

## 7. Review record

To be filled in by the review rounds.
