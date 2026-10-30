# Release checklist (`staging` to `main`)

Copy this into each release PR and tick it there. Agents follow the rule in `AGENTS.md` ("Releases"): they never open, mark ready or merge a PR into `main`. The mechanics of the production workflow, migration rollback and Worker rollback are in `docs/runbooks/d1-backup-dr.md`.

## Before the merge

1. Workers Builds is disconnected from Git on `luminara-search-oracle-agent`, `luminara-search-oracle-agent-staging` and `luminara-search` (owner decision 1a), so only CI deploys production. The top-level `wrangler.jsonc` config holds production bindings, so a bare `wrangler deploy` would ship a branch to production.
2. No agent is promoting `staging`: `gh pr list --base main --head staging` shows only this release, and every other open PR is a draft (`gh pr list --state open --json number,isDraft`).
3. The release holds only what it says: `git log --first-parent origin/main..origin/staging` lists the intended merges, `git diff --stat origin/staging...origin/main` is empty, and every migration in the diff is named in the PR.
4. CI on the release PR has no failing or pending checks (the production-only jobs show as skipped), and the merged commit has a green staging deploy (the two `check-staging-deploy.mjs` lines in `deploy-cloudflare.yml`).
5. Production reads (owner): `npx wrangler deployments list --env production` (note the active version ID); `npx wrangler d1 migrations list luminara-users --remote --env production` (only this release's migrations pending); the licence-key count ("Licence key count, before and after" in `d1-backup-dr.md`); cache-busted `/api/health` and its `stripeCheckout`; Telegram `getWebhookInfo` as a baseline; any data counts the release's migrations change.
6. Staging click-tests on real accounts and devices for every surface the release touches: web sign-in, sign-out and account switch; paid features after an audit; the Telegram Mini App on iOS, Android, Desktop, macOS and web; the payment rails the release touches (TON testnet, Stars, Stripe test mode, licence keys); the bot; the Oracle; a real MCP client on staging `/mcp`; a packaged desktop build against staging if `electron/` changed.

## The merge (owner)

7. Mark the release PR ready and merge it with a merge commit pinned to the reviewed head: `gh pr merge <n> --merge --match-head-commit <sha>`. Leave `staging` alone until production is green.
8. The production run is done when it is green, its log shows the Time Travel bookmark, the migrations applied and `[SmokeCheck] [SUCCESS]`, and the dashboard's active version matches the log's version ID.

## After the deploy

9. Cache-busted `/api/health` is `ok` and `stripeCheckout` matches item 5 (a mismatch means something other than CI deployed); unsigned `/api/findings` is 401.
10. Repeat item 5's data counts; follow any recount step the release names.
11. `npx wrangler tail --env production` for 30 minutes: no spike in the release's new log events or in 5xx.
12. While the Android app is in Play review: the Play-review build on production with a test account (sign-up, sign-in, audit, findings, export, delete account).
13. Telegram `getWebhookInfo` against item 5's baseline; menu button and BotFather Mini App URL on `https://www.luminarasuite.com/`; Stripe webhook deliveries 2xx; the licence-key count equals item 5.
14. Merge `main` back into `staging` with a merge commit, then mark held PRs ready one at a time, each only while no release PR is open and each followed by a green staging deploy.

## Rollback

- A failure before "Apply D1 migrations" leaves production unchanged; fix and re-run.
- A failure after migrating: the previous Worker runs on the migrated database; re-run the failed jobs. A re-run prints a post-migration bookmark; the first attempt's bookmark is the pre-migration one.
- Bad behaviour after deploy: `npx wrangler rollback <item 5 version ID> --env production -y`, picked by ID (the version list can also hold uploads that never served).
- A D1 Time Travel restore is not a rollback: see "Time Travel" in `d1-backup-dr.md` for why and for the reconciliation it needs.
- The desktop app cannot be rolled back once tagged (electron-updater does not downgrade); click-test the packaged build from the exact tag commit before tagging, and never push a bare `v*.*.*` tag (it fires the Android release).
