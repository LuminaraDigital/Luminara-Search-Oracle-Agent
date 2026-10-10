# D1 backup and disaster recovery (Luminara)

**Owner:** deploy operator  
**RPO target:** 24 hours (daily export) + Cloudflare Time Travel (~30 days)  
**RTO target:** 2 hours for staging restore drill; 4 hours for production with CEO approval

Do not rely on Time Travel alone. Keep independent exports.

## Inventory

| Resource | Binding / name | Env |
|---|---|---|
| Prod D1 | `luminara-users` / `DB` | production |
| Staging D1 | `luminara-users-staging` | staging |
| Optional R2 backup prefix | `d1-backups/` on `DESKTOP_RELEASES` or dedicated bucket | both |

## Daily export (operator or CI cron)

```bash
# Staging
npm run db:backup:staging

# Production (requires prod Cloudflare token + confirmation env)
CONFIRM_PROD_BACKUP=1 npm run db:backup:prod
```

`scripts/d1-backup.mjs` runs `wrangler d1 export`, writes a timestamped `.sql` under `artifacts/d1-backups/`, and prints the checksum. Upload that file to R2 or offline vault the same day.

## Time Travel (short-term)

```bash
npx wrangler d1 time-travel info luminara-users --env production
# Restore ONLY into an isolated clone DB first, never straight over prod without CEO yes.
```

Every deploy records its own restore point. In `.github/workflows/deploy-cloudflare.yml` the step "Print D1 Time Travel bookmark before migrating" runs the command above (for `luminara-users-staging` on staging) immediately before "Apply D1 migrations", so the log of each deploy run holds the bookmark from just before its migration. If that step fails, the job stops and nothing is migrated or deployed. The command form was read from the help of the wrangler version this repo installs (4.145.0). The step had not yet run in CI when this was written: confirm on the first staging deploy that the log shows a line starting "The current bookmark is".

## Weekly restore drill

1. Create or reuse `luminara-users-restore-drill`.
2. Import last daily `.sql` (or Time Travel bookmark) into the drill DB.
3. Run validation queries below.
4. Record pass/fail in the incident channel; delete drill DB if cost matters.

### Validation queries

```sql
SELECT COUNT(*) AS users FROM users;
SELECT COUNT(*) AS workspaces FROM user_workspace;
SELECT COUNT(*) AS projects FROM projects;
SELECT COUNT(*) AS decisions FROM weekly_decisions;
SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;
```

## Migration rollback

1. Stop promotion: do not deploy a Worker that requires newer tables onto an unmigrated DB.
2. CI order is **bookmark → migrate → deploy → smoke**. If the bookmark cannot be printed, migrate must not run. If migrate fails, deploy must not run.
3. Forward-fix: add a new migration; do not rewrite applied files.
4. If a bad migration landed: restore from daily export into a clone, fix SQL, re-apply on a fresh clone, then cut over with CEO approval.

## Worker rollback

```bash
npx wrangler deployments list --env production
npx wrangler rollback --env production
```

Then re-run `npm run smoke:prod`.

> **NOT YET TESTED ON STAGING (plan task SW0a-13, operator step).** Nobody has yet checked what `wrangler rollback` does to cron triggers. The open question: when the newer version added a cron trigger, does a rollback to the older version remove that trigger, or leave it firing against the older code? Until an operator has read Cloudflare's documentation on it and tried it on staging, assume the newer triggers stay. To test: deploy a staging version that adds a second cron to `wrangler.jsonc` and `CRON_JOBS`, run `npx wrangler rollback --env staging`, then look at the Worker's triggers in the dashboard and at the logs when the new cron's time comes. Replace this note with what was seen, and move the rollback line in the plan (`docs/plans/founder-swarm-business-brain-additive-plan.md`, section 1.3 to 1.1).

What the code does in the meantime, whichever way that test comes out:

- A cron expression with no entry in `CRON_JOBS` (`worker/scheduledJobs.ts`) runs **no job**. The Worker logs `[Cron] Cron "<expression>" is not mapped in worker/scheduledJobs.ts; no job was run.` as an error. So an older version that is fired by a newer trigger does nothing on the new cadence. After a rollback, search the logs for `[Cron]` to see whether that is happening.
- A queue batch from a queue with no entry in `worker/queueDispatch.ts` is acknowledged and not processed, and logged as `[Queue] Queue "<name>" is not mapped ...`. Those messages are gone once acknowledged, so a rollback across a release that added a queue consumer needs that queue drained or paused first.
- A rollback restores code only. It does not undo a D1 migration (see "Migration rollback" above and the bookmark in the deploy log).

Both of those are log lines and nothing else. Nothing pages or messages anyone when one appears: someone has to look at the Worker's logs.

## Production release (staging to main)

Production runs only what staging ran, and only what staging deployed green. Before anything is installed, migrated or deployed, the production job runs two checks and stops if either fails:

