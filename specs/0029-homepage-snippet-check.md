# 0029: Homepage snippet in the free check, and shareable checks

## What

The anonymous free check (`GET /api/visibility/probe-crawl`) reads the visitor's homepage once, beside robots.txt, llms.txt and ai.txt, and returns parsed head fields: title, meta description, canonical, first H1, whether an og:image is set, JSON-LD `@type` names, and noindex (robots meta or `X-Robots-Tag`). The landing shows them as "Your homepage in search": an estimated Google result built from those tags, then one line per field with the free tool that fixes each gap (`services/marketing/homepageSnippet.ts`).

`/check/<host>` opens the landing with the check already running on that host, so a result can be shared. The result has a "Copy link to this check" button.

## Why

A competitor shows a site its own search snippet in its first screen; our free check showed two file names. The snippet is the clearest first value we can give without an account or a model call.

## Invariants

- The response carries parsed fields only, never page HTML or the og:image itself. Each field is capped at 300 characters.
- The fields are page facts, labeled "Read from your homepage", with "Google can rewrite titles and snippets" beside them. Google and AI engine rows stay Not measured. This amends `docs/plans/conversion-honesty-ship.md` (dated amendment there).
- The homepage fetch uses `fetchPublicUrl` with `defaultPortFetcher`: public host and default port on every hop, DNS lookups time out after 3 seconds and fail closed, 5 seconds for the whole read including the body, 256 KB, HTML only, a `LuminaraProbe/1.0` user agent, no cookies.
- The crawl-file fetch re-runs `safePublicUrl` on every redirect hop and refuses non-default ports.
- A failed read returns `page: null` and one coarse `pageReason` (`unreachable`, `blocked`, `http_error`, `not_html`), never a raw error. The Worker logs the outcome only, never the host.
- This Worker's own homepage is read from its meta registry, because a fetch of its own Custom Domain returns 522.
- One host's result is cached for 2 minutes, so a widely shared `/check/` link cannot hammer the site it checks. The per-IP rate limit is unchanged.
- `/check/<host>` pages are `noindex, nofollow`; an invalid host is Not Found.

## Alternatives considered

- **Render the page in a headless browser.** Rejected: cost, latency, and a much larger attack surface for an anonymous endpoint.
- **Let a model describe the business, as the competitor does.** Rejected for guests: `specs/0007-guest-scout-and-teaser.md` rules out anonymous hosted spend. A signed-in version is planned (gap plan item 6).
- **Index `/check/` pages for search.** Rejected: one page per typed host is thin, near-duplicate content.
