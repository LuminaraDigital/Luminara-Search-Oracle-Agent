# Idea Scout

## Status

Accepted for Phase 3. Duels, leaderboards, and gift cards stay later.

## Context

Instant Audit assumes a public hostname. A founder who only has a sentence cannot start there without inventing a domain. Phase 2 can attribute an invite and pay hosted scout credits, and it does not give that founder a card. The card has to stay inside the same honesty rules as a guest scout: no SERP share, no measured badge without evidence.

## Decision

1. `startapp=idea` opens Idea Scout. `idea_<id>` reopens one card when the id matches `is_` plus 16 hex characters. `audit_<domain>` and `scan_<domain>` still prefill Instant Audit. `ref_<code>` is unchanged.
2. The form takes an idea sentence, an optional niche, and up to 3 competitor URLs. URLs use the same public-hostname check as Instant Audit. Local hosts, IP literals, credentials, and special-use suffixes are rejected.
3. The Worker mints a typed card: problem, who might ask an assistant (labeled model inference), competitor title and heading samples, 3 hypotheses, and a site checklist. The checklist items stay `not_measured`. A fetched page is `fetched`. The card schema rejects percentage fields, other numeric metrics, and any `measured` badge. A page title is not a citation measurement.
4. Hosted generation requires Telegram `initData` or a Firebase session. Anonymous requests stop before fetch or model spend. Free accounts get 2 idea cards per UTC day. The counter is a D1 compare-and-swap on `idea_scout_daily` (`UPDATE` only while `used` is still the value just read, and still under 2). The slot is claimed only after the `idea_scouts` insert succeeds. A failed insert does not claim a slot and does not call the hosted meter. If migration 0013 is missing, the route returns before fetch, model, and meters. Each kept hosted card also consumes the existing hosted meter (then referral credits). An active plan is unlimited. A caller `x-provider-key` skips hosted keys and the 2-card cap. That key never falls through to a hosted secret.
5. Competitor fetches read one public URL each: title, meta description, and a short heading sample. Redirects are not followed. No full crawl.
6. "I have a domain" navigates to Instant Audit with that public hostname (`audit_<domain>`). The idea row stores `linked_domain`. `linked_audit_run_id` is set only when an `audit_runs` row for that account and host exists, or when the client sends a run id the account owns. That handoff id is consumed by one Instant Audit. A successful link clears it. Opening Instant Audit any other way, or leaving Idea Scout, clears it too. A failed link keeps the id so that same handoff can retry.
7. Niche Pulse stores the niche, one tip, and enabled. `/pulse` and `/idea` answer in the bot. The Sentinel cron does not send pulses. A daily send is a follow-up once an operator confirms the send policy.
8. There is no anonymous guest token. A token that could mint hosted cards would reopen toll fraud. Signed-out people can open the form. The create route still returns 401.

## Alternatives considered

- Client-only model card: rejected. The browser could mark a guess as measured, and anonymous traffic could burn hosted keys.
- Scores or SERP percentages on the card: rejected. Missing evidence stays `not_measured` or empty.
- Treating a fetched title as `measured`: rejected. Measurement stays on Instant Audit, after a domain and evidence.
- Full competitor crawl: rejected for this phase. Title, meta, and headings are enough to show what was actually fetched.
- Daily cron in this change: rejected. The scheduled handler already runs Sentinel. A fan-out needs its own send policy.
- Short-lived anonymous cards: rejected. Operator lock is the same as hosted Instant Scout: identity before hosted spend.

## Not in scope

Friend duels, leaderboards, gift cards, miniapps.me, paid IdeaBrowser-depth research, and a design-system craft pass.
