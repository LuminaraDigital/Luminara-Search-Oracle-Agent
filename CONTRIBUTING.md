# Contributing to Luminara Suite

Thanks for helping. This project is AGPL-3.0 with a commercial license available (see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). To keep that dual-licensing possible, every contribution is accepted under the **Developer Certificate of Origin** plus a **contributor license grant** described below.

## Before you start

- Open an issue first for anything bigger than a bug fix, so we can agree on the approach.
- Check the [roadmap](README.md#roadmap). Features that measure real AI-engine visibility are the priority; new "simulated" panels will not be merged.
- Never commit keys. `.env`, `.dev.vars` and `dist/` are ignored on purpose.

## Development

```bash
npm ci
npm run dev          # Vite at http://localhost:3000, bring your own keys in Settings
npm run cf:dev       # full Cloudflare Worker at http://localhost:8787 (needs .dev.vars)
npm test             # vitest
npm run typecheck    # app + worker
```

## Pull requests

1. Branch from `main`; keep PRs focused.
2. `npm run typecheck && npm test && npm run build` must pass. CI runs the same.
3. Add or update tests for behaviour you change. Pure logic lives in small modules (`services/search/searchIntent.ts`, `services/chat/messages.ts`, `worker/telegramAuth.ts`) precisely so it can be tested.
4. Describe what changed and why. Screenshots for UI.
5. Sign off every commit: `git commit -s`. This adds `Signed-off-by:` and certifies the [DCO](https://developercertificate.org/).

## Contributor license grant

By submitting a contribution you agree that:

- you have the right to submit it under the AGPL-3.0, and
- you grant Luminara Digital Agency a perpetual, worldwide, non-exclusive, royalty-free licence to use, reproduce, modify, distribute and sublicense your contribution as part of Luminara Suite under the AGPL-3.0 **and** under the commercial licence.

You keep your copyright. This is what lets the project stay open while a commercial edition funds the hosted service.

## Code style

- TypeScript strict. No `any` in new code unless you explain it in a comment.
- Model output is untrusted: render through `renderMarkdown()` (DOMPurify), never raw HTML.
- Provider calls go through `providerFetch()` so the Worker proxy and bring-your-own-key relay keep working.
- Label anything simulated as such in the UI. Honesty is a feature.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please do not open public issues for vulnerabilities.
