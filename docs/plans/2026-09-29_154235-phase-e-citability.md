# Phase E: Citability (expand #15 thin cut)

**Date:** 2026-09-29
**Repo:** LuminaraDigital/Luminara-Search-Oracle-Agent
**Branch target:** `cursor/phase-e-citability-<short>` off `main` @ `b62bde5`+
**Status:** Accepted. Implementation is the Phase E PR. Do not merge without a separate operator yes.
**Depends on:** Phase 1 thin citability live (`public/llms.txt`, `robots.txt`, Instant Audit LLM crawler probe, teasers). Phase 4 remains HOLD.

## Goal

Make Luminara Suite itself more citeable by LLM crawlers and AI search, and deepen the Instant Audit crawler lens, without inventing scores or breaking honesty.

## Context (already shipped)

- Thin `public/llms.txt` (honesty + pricing + MCP + TMA links)
- Explicit AI-bot allows in `public/robots.txt` (incl. `/share/teaser/`, disallow full share/API)
- Instant Audit LLM crawler readiness: pass / fail / `not_measured` for `llms.txt` + common bot directives (`worker/llmCrawlerRoute.ts`, spec 0007)
- Marketing routes: home, how-it-works, ai, why, pricing, desktop, docs, privacy, terms

## Approach (one PR recommended)

### E1: Expand suite-as-product citability surfaces
1. Expand `public/llms.txt` with: short methodology blurb, link to a new "What is AEO?" page, link to honesty glossary (`measured` / `estimated` / `not_measured`), sitemap pointer, canonical product facts only (no invented metrics).
2. Add citability marketing pages (static or existing SPA routes, match house style):
   - `/what-is-aeo` (or `/docs/what-is-aeo`) : definition, how Suite measures, honesty rules, citeable FAQ
   - Optional `/methodology` thin page if not duplicative of how-it-works
3. Sync `public/sitemap.xml` + `robots.txt` Allow lines for any new public paths.
4. Suite-as-client GEO checklist: internal doc or Dashboard / Instant Audit checklist card listing Suite's own crawlable assets (llms, robots, sitemap, FAQ, entity pages). Checklist items stay `not_measured` until probed.

### E2: Deeper LLM-crawler lens in Instant Audit
1. Beyond thin presence probe: check for common AI user-agents in robots, `llms.txt` section structure (H1/title + product summary), blocking directives that would hide marketing paths, optional `ai.txt` / known alternates if low-cost.
2. UI: expand GuestScout / trust panel crawler section with labelled pass/fail/`not_measured` rows. Still not a 0-100 score (spec 0007 invariant).
3. Tests: unit coverage for new probe outcomes; no invented percentages.

### E3: Ops / verification
1. CI + existing secrets/env gates green.
2. Manual: curl live `/llms.txt`, `/robots.txt`, new page, sitemap URLs after deploy.
3. Optional: note for suite-as-client GEO checklist in `docs/` or Worker README.

## Critical files (expected)

- `public/llms.txt`, `public/robots.txt`, `public/sitemap.xml`
- New page(s) under `public/` or SPA routes + nav links
- `worker/llmCrawlerRoute.ts` (+ any client panel that renders crawler results)
- `specs/0011-citability.md` (or extend 0007). Accepted once operator yes
- `tests/` for crawler probe + sitemap/llms consistency if practical
- `docs/plans/2026-09-29_154235-phase-e-citability.md` (this file, in PR)

## Out of scope

- Phase 4 social (CEO HOLD)
- Phase M / D (separate PRs)
- Scoring LLM readiness out of 100
- Invented citation rates / SERP theater for Suite or clients
- Ahrefs / IdeaBrowser depth
- Merge / production deploy without separate operator yes (main auto-deploys)

## Success checks

- New citability pages + expanded `llms.txt` are crawl-allowed and in sitemap
- Instant Audit crawler lens is richer but still pass/fail/`not_measured`
- Honesty copy unchanged in spirit; no measured badges without evidence
- CI green on the PR

## Risks / open questions

1. SPA vs static HTML for "What is AEO?": prefer whatever existing docs/how-it-works pattern uses so crawlers get real content (static or SSR-friendly).
2. How deep to parse foreign `llms.txt` (structure vs presence only)? Default: structure hints + presence, still no score.
3. Include `/share/teaser/` guidance in methodology for agents citing Suite? Yes, brief, already robots-allowed.

## Implementation notes

- The page is static `public/docs/what-is-aeo.html`, matching `public/docs/mcp.html`. Methodology stays on that page so it does not duplicate how-it-works.
- The Suite GEO checklist sits on Instant Audit. Rows stay `not_measured` until a probe status is passed in. The card does not self-score from repo files.
- Optional `ai.txt` is one extra root fetch. A completed 404 is fail (file not found), not a readiness score. Fetch errors stay `not_measured`.
