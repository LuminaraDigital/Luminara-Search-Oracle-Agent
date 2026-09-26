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
6. Deep links, teaser domains, and Instant Audit targets use the same public-hostname rules as the Worker fetch guard. IP literals, localhost, and special-use suffixes (`.local`, `.internal`, `.example`, and the rest of that list) are rejected before a hosted run.
7. Teaser create rejects credential-like text in every stored string. Instant Audit mints allow-listed failure codes, not raw provider errors. The CTA stays forced to the Mini App, and secret-looking keys are still dropped.
8. A free teaser cannot claim `measured` or `estimated`. Badges and crawler checks are stored as `not_measured`. Percentage-looking badge values are rejected. The public page says it is a redacted teaser, not a verified measurement. The in-app summary can still show a measured figure from the crew.
9. A guest scout with empty page and search evidence does not call the full report generator.

## Alternatives considered

- Anonymous hosted scouts metered only by IP: rejected. That is the toll-fraud path the Worker already closes when `REQUIRE_TG_AUTH` is on.
- Reuse Growth share links for free users: rejected. That gives away the paid artifact.
- Score LLM crawler readiness out of 100: rejected. Missing fetches must stay `not_measured`.
- Let a free teaser repeat client-supplied measured percentages: rejected until the Worker can attest a prior scout run.

## Not in scope

Referral graph, streaks, Idea Scout, card checkout, and a teaser image.
