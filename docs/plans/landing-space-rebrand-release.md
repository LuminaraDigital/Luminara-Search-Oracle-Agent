# Landing space rebrand: release plan

**Status:** CEO gate round 2 returned GO WITH CONDITIONS for `staging` and NO-GO for `main` until B1-B4 close. B1-B3 are fixed in this branch. B4 is an owner dashboard check (precondition 1). Round 3 re-gates the fixes.
**Scope:** PR #131 (landing, now based on `staging`), PR #140 (inner marketing pages, stacked on #131), and PR #126 underneath #131.
**Owner action required:** every merge in this plan is the owner's. Claude prepares and verifies but does not merge or push to `staging` or `main`.

## What ships in the next `staging` → `main` release

1. **This rebrand (#131 + #140):**
   - The space landing: sunrise globe hero with an inline live crawl check, statement, four-chapter globe story, illustrative report, value props, FAQ and closing horizon.
   - New nav and footer, and a starfield on the inner pages.
   - Inner pages restyled: Pricing, Why, How it works, AI, Methodology, Sample report.
   - Restyled sign-up modal and paywall chrome.
   - A new `og-image.png`, rendered from the real hero.
   - Removed: the old landing modules, the Canvas2D earth and its bake, the constellation pipeline.
   - The globe is one raw WebGL shader (6.7 KB gzip, lazy) with a CSS fallback.
   - No migrations, secrets or dependencies.
2. **PR #126 (inside #131), backend scope the owner must sign off:**
   - The Oracle 3-plane session harness (`oracleSession.ts`, `oracleChat.ts`).
   - MCP caps and a narrowed CSP `script-src` (`worker/security.ts`).
   - Lint added to both deploy jobs.
   - Production `REQUIRE_APP_CHECK` moves from **true to false**.
   - Hosted DataForSEO is limited to the **Agency** plan (`hasPlanForHostedProvider`). Paying Starter or Growth customers lose hosted DataForSEO measurement, and ChatGPT and Perplexity rows fall back to estimates. This is a visible downgrade and needs an explicit decision.
3. **Already on `staging` and waiting for release:** #125, #129, #130, #132, #133, #134, #135, #136.

## Preconditions (owner)

1. **Cloudflare Workers Builds (hard gate, B4).** Both Workers (`luminara-search-oracle-agent`, `luminara-search`) build every branch, and branch builds upload versions to the production script.
   - In Workers → each Worker → Settings → Builds, set non-production branches to version upload only, and switch the production-branch deploy off (or confirm it runs `deploy --env production`).
   - Turn **preview URLs off** for the production script: previews of PR branches run with production bindings (D1, KV, secrets).
   - Without this, a push to `main` can redeploy production with the top-level config, which skips the release gate, migration ordering and smoke.
2. **Sign off #126:**
   - the `REQUIRE_APP_CHECK` change;
   - the DataForSEO-to-Agency change;
   - the Oracle and MCP backend scope.

   Confirm `MCP_OAUTH_SECRET` is set in production with `npx wrangler secret list --env production`.
3. **Hold every open non-draft PR outside this plan** until the release is out:
   - Dependabot #109, #110, #111, #112, #113, #114;
   - #137.

   You bulk-merge non-draft PRs, so any of them merged now would ride this release.
4. **Close superseded landing PRs.** This is your call, since other agents authored them.
   - #124's commits are already inside #131, so GitHub marks it merged when #131 lands.
   - #127 and #128 target `main` directly, CI blocks them, and they conflict with #131.
5. **No release PR is open:** `gh pr list --base main --head staging` returns nothing.

## Sequence

Run steps 1 to 3 in one sitting. Do not open a release PR between them: merging #126 on its own would briefly put its intermediate satellite-globe landing on `staging`.

1. **#140 into the landing branch.** Once #140 is green, mark it ready and merge it into `feat/landing-space-rebrand` with a merge commit.
2. **#131 into `staging`.**
   - Update from `staging` if it is behind.
   - Wait for the pull-request CI ("Build, Test & Smoke Validation") to go green.
   - Mark ready and merge with a merge commit.
   - #131 contains #126's head (9456901) and #124's head (1cc23f0), so GitHub marks both merged. Close #126 separately only if it stays open.
3. **Staging deploy.** CI runs tests, build, migrations (no-op) and smoke. Then work through the checklist below on `https://staging.luminarasuite.com`.
4. **Record the Lighthouse baseline for production now.** The gate is no regression against it. The landing already preloads about 600 KB gzip of JS (index, TON Connect, genai, Firebase, markdown, telegram), so LCP under 2.5 s is not reachable from this PR alone.
5. **Release PR `staging` → `main`, merged with a merge commit.**
   - Before merging, record the production version with `npx wrangler deployments list --env production`.
   - The production job runs the release-shape check, the green-staging check, tests, build, migrate, deploy and smoke.
6. **Verify production.**
   - The `https://www.luminarasuite.com/?cb=<ts>` bundle contains "Be the answer".
   - `/api/health?cb=<ts>` returns `ok:true`.
   - Visual checks pass at 1440 and 375.
   - Sign-in works.
7. **Merge `main` back into `staging`** with a PR and a merge commit.

## Staging validation checklist

- **Hero:** serif headline, gold globe horizon, one input; no console errors or CSP violations.
- **DomainCheck:**
  - `example.com` shows only "Crawl access" as Checking; the four engines read Not measured from the first frame and stay that way.
  - The crawl note appears.
  - "Run the full audit, free" opens the restyled modal titled "Create your free account", with focus in the email field.
- **Sign-up, end to end:**
  - Real email and Google sign-up both work under the new CSP and App Check setting.
  - After sign-up the user lands in Instant Audit with the domain prefilled, and a free audit completes.
- **Pricing:** Subscribe opens the restyled paywall. Stars, TON and card options render as before.
- **Product smoke:**
  - one Oracle chat turn;
  - MCP `tools/list` with a Growth key;
  - Telegram Mini App boots and signs in.
- **Scroll story:** the globe pulls back behind the statement, then moves through four chapters, and the active chapter highlights. At 1024-1040px with a classic scrollbar the globe stays clear of the copy.
- **Reduced motion** (OS setting): the headline keeps two lines, with no entrance animation, spin or comets, and still poses per section.
- **Fallback:** with WebGL disabled (`chrome --disable-webgl`) or Save-Data on, the CSS planet and stars show and the copy is intact.
- **Mobile:** at 375x812, no horizontal overflow; the globe sits above the chapter cards; the menu locks scrolling and Escape returns focus.
- **Inner pages:** facts and prices are unchanged.
- **Real devices:** Safari on iOS and Chrome on Android; the globe renders and scrolling stays smooth.
- **Lighthouse (mobile):** CLS 0, and no regression against the baseline from step 4.

## Rollback

- Run `npx wrangler rollback --env production` to the version recorded in step 5. Assets are part of the Worker version, so the frontend reverts with it.
- The previous version has `REQUIRE_APP_CHECK=true`, and production builds get no `VITE_*` env (`deploy-cloudflare.yml`). **Re-test sign-in after any rollback.**
- The runbook (`docs/runbooks/d1-backup-dr.md`) notes rollback is untested with crons and queues.
- The next push to `main`, or a Workers Builds deploy (precondition 1), overwrites a rollback. Revert on `staging` and release again for a lasting fix.

## Decisions taken and follow-ups (dated 2026-10-17)

- **`telegram-web-app.js` on the public landing:** deferred deliberately. Loading it only inside Telegram changes the Mini App boot path (see `tests/tmaLoginGate.test.ts`), so it needs its own change and a TMA device test. Owner to accept the deferral or ask for it before `main`.
- **Lazy-load the off-landing chunks** (TON Connect, genai, Firebase, markdown, telegram). This is the biggest conversion and LCP lever left. Follow-up PR.
- **Old styles still reachable from the landing:**
  - `/docs/mcp.html` and `/docs/what-is-aeo.html` (static pages);
  - `LegalPage`;
  - `NotFoundPage`;
  - `TelegramAccountPanel` on /pricing;
  - `TelegramBottomNav` (Mini App).

  Restyle them in a follow-up PR.
- **Pricing copy:** it keeps "Sample scouts" as plan facts. Its owner should review that wording against the new landing language.

## Review record

| Round | Reviewers | Outcome |
|---|---|---|
| 1 | Code quality (ponytail-review, thermo-nuclear, pstack), frontend/SEO/a11y, WebGL/performance, deploy/CI | 2 blockers, about 15 should-fix and several nits. All fixed in 27f11f4. Staging merged in bbcde99. |
| 2a | Fix verifier | 15 of 15 FIXED, with minor leftovers: stale constellation references in docs and `.gitignore`, methodology and sample-report meta copy, print opacity, the WebGL context on highp failure, anchor ref churn. All fixed in the round 2 commit. |
| 2b | CEO gate | `staging`: GO WITH CONDITIONS. `main`: NO-GO until:<br>B1 (the hero check acted out engine work);<br>B2 (the closing CTA overclaimed);<br>B3 (the sign-up modal and paywall were the old design);<br>B4 (Workers Builds).<br>B1-B3 fixed in the round 2 commit. B4 is precondition 1. Conditions C1-C8 are folded into this plan. |
| 3 | CEO re-gate | Pending |
