---
name: luminara-aeo-hub
description: Turn one recording transcript (.vtt/.srt) or one audit into a reviewed AEO hub entry (compare or best-of page data) plus a syndication pack (LinkedIn article, YouTube chapters, email digest). Prepare mode only; a human publishes.
---

# Luminara AEO Hub

One long-form source seeds the site and every channel. Output is drafts for review. Never publish, push, or send on your own.

## Inputs

- A transcript file (`.vtt` or `.srt`) and the video URL or ID, **or** a saved audit report id.
- The target page: an existing `/compare/<tool>` or `/best/<topic>` path, or a proposed new one.

## Steps

1. **Context.** `get_project_context`, then check the research log for the last 30 days. Reuse saved competitor notes. Paid MCP tools only when entitled.
2. **Parse the transcript.** Drop timestamps, speaker tags, and filler words. Extract: the core thesis, frameworks, named tools, the questions answered, and quotable lines with their timestamps.
3. **Verify every competitor claim** on the vendor's own product, pricing, or docs page. Record the URL. Unverifiable claims are cut, not softened. No competitor scores. No price figures (vendors change them; say "monthly subscription with public tiers").
4. **Draft the hub entry** as a `ComparePage` or `BestPage` object for `services/marketing/seoHubPages.ts`:
   - `verdict`: exactly two sentences, 70 words or fewer, "Choose X if... Choose Luminara Suite if...".
   - Compare: 5 to 8 `rows`, plus honest `chooseThem` and `chooseUs` lists.
   - Best: `picks` with best-for, ICP, pros, cons, pricing model, and the shared methodology.
   - 3 `faq` items phrased the way buyers ask ("Is X cheaper than Y?").
   - `sources` with the URLs from step 3.
   Adding the object is the whole change: route, crawler HTML, FAQPage and ItemList JSON-LD, sitemap, and llms.txt all derive from it. Then run `npm test -- tests/seoHubPages.test.ts` and sync `public/llms.txt`, `public/robots.txt`, `public/sitemap.xml` from `worker/crawlDocuments.ts`.
5. **Syndication pack** (return as markdown in the report, do not post):
   - **LinkedIn article:** first person, 600 to 900 words, links to the hub page and the free crawl check.
   - **YouTube description:** chapters from transcript inflection points (`00:00 Intro`), every tool mentioned with its link, the hub page link.
   - **Email or Telegram digest:** subject line, three actionable steps, one link.
6. **Deliver** via `luminara-report`: verdict, the one action ("review and merge the hub entry"), and the report link.

## Honesty rules

- Luminara rows use the shared copy: labeled Measured, Estimated, Not measured; live answers from specific AI products stay Not measured unless Agency or the caller's own search login.
- Never invent metrics, customer counts, or results. Missing data is `not_measured` or `unknown`.
- No em dashes. Apply deslop to all prose.
- One topic per page. If a page would only swap the competitor name, do not create it.
