# Referrals and retention

## Status

Accepted for Phase 2. Idea Scout, duels, and leaderboards stay later phases.

## Context

Phase 1 can bring a person into Instant Scout and a redacted teaser. Nothing yet attributes that visit to an inviter, or gives either side a real hosted-scout credit. Dashboard has onboarding steps and no Visibility Level. A weekly professional loop (re-scout, look at the delta, ship one fix) did not exist. Game-style coins are out of the product.

## Decision

1. `startapp=ref_<code>` is an opaque invite. `audit_<domain>` and `scan_<domain>` still prefill Instant Audit. View tokens (`dashboard`, `privacy`, and the rest) are unchanged.
2. The Mini App stores the code until Telegram `initData` or a Firebase session exists, then claims it. The stored code is cleared only after a final result: attributed, already claimed, self-referral, invalid code, or already linked to someone else. A 401 or 403, and any other ambiguous failure, keeps the code for a later try. One referred account, one referrer. Self-referral is ignored. The first referrer wins.
3. Each side receives 2 hosted scout credits after the referred account's first qualifying scout. Both credit inserts and `qualified_at` commit in one D1 batch. If that batch fails, `qualified_at` stays unset and a later qualify can pay both sides. Qualifying means a completed run, a public hostname, evidence present (page text or search rows), and `measurementStatus` of `measured` or `not_measured`. Score percentages are rejected and never stored. An empty run does not qualify. The Worker does not re-measure the scout.
4. Credits sit on a ledger and are consumed only when the signed-in daily free meter is exhausted. They are not spent by anonymous callers, not spent while an unlimited plan is active, and not a bypass of `REQUIRE_SUBSCRIPTION`.
5. Visibility Level is Explorer, Scout, Builder, or Operator, from honest scout count, completed missions, and a four-week streak. Weekly missions are re-scout, view the Brand Memory delta, and mark one checklist fix shipped. Marking a fix does not change audit scores.
6. The bot answers `/missions` with one message and a button into the Mini App. The Sentinel cron does not send mission nudges.

## Alternatives considered

- Put the Telegram user id in `startapp`: rejected. The link would leak an account identifier, and ids are easy to guess.
- Store only the code hash: rejected for the owner experience. The dashboard must show the same link later, so the opaque code is stored next to its hash.
- Grant credits on any `not_measured` run: rejected. Guest copy already says an empty run is not a finished audit.
- Grant credits from a client-supplied citation percentage: rejected. That is the invented-metric path.
- A Monday cron that messages every user: rejected for this phase. Opt-in `/missions` is the nudge. A blast can be added later with an explicit send policy.
- Tap-to-earn or a visible coin balance: rejected.

## Not in scope

Idea Scout, friend duels, leaderboards, card checkout, and server-side re-measurement of the qualifying scout.
