# Spec 0031: Weekly email digest

## Status
Proposed. Built behind `WEEKLY_EMAIL_DIGEST_ENABLED`, off in staging and production. Item 9 of the ChatSEO gap plan (`docs/plans/chatseo-competitive-gap.md`).

## Context
The only re-engagement today is the Telegram weekly briefing, which needs a linked Telegram account and a browser flag on the decision card. A competitor sends a weekly SEO report by email. Luminara Suite already sends one welcome email through Resend (`worker/welcomeEmail.ts`), with a D1 claim for idempotency and a one-click unsubscribe.

The digest holds two things: the one fix to do next, and what moved in the last seven days. Every number in it says how it was obtained: Measured, Estimated, or Not measured. Nothing is blended into a score, and nothing is invented.

## Who gets it
- A signed-in user who turned the digest on in Settings > Account for the email address on their account, and has verified that address. It is off by default for everyone, new and existing accounts alike.
- Opt-in is one rule for every country. Australia's Spam Act 2003 and New Zealand's Unsolicited Electronic Messages Act 2007 need consent for a commercial message, and the burden of proving it sits with the sender. The US CAN-SPAM Act is opt-out, so opt-in also meets it. Singapore, Canada (CASL), the UK and the EU are covered by the same rule. We do not reliably know a user's country, so a per-country default would rest on a guess.
- Consent has to come from the holder of the address. Turning the digest on sends a fresh Firebase ID token. The Worker accepts it only when the token belongs to the account, says the email is verified, and names the account's email. Anyone can type someone else's address at sign-up; this step stops that address from being enrolled.
- The consent record is the time (`weekly_digest_opt_in_at`) and the address (`weekly_digest_email`), plus the browser's time zone. Consent holds only while the account email still equals that address, so a changed email needs a new opt-in. The Settings copy shows the address, what the email holds and how often it comes.
- Each email names the sender (legal entity, ABN, location), carries a working unsubscribe link and the RFC 8058 one-click header, and has an honest subject line with no user data in it.
- While the flag is off, the toggle stays hidden (`available: false`) and the API refuses to turn the digest on, so nobody consents to an email that is not being sent. Turning it off always works.

## Unsubscribe and the stored preference
- The footer link and the `List-Unsubscribe` header point at `/api/email/unsubscribe?token=...&list=weekly`. GET (the link) and POST (the one-click action from the mail client) both clear `weekly_digest_opt_in_at` at once. The token is the per-user `email_unsub_token` the welcome email already uses; turning the digest on creates it when missing.
- Without `list`, the existing link stops all Luminara Suite emails (`email_opt_out_at`) and now also clears the digest opt-in.
- A user can turn the digest back on in Settings. That new consent counts only if it is later than any global opt-out, so the latest decision wins.
- The consent rule is one SQL predicate. The candidate query, the weekly claim and the Settings view all use it, and the claim re-checks it, so an unsubscribe that lands during a run is honoured.

## Send window
- The digest goes out on the user's local Monday. Tuesday and Wednesday are catch-up days for a send that failed for sure or did not fit the daily cap. The week is the ISO week of the user's local date, so a user is never mailed twice in one local week.
- The time zone comes from the browser when the digest is turned on. A missing or invalid zone falls back to `Australia/Sydney`, the product's default day.
- The digest rides the existing daily 08:00 UTC trigger, so the local hour depends on the zone: 18:00 or 19:00 in Sydney and Melbourne, 16:00 in Perth, Singapore and Manila, 15:00 in Bangkok and Jakarta, 20:00 or 21:00 in Auckland, and the small hours of Monday in the Americas, so it is waiting at the start of the day.

## Cron trigger
No new expression is added to `wrangler.jsonc` `triggers.crons`. The account is at its Workers cron-trigger cap (the config comment and spec 0021 record this), and a deploy that adds one would fail. The digest is a new job, `weekly_email_digest`, on the daily `0 8 * * *` expression in `worker/scheduledJobs.ts`, shipped with its `CRON_JOBS` entry in the same change. The job returns at once while the flag is off.

If a trigger slot is freed later, an hourly expression would let the window become Monday 08:00 local. Only the due check and the cron mapping would change.

