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
8. A user correction becomes an active eval case. Skill publishes for that account fail while their text still contains that rejected excerpt. Publishing or rolling back the global `agent_skills` catalog requires `ADMIN_SECRET`. A session cannot do it.
9. Reward weights move at most once per ISO week, from measured outcome signals, and a pinned profile does not move. Rollback restores the previous weights.
10. A fix is a citation success only when both rates are measured and the later rate is higher. `not_measured` stores no rate. Ranking uses those measured effects and leaves unknown signatures at score 0.
11. A new audit, probe, or ranking strategy is enabled only when replay on logged measured runs beats the current strategy. One enable per domain and kind per week. Pinned strategies stay fixed. Unmeasured runs do not enter the mean.
12. A posting pattern is added only after two measured 72h successes above the brand median, with at most two playbook edits per week. A pinned playbook stays fixed. Cold-start winner choice is `not_measured`.
13. Memory search is account-scoped. A brand-fact nudge is a suggestion, not a write. The person saves it with `saveBrandFact`.

## Layout

| File | Job |
|------|-----|
| `guardrails.ts` | Caps, evidence, pin lock, live-change gate |
| `skillGuard.ts` | Safety scan before a skill body goes live |
| `skillEvals.ts` | Built-in evals. Correction cases append later |
| `skillLibrary.ts` | Propose, apply, usage, curator plan, rollback |
| `corrections.ts` | Turn a user correction into an eval case and YAML |
| `fixOutcomes.ts` | Classify citation before/after and rank fixes |
| `offlineReplay.ts` | Score a strategy on logged runs before enabling it |
| `postingAgent.ts` | Draft posts, pick one from measured history, reflect a playbook |
| `memorySearch.ts` | Rank indexed audits and chats, and suggest a brand fact |

Worker persistence is `worker/rsiSkillStore.ts`. Monday 09:00 UTC runs `worker/rsiCurator.ts`.

## Attribution

Usage stats, stale archival, and a pre-live safety scan are inspired by Nous Research hermes-agent (MIT), `tools/skill_manager_tool.py`, `skill_usage.py`, and `skills_guard.py`. No Hermes source is copied. https://github.com/NousResearch/hermes-agent

The propose, evaluate, and retain shape follows Gen-Verse/RSI-Anything (Apache-2.0) at the idea level only. https://github.com/Gen-Verse/RSI-Anything

lobehub/awesome-rsi (CC0) was used as a map of the area, not as code.