- **Release check** (`scripts/check-release-merge.mjs`). The commit on `main` must be (a) a merge commit with exactly two parents, (b) with the same files as its second parent, (c) whose second parent is a commit `staging` itself was at (on the first-parent line of `origin/staging`, not a feature commit that staging merged), and (d) the current tip of `main`. A failed step names the condition and says what to do.
- **Staging deploy check** (`scripts/check-staging-deploy.mjs`). The deploy workflow's run for the push of that second parent to `staging` must have completed with success, and so must its staging deploy job. A re-run counts as its latest attempt. A staging deploy started by hand does not count.

The steps, in order:

1. See that staging's deploy of its tip is green (Actions, "Multi-Tier Cloudflare Deployment Safeguard", the run for the tip of `staging`). If it is still running when the release is merged, the production job fails at the staging deploy check; wait for staging, then use "Re-run failed jobs".
2. Release by merging the pull request from `staging` into `main` with **Create a merge commit**. A squash merge, a rebase merge, a fast-forward push (`git push origin staging:main`) or a direct push fails condition (a) and deploys nothing.
3. Merge nothing else into `main`. A pull request from any other branch (a dependency update, a hotfix) fails condition (c); it goes to `staging` first. Dependabot is pointed at `staging` in `.github/dependabot.yml`.
4. **Leave `staging` alone from the moment the release pull request is merged until production is green.** A later change to `staging` no longer blocks a re-run, but a quiet staging keeps the two environments on the same code while the release is in flight, and the next release starts from a known state. Never force-push or rewrite `staging`: condition (c) reads its history.
5. If the production job fails after "Apply D1 migrations", production has a new schema under old code. Fix the cause and use **Re-run failed jobs** on that same run. It passes both checks again as long as `main` has not moved, whatever has landed on `staging` since. If the migration itself must be undone, the bookmark printed just before it is the restore point.
6. **When production is green, merge `main` back into `staging`:** open a pull request from `main` into `staging` and merge it with **Create a merge commit**. `main`'s protection requires a branch to be up to date before merging (`strict: true`), and each release leaves one merge commit on `main` that `staging` does not have, so without this step the next release pull request is "out of date" and cannot be merged. The back-merge changes no file. It lands on `staging` as a merge commit whose first parent is staging's previous tip, so staging's own line of history is kept.
7. An older release cannot be deployed again once a newer one is on `main`: condition (d) refuses the stale run. To go back to older code use `wrangler rollback` (above), not this workflow.
8. A manual run that names "production" from `main` goes through the same two checks. From any other ref it fails in the job "Refuse a production deploy from a ref other than main" and deploys nothing. A manual run that names "staging" deploys staging only, from whichever ref it was started on.
9. One deploy per environment runs at a time. A run that has started is never cancelled; a newer one waits. If two are waiting, GitHub keeps only the newest.

### What these checks do not cover

- **A manual run uses the workflow file of the branch it is started from.** Until the `production` environment in GitHub holds the Cloudflare token itself, is restricted to the `main` branch and has a required reviewer, anyone who can push a branch can start a run from a copy of the workflow with the checks removed. Until then the checks are advisory against anyone with write access. This is a GitHub setting (Settings, Environments), not something this repository can fix.
- **Cloudflare Workers Builds** is connected to this repository and builds on its own when `main` moves. If it is set to deploy, a commit this workflow refuses still goes live. Worker, Settings, Builds in the Cloudflare dashboard.
- The checks stop a deploy. They do not stop a merge: keeping a wrong commit off `main` is the job of branch protection.

### Licence key count, before and after (plan rule 2.15)

The number of licence keys that are not revoked must be the same before and after a production release. `scripts/count-license-keys.mjs` prints that number and changes nothing; it reads a file the operator produces with two read-only wrangler commands. Run them from Git Bash or cmd (Windows PowerShell 5.1 re-encodes redirected text), in a directory outside any repository checkout, because both files hold raw licence keys:

```bash
npx wrangler kv key list --namespace-id=00d331adea604a70945fb1651b7968b3 --remote --prefix=license:key: > names.json
npx wrangler kv bulk get names.json --namespace-id=00d331adea604a70945fb1651b7968b3 --remote > records.json
node <repo>/scripts/count-license-keys.mjs records.json
```

Note the number, remove both files, release, then repeat. The two numbers must match. What can move it for an honest reason: a key minted, or a built-in campaign code redeemed for the first time, in between (the count rises by one record each); or a redeemed key's record reaching the end of the one-year lifetime it is given at redemption (the count falls). A redeemed key is still counted: it is used up, not revoked. `kv bulk get` is marked open beta in wrangler 4.145.0 and had not been run against production when this was written; if it refuses a long names file, split the file and pass every records file to the script in one call.

## Incident contacts

- Deploy / D1: CEO + full-stack on-call  
- Privacy purge mistakes: `privacy@luminarasuite.com` + security  
- Billing / budget hard-stop false positives: support + disable via `BUDGET_ENFORCEMENT=soft` kill-switch

## Post-restore

1. `npm run smoke:prod` (or staging).  
2. Spot-check `/api/health`, one signed-in `/api/workspace`, one `/api/findings`.  
3. Confirm `privacy_jobs` and `weekly_decisions` exist after 0014/0015.  
4. File a short postmortem in `.agents/PAPERCUTS.md` if RPO/RTO missed.
