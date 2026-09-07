---
name: luminara-seo
description: How to use the vendored claude-seo skills (seo, seo-audit, seo-technical, seo-content, seo-schema, seo-geo, seo-local, seo-ecommerce, ...) inside the Luminara Suite repo. Use when working on SEO/AEO/GEO methodology, the audit prompts, the compiled playbooks, or when a user asks for an SEO audit of a site from this project.
user-invocable: true
argument-hint: "[command] [url]"
---

# Luminara SEO (project wrapper around claude-seo)

The SEO skills in `.claude/skills/seo*` are vendored from
[AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) (MIT, v2.2.5).
They are the methodology source of truth for this product. Two things differ here:

## 1. No bundled Python runtime

Upstream expects `claude-seo run <script.py>`. This repo does not ship that runtime.
When a skill says to run a script, substitute:

| Upstream | Here |
|---|---|
| `fetch_page.py`, `render_page.py`, `parse_html.py` | `WebFetch` the URL (and `/robots.txt`, `/sitemap.xml`, `/llms.txt`) |
| `pagespeed_check.py` | `WebFetch https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<url>&strategy=mobile` (no key needed for light use) |
| `schema_generate.py` | write JSON-LD by hand using `seo-schema` templates and `.claude/skills/seo/data/templates.json` |
| Firecrawl / DataForSEO MCP | not available; say so and continue with what `WebFetch` gives |

Never invent numbers a script would have produced. If a measurement is unavailable, mark it "not measured".

## 2. The app consumes the same methodology

`scripts/build-playbooks.mjs` compiles the skill markdown into
`services/skills/playbooks.generated.json`, which `services/skills/seoPlaybooks.ts` injects into
audit and chat prompts by focus (SEO / AEO / GEO) and lens (local, ecommerce, schema, ...).

- Edit methodology in the skill files, then run `npm run playbooks` and commit the JSON.
- Keep the app's prompt budget in mind: each playbook is capped in the build script.
- Product rules that override upstream: no community footer in app output; label estimates;
  say "not verified" when evidence is missing; assume the reader is a business owner.

## Running an audit from this repo

`/luminara-seo audit <url>` → follow `seo-audit` with the substitutions above, then present
the result as the app does: SEO Health Score (0-100), Critical / High / Medium / Low, and
for every recommendation the observation it rests on, the "how would we know this failed?"
check, and a leading indicator. Skip the upstream community footer.
