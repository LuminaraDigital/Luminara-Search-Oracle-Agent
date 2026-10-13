# rsi

Learned loops for Luminara Suite. D1 is the record. KV is a short-lived copy. Pure functions in this folder do not call a model.

## Invariants

1. A round may apply at most 3 automatic skill changes (creates, patches, archives, stale marks) in 24 hours.
2. A create or patch cites at least one source event. Missing evidence is refused.
3. A pinned skill is not patched, archived, or rolled back until a person unpins it.
4. A create or patch goes live only after `scanSkillBody` and `runSkillEvals` pass. Retirement does not publish new text.
5. Rollback appends a revision. It restores the previous live body and runs the same scan and evals on that body.
6. Success rate is null until a use is marked success or failure. The library does not invent one.
7. The same fix signature proposes a skill only after two successes.
8. A user correction becomes an active eval case. Skill and prompt publishes fail while their text still contains that rejected excerpt.
9. Reward weights move at most once per ISO week, from measured outcome signals, and a pinned profile does not move. Rollback restores the previous weights.

## Layout

| File | Job |
|------|-----|
| `guardrails.ts` | Caps, evidence, pin lock, live-change gate |
| `skillGuard.ts` | Safety scan before a skill body goes live |
| `skillEvals.ts` | Built-in evals. Correction cases append later |
| `skillLibrary.ts` | Propose, apply, usage, curator plan, rollback |
| `corrections.ts` | Turn a user correction into an eval case and YAML |

Worker persistence is `worker/rsiSkillStore.ts`. Monday 09:00 UTC runs `worker/rsiCurator.ts`.

## Attribution

Usage stats, stale archival, and a pre-live safety scan are inspired by Nous Research hermes-agent (MIT), `tools/skill_manager_tool.py`, `skill_usage.py`, and `skills_guard.py`. No Hermes source is copied. https://github.com/NousResearch/hermes-agent

The propose, evaluate, and retain shape follows Gen-Verse/RSI-Anything (Apache-2.0) at the idea level only. https://github.com/Gen-Verse/RSI-Anything

lobehub/awesome-rsi (CC0) was used as a map of the area, not as code.
