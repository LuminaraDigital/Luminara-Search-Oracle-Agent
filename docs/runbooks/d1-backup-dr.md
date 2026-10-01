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
2. CI order is **migrate → deploy → smoke**. If migrate fails, deploy must not run.
3. Forward-fix: add a new migration; do not rewrite applied files.
4. If a bad migration landed: restore from daily export into a clone, fix SQL, re-apply on a fresh clone, then cut over with CEO approval.

## Worker rollback

```bash
npx wrangler deployments list --env production
npx wrangler rollback --env production
```

Then re-run `npm run smoke:prod`.

## Incident contacts

- Deploy / D1: CEO + full-stack on-call  
- Privacy purge mistakes: `privacy@luminarasuite.com` + security  
- Billing / budget hard-stop false positives: support + disable via `BUDGET_ENFORCEMENT=soft` kill-switch

## Post-restore

1. `npm run smoke:prod` (or staging).  
2. Spot-check `/api/health`, one signed-in `/api/workspace`, one `/api/findings`.  
3. Confirm `privacy_jobs` and `weekly_decisions` exist after 0014/0015.  
4. File a short postmortem in `.agents/PAPERCUTS.md` if RPO/RTO missed.