## Idempotency
- `email_digest_sends` has one row per user and local week (primary key `user_id, week_key`). The job claims the row with an insert that does nothing on conflict, before it reads any data, and only while consent holds. Two runs, or a retried run, cannot both claim the same week.
- Resend gets `Idempotency-Key: digest-<user>-<week>`, which covers a retry inside Resend's own window.
- A 4xx from Resend (for example a rate limit) means it did not send, so the claim is deleted and the Tuesday or Wednesday fire tries again. A network error, a 10 second timeout or a 5xx leaves the outcome unknown: the row stays as `unknown` and that week is not retried. A 409 means Resend already holds a request with this key, so it counts as sent. A Worker that dies after the claim leaves the row as `claimed`, also not retried. Missing one week is better than sending twice.
- A cap of `WEEKLY_EMAIL_DIGEST_DAILY_LIMIT` claims per fire (default 50) and a short gap between sends keep a run inside Resend's rate limit and inside the Worker's query budget: one user costs about eight D1 queries and one fetch, and the scheduled handler shares a 1,000 query cap with the other daily jobs. Users who have waited longest since their last claim go first, so users past the cap are picked up on the next fire and nobody is starved. The digest does not spend the password-reset and OTP budget (`OUTBOUND_EMAIL_DAILY_LIMIT`), so a digest run can never block a sign-in email.

## What the email holds
- **Your next fix.** The open or in-progress Fix Board finding (`audit_findings`) ranked first by `pickPrimaryFinding`, the same rule the report uses for "Your next fix": critical, then high, medium, low, and never a finding the evidence check downgraded. Across all of the account's domains, a tie goes to the most recently updated finding. Only the title is sent. Audit text can hold a figure with no label (for example "None of the 3 results name your business"), so a title with a digit is replaced by "Your top fix for <domain> is waiting on your Fix Board".
- **What moved in the last seven days:**
  - Site checks from Instant Audit history (`audit_history`), for up to three domains audited in the window: the newest audit inside the window against the newest one before it, as "6 of 8 checks passed, 2 failed (Measured)", with any unmeasured checks after the label ("..., 1 not measured"). A report without a readable check line is "Not measured". A clean pass that the stored entry cannot prove is also shown as "Not measured", the same conservative rule the report page uses.
  - Citation Watch runs (`citation_watch_runs`), for up to three active watches that ran in the window: cited prompts out of prompts, with the stored run label, against the newest run before the window. A `not_measured` run says so. While `CITATION_WATCH_LIVE` is off no runs exist, and the email shows none.
- No source in this version produces an Estimated figure. The label type allows one so a later source can add it.
- The job reads `audit_history` from D1 directly, like the other cron jobs. That is the source of truth on the `d1` and `dual` data planes.
- Left out on purpose: the competitor watchlist and its alerts (kept in the browser, not in D1), the authority scout (computed in the browser for each report and not stored), `healthScore` and `citationRatePercent` in audit history (one is a blended score, the other is scraped from report text without a label), and fixes marked done (the Fix Board stores no done date, and a later audit re-save touches the row, so "done this week" could be wrong).

## No new data
- Nothing moved and no open fix: skip the week, with no email.
- An open fix but nothing moved: send a short "Nothing new was recorded on your account this week" email with the fix, but only when the last digest sent to that user was not itself a quiet one. So at most one quiet email in a row, then silence until something moves.

## Owner setup
- Resend: the welcome email already sends from `hello@luminarasuite.com`, so the domain should be verified. Confirm in the Resend dashboard that SPF and DKIM pass for `luminarasuite.com`, and that a DMARC record exists. If they do not, add the records Resend lists for the domain in Cloudflare DNS. Gmail and Yahoo require SPF, DKIM, DMARC and one-click unsubscribe from senders of 5,000 or more messages a day, and SPF or DKIM from everyone.
- `RESEND_API_KEY` is the existing Worker secret. No new secret.
- CAN-SPAM requires a valid postal address in every commercial email. The legal footer gives a suburb and postcode only. Add a street address or a registered PO box to `BUSINESS_LOCATION` before the digest goes to US recipients.
- Turn on staging first: set `WEEKLY_EMAIL_DIGEST_ENABLED` to `"true"` in `env.staging.vars`, deploy, opt in with a test account whose email is verified, and wait for its local Monday (or move its time zone so the next fire falls on its Monday). Then production.
- Optional: raise `WEEKLY_EMAIL_DIGEST_DAILY_LIMIT` above 50 once the Resend plan allows more. Above about 80 the job should move to a queue, because of the query budget above.

## Alternatives
- Opt-out for existing accounts under inferred consent. Rejected: those users signed up without being told about a weekly email, and the Spam Act puts the proof of consent on us.
- A second, hourly cron trigger for a Monday 08:00 local window. Rejected for now: the account is at its trigger cap.
- A confirmation page before the GET unsubscribe, so link scanners cannot unsubscribe a user. Rejected to keep one click and to match the welcome email. Turning the digest back on is one toggle in Settings.
- Retry on a network error or a 5xx. Rejected: the email may already have gone out, and Resend's idempotency window can expire before the next fire.
- Trust the email on the account without a check. Rejected: an unverified address is not consent from its holder.
- Reading the Telegram weekly decision row (`weekly_decisions`). Rejected as the fix source: it exists only after a user commits on the decision card. The Fix Board ranks every open finding.
