# 0029: Homepage snippet in the free check, and shareable checks

## What

The anonymous free check (`GET /api/visibility/probe-crawl`) reads the visitor's homepage once, beside robots.txt, llms.txt and ai.txt, and returns parsed head fields: title, meta description, JSON-LD `@type` names, and noindex (robots meta or `X-Robots-Tag`, matched as whole directives for every crawler or Googlebot). The landing shows them as "What your homepage tells Google": the fields Measured as page facts with their read time, an Estimated preview of the Google result they make, then one line per field with the free tool that writes the fix (`services/marketing/homepageSnippet.ts`).

`/check/<host>` opens the landing with the check already running on that host, so a result can be shared. The result has a "Copy link to this check" button.

## Why

A competitor shows a site its own search snippet in its first screen; our free check showed two file names. The snippet is the clearest first value we can give without an account or a model call.

## Invariants

- The response carries parsed fields only, never page HTML. Each text field is capped at 300 characters. Comments are ignored, and title and meta are read from the `<head>` only.
- The fields are page facts, labeled "Measured · read from your homepage at <time>". The Google-style card and its length verdicts ("Should fit", "Short") are labeled Estimated, with "We did not check Google" beside them. Google and AI engine rows stay Not measured. This amends `docs/plans/conversion-honesty-ship.md` (dated amendment there).
- Parsing is linear in the page size (no regex that can backtrack across a 256 KB hostile page), with a test.
- The homepage fetch uses `fetchPublicUrl` with `defaultPortFetcher`: public host and default port on every hop, DNS lookups capped at 3 seconds each that fail closed when either the A or AAAA lookup fails, 5 seconds for the page read including the body, 256 KB, HTML only, a `LuminaraProbe/1.0` user agent, no cookies.
- The input is parsed once with `safePublicUrl`; that host is used for every read, the cache key and the reply.
- The crawl-file fetch re-runs `safePublicUrl` on every redirect hop and refuses non-default ports.
- A failed read returns `page: null` and one coarse `pageReason` (`unreachable`, `blocked`, `http_error`, `not_html`), never a raw error. A bot-wall page (known firewall markers, or noindex with no title and no description) counts as `blocked`, never as the owner's noindex. A crawl file whose fetch failed is Not measured, never "missing". The Worker logs the outcome only, never the host.
- This Worker's own homepage is parsed from the page it serves (assets plus the same meta injection), because a fetch of its own Custom Domain returns 522.
- Results are cached per serving host, scheme and target host. A successful read is cached for 2 minutes per Cloudflare location. A site that turned the check away (blocked, or an error answer) is cached for 30 seconds, so a shared link to it is not refetched on every view. An unreachable read is not cached. A widely shared `/check/` link therefore reads the site at most once per Cloudflare location every 2 minutes (30 seconds for a walled site). The per-IP rate limit is unchanged.
- `/check/<host>` pages are `noindex, nofollow`, their meta is built from the validated host, and an invalid host is Not Found. The path is cleared when the visitor moves to another view.

## Alternatives considered

- **Render the page in a headless browser.** Rejected: cost, latency, and a much larger attack surface for an anonymous endpoint.
- **Let a model describe the business, as the competitor does.** Rejected for guests: `specs/0007-guest-scout-and-teaser.md` rules out anonymous hosted spend. A signed-in version is planned (gap plan item 6).
- **Index `/check/` pages for search.** Rejected: one page per typed host is thin, near-duplicate content.
