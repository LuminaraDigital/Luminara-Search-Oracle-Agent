# Spec 0025: Self-improving posting agent

## Status
Proposed / implemented behind the RSI session routes. Stacked on offline replay. Not merged.

## Context
A brand's posts should learn from its own measured engagement, not from a guessed winner. The suite did not have a loop that drafts several posts, picks one, checks back, and writes a pattern into a playbook only after the pattern has worked more than once.

## Design
`POST /rsi/posts/draft` builds 3 to 5 deterministic drafts and selects one. With fewer than 3 measured 72-hour results, the prediction is `not_measured` and the first draft is selected. With enough history, the pattern that has beaten the brand median most often is selected, and the prediction is `measured`.

The selected post is stored. This route does not call an external social network.

`POST /rsi/posts/:id/metrics` accepts a 24-hour or 72-hour snapshot. `not_measured` rejects impression and engagement numbers. A pattern can become a success only from a 72-hour measured engagement above the brand median, and only once the brand has at least 3 such snapshots.

`POST /rsi/posts/reflect`, also run on the Monday 09:00 UTC cron, appends a pattern to that brand's posting playbook after 2 or more successes. At most 2 patterns per ISO week. The playbook is a learned skill, so the safety scan, evals, evidence rule, and pin lock apply. A pinned playbook is not edited.

## Alternatives
- Ask a model to invent the winning post and a citation rate. That can publish a number the brand never measured.
- Add a pattern after a single good post. One result is not a pattern. The floor is two measured successes.
