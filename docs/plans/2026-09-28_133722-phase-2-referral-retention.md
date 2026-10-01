# Phase 2 - Referral + retention (implement)

**Date:** 2026-09-28 (UTC)  
**Repo:** LuminaraDigital/Luminara-Search-Oracle-Agent  
**Branch from:** main  
**Spec:** `specs/0009-referrals-and-retention.md`  
**Out of scope:** Phase 3 Idea Scout, Phase 4 duel/leaderboards, Phase D/E/M, merge to main, production migrate, deploy

## Goal

Telegram K-factor + professional retention: `ref_*` invites with two-sided hosted-scout credits, a weekly mission + streak + opt-in bot nudge, and a Visibility Level on Dashboard. No GameFi. No invented SEO metrics.

## Context

- Phase 0-1 shipped (honesty/pricing, guest scout + teaser + thin llms). D1 `0011_share_teasers` is already applied by an operator. This phase does not re-apply it.
- `services/telegram/startParam.ts` handles `audit_` / `scan_` and view tokens.
- `App.tsx` resolves the start param into a view and an audit URL prefill.
- `FREE_DAILY_LIMIT` meters hosted use.
- Dashboard is Level-4 doors + onboarding.
- Agent Mission Control is the audit crew UI, not user missions.

## Locked decisions

1. Invite codes are 10-character opaque tokens (alphabet without `i`, `l`, `0`, `1`). The URL is `ref_<code>`. A raw Telegram user id is not a valid code.
2. D1 stores the code (so the owner can copy the link again) and `sha256("luminara-ref:" + code)` as `code_hash` (lookup key).
3. Both sides receive `2` hosted scout credits (`REFERRAL_SCOUT_CREDITS`) only after the referred account's first qualifying Instant Scout.
4. A qualifying scout has `completed: true`, `evidencePresent: true`, a public hostname, and `measurementStatus` of `measured` or `not_measured`. Empty runs stay unqualified. The qualify body rejects score fields (`citationRatePercent`, health, share of voice, and similar). No percentage is stored.
5. One attribution per referred account. Self-referral is rejected. A second referrer does not replace the first.
6. Credits are spent only for a Telegram or Firebase identity, and only after `FREE_DAILY_LIMIT` is exhausted. They do not bypass `REQUIRE_SUBSCRIPTION` or an active unlimited plan. While a plan is active the ledger is left untouched.
7. Visibility Level: Explorer (no honest scout) -> Scout (first honest scout) -> Builder (at least one completed mission and one honest scout) -> Operator (that, plus a 4-week streak).
8. Weekly missions: re-scout (server, second honest scout), view delta (opens Brand Memory), ship one checklist fix (self-attested, does not change scores). No tap-to-earn balance.
9. Bot nudge is `/missions` only (opt-in, one reply, keyboard into the Mini App). The daily Sentinel cron does not blast mission messages.

## Approach

1. Parse `ref_<code>` in `startParam.ts`. Keep `audit_` / `scan_` and view tokens working.
2. The client holds the code in `sessionStorage` until Telegram or Firebase auth succeeds, then `POST /api/referrals/claim`.
3. Migration `migrations/0012_referrals_missions.sql` (`CREATE TABLE IF NOT EXISTS` only). Do not apply it remotely in this change.
4. Worker routes (identity required): `GET /api/referrals/me`, `POST /api/referrals/claim`, `POST /api/referrals/qualify`, `POST /api/missions/complete`.
5. Hosted quota: when the daily meter would deny a signed-in user, consume one unused credit FIFO (`remaining` on the oldest reward row).
6. Dashboard chip + copyable `https://t.me/LuminaraSuiteBot/app?startapp=ref_<code>` plus the three missions.
7. `/missions` in `worker/telegramBot.ts` uses `formatWeeklyMissionNudge`. No new cron.

## Critical files

- `services/telegram/startParam.ts`, `services/referrals/rules.ts`, `services/referrals/pendingReferral.ts`, `services/referrals/referralClient.ts`
- `App.tsx`, `components/audit/InstantAuditView.tsx`, `components/suite/DashboardView.tsx`, `components/suite/VisibilityRetentionCard.tsx`
- `worker/referrals.ts`, `worker/quotaMiddleware.ts`, `worker/index.ts`, `worker/telegramBot.ts`, `worker/authMiddleware.ts`
- `migrations/0012_referrals_missions.sql`
- `tests/telegramMiniApp.test.ts`, `tests/referrals.test.ts`
- `specs/0009-referrals-and-retention.md`

## Entitlements

Hosted free use stays `FREE_DAILY_LIMIT` per UTC day for a signed-in account. Referral rows add extra hosted scout requests after that cap, one credit per request, oldest grant first. Anonymous callers never spend the ledger. Active subscriptions stay unlimited and do not burn credits.

## Apply the migration (operator, after merge yes)

Do not run these as part of the implementation PR.

```bash
npm run db:migrate:local
npm run db:migrate:staging
npm run db:migrate
```

`db:migrate` and `db:migrate:staging` are remote (`wrangler d1 migrations apply --remote`). Production deploy follows a separate yes. `main` auto-deploys.

## Verification

- `npm run typecheck`
- `npm test` (referral attribution, no self-ref, reward only after a qualifying scout, `ref_` parse, `audit_` still prefills)
- `npm run lint` when CI requires it
- Manual: create an invite on Dashboard, open `startapp=ref_<code>` as a second Telegram or Firebase user, run one honest Instant Scout with page or search evidence, confirm both accounts gained 2 hosted credits and the referred user is Scout. An empty `not_measured` run does not grant credits.

## Risks

- Toll fraud if anonymous hosted spend plus referral credits: rewards and bonus spend require Telegram or Firebase identity.
- Instant Scout still runs in the browser. The Worker checks the honest status contract and pays at most once per referred account. It does not re-measure the site.
- Concurrent credit decrements can race across isolates (same class of read/write race as teaser create quota).
- Migration must not be applied by the agent. The operator applies it after an explicit yes.
- Do not break `audit_` prefill.

## Success criteria

- Plan file under `docs/plans/`
- Spec under `specs/0009-referrals-and-retention.md`
- Feature covered by unit tests and a green typecheck
- PR description lists the migrate commands and says STOP for merge, deploy, and remote migrate
