# 0027: AEO hub pages (/compare and /best)

## What

Comparison pages (`/compare/<tool>`) and buyer's guides (`/best/<topic>`) built from one typed data module, `services/marketing/seoHubPages.ts`. Each entry drives:

- the React view (`components/marketing/SeoHubPage.tsx`, `AppView.COMPARE`),
- the Worker crawler HTML and per-path meta (`MARKETING_SHELL_BY_PATH`),
- JSON-LD: a page-scoped `FAQPage`, plus an `ItemList` on buyer's guides,
- `sitemap.xml`, `robots.txt` (`Allow: /best/`), and `llms.txt`.

Page anatomy follows what answer engines lift: a two-sentence verdict first, a 5 to 8 row matrix or ranked picks, honest "when to choose them" and "when to choose us" sections, a methodology block, three buyer-phrased questions, and dated sources.

The `luminara-aeo-hub` plugin skill turns a transcript or an audit into a draft entry plus a syndication pack (LinkedIn, YouTube chapters, email digest). It runs in Prepare mode. A human reviews and merges.

In the app, `comparisonOutlineDraft` (`services/audit/fixPackCopy.ts`) generates the same Prepare-mode `/compare/<brand>-vs-<competitor>` markdown and `FAQPage` JSON-LD outline for a customer's own domain (included in the Weekly Decision Card fix pack and on comparison or citation-gap findings in `ActionableFixList`). Competitor cells use explicit `<Verify ...>` placeholders so no rival claim is invented.

## Why

Buyers ask answer engines comparative and "best tool for" questions. The previous `/compare/*` URLs served the competitor tables only inside `<noscript>`, rendered the generic `/why` page to people, and had no FAQ schema. Some competitor rows were also unsourced or wrong (for example, that a vendor had no API). Rows now come only from each vendor's public pages as of the review date.

## Invariants

- Adding a page is a data change only. Routing, meta, schema, sitemap, and llms.txt derive from the entry.
- Competitor claims cite the vendor's own pages. No competitor scores, no price figures, no unsourced negatives.
- Luminara rows carry the measurement limit (`LIVE_ANSWER_CHECKS`) wherever coverage is claimed.
- Verdicts are two sentences and at most 70 words. Tab titles stay at or under 60 characters.
- Unknown `/compare/*` or `/best/*` slugs are Not Found, not a soft redirect.
- `public/llms.txt`, `public/robots.txt`, and `public/sitemap.xml` match the Worker constants (tests enforce it).

## Alternatives considered

- **MDX blog pipeline.** Rejected for now: a new build dependency and content system for seven pages. The data module covers the need.
- **Programmatic pages at scale.** Rejected: scaled near-duplicate pages risk Google's scaled content abuse policy. Each page must stand on its own.
- **Auto-publish from the skill.** Rejected: competitor claims need a human check against the source before merge.
