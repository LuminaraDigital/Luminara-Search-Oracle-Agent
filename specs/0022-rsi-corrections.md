# Spec 0022: Learning from corrections

## Status
Proposed / implemented behind the RSI session routes. Stacked on the skill library. Not merged.

## Context
The skill library refuses a live change that fails its built-in evals. Those evals are fixed. A person who corrects an answer has a better case than a generic checklist, and the reward weights that score agent rollouts do not yet move when a real outcome shows a miss.

## Design
A correction stores the prompt, the rejected excerpt, the replacement excerpt, and source-event refs. The rejected excerpt becomes a `mustNotContain` eval case for that account. The replacement is rendered as YAML the self-hosted eval runner can parse (`evals/yaml-subset.mjs`). The case is active immediately.

`POST /rsi/skills/proposals/:id/apply` loads those cases. A skill body that still contains a rejected excerpt does not go live. `POST /rsi/prompts/publish` runs the same safety scan, the metric eval, and the correction cases before it writes a new `agent_skills` version. Prompt publishes share the 3-change daily cap with skill creates, patches, and curator writes. Rollback disables that version and re-enables the previous one without spending the cap.

Reward weights start at the existing defaults. A nudge adds at most 0.02 to the weight that matches a measured miss (honesty, budget, format, grounding) or to the task weight when the outcome succeeded with no miss, then renormalizes. One nudge per account per ISO week. A pinned profile does not move. Rollback restores the weights from the previous revision.

## Alternatives
- Append correction YAML into `evals/cases/` on the server. The Worker filesystem is not the git tree, so the live gate reads D1 and the YAML is returned for an operator who wants to commit a fixture.
- Learn weights with an unbounded gradient step. A small capped step keeps one noisy outcome from flipping the verifier.
