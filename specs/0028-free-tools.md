# 0028: Free tools (/free-tools)

## What

Four public tools, plus a hub page, built from one typed data module, `services/marketing/freeTools.ts`:

- SERP snippet preview: estimated pixel widths and truncation for a title and description.
- Robots.txt generator with one switch per AI crawler, using the crawler list the audit checks (`LLM_CRAWLER_BOTS`) plus common training-only crawlers.
- llms.txt generator in the llmstxt.org layout.
- Schema generator for `RealEstateAgent` or `LocalBusiness`, with suburbs served and an optional `FAQPage`.

Each entry drives the React view (`components/marketing/freeTools/`, `AppView.FREE_TOOLS`), the Worker crawler HTML and per-path meta (`MARKETING_SHELL_BY_PATH`), JSON-LD (`WebApplication` plus a page-scoped `FAQPage`; the hub gets an `ItemList`), `sitemap.xml`, and `llms.txt`. The builders live in `services/freeTools/` as pure functions with no DOM.

## Why

Competitors win sign-ups with free single-job tools that rank for their own searches and hand off to the paid product. Ours lean into what Luminara is about: AI crawler access, llms.txt, and real estate schema. The robots.txt and llms.txt output passes Luminara's own crawler readiness check (`evaluateLlmCrawlerReadiness`), and tests hold that.

## Invariants

- Tools run in the browser. No network call, no account, no storage. The only event sent is `free_tool_copied` with the tool id, never the text.
- A builder writes only what the user typed. The schema generator never adds ratings or reviews. A link that is not http(s) is dropped, never re-prefixed (`toHttpUrl`).
- The SERP preview is labeled an estimate. Google can rewrite titles and snippets.
- Unknown `/free-tools/*` slugs are Not Found.
- `public/llms.txt` and `public/sitemap.xml` match the Worker constants.

## Alternatives considered

- **Join the hub registry (`seoHubPages.ts`).** Rejected: hub entries require a verdict, sources, and a comparison body that a tool page does not have.
- **Server-side checks (fetch a URL and grade it).** Deferred: an anonymous fetch of arbitrary HTML widens the probe's attack surface and needs its own spec (see `docs/plans/chatseo-competitive-gap.md`, G1c).
- **Ten tools at once, like the competitor.** Rejected: four that fit the product, each standing on its own, over thin pages at scale.
