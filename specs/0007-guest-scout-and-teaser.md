# Guest scout and redacted teaser

## Status

Accepted for the guest Instant Audit path. Referral credits, streaks, and Idea Scout are later phases.

## Context

Instant Audit honesty is already the rule: empty evidence stays `not_measured`. The remaining gap was a guest who only saw Mission Control, plus share links that exist only on Growth and Agency.

## Decision

1. `startapp=audit_<domain>` and `scan_<domain>` open Instant Audit with the hostname prefilled.
2. Hosted scout spend uses the existing Worker meter. Telegram `initData` or a Firebase session may use free hosted engines inside `FREE_DAILY_LIMIT`. Anonymous browsers do not. Paid engines stay on an active plan. BYOK is unchanged.
3. After a scout, the result area leads with a plain summary: verdict, evidence, one next move, measured / not_measured badges, and what failed. `100% COMPLETE` is reserved for a fully measured run.
4. Redacted teasers are a separate artifact from `shareLinks`. Create requires identity, five per account per day, a random token, and a SHA-256 hash in D1. The public page is `/share/teaser/<token>`. The stored CTA is always the Mini App URL. Full branded `/share/<token>` reports stay Growth+.
5. LLM crawler readiness is pass, fail, or not_measured for `llms.txt` and common AI bot directives. It does not change the health score.

## Alternatives considered

- Anonymous hosted scouts metered only by IP: rejected. That is the toll-fraud path the Worker already closes when `REQUIRE_TG_AUTH` is on.
- Reuse Growth share links for free users: rejected. That gives away the paid artifact.
- Score LLM crawler readiness out of 100: rejected. Missing fetches must stay `not_measured`.

## Not in scope

Referral graph, streaks, Idea Scout, card checkout, and a teaser image.
