# Spec 0023: Learning which fixes work

## Status
Proposed / implemented behind the RSI session routes. Stacked on the correction eval gate. Not merged.

## Context
Dreaming already has an `action_memory` type for recommendation outcomes. The deterministic consolidator records that a recommendation changed status. It does not store the AI citation rate before and after the fix, so a later audit cannot tell a measured gain from a guess.

## Design
`POST /rsi/fixes` takes a fix signature, a title, source-event refs, and a before/after citation pair. The pair counts as a success only when `measurementStatus` is `measured` and the later rate is higher. Equal rates are `no_gain`. A drop is `regression`. `not_measured` rejects any number in the same body and the memory text says not_measured.

The row is written to `business_memories` as `action_memory`, updating the row for that signature on the domain instead of inserting a second one. A dream event is queued with `citationLogged: true` so the consolidator does not create a duplicate memory. The same measured gain still feeds the skill library: the second gain proposes a skill.

`POST /rsi/fixes/rank` reorders a caller-supplied list. Score is `(measured gains - regressions) / measured runs` for that signature on that domain. A signature with no measured run stays at score 0 with evidence `not_measured`, and ties keep the original order.

## Alternatives
- Let the dream model invent the before/after line. That can state a rate that was never measured. The numbers are accepted only from the caller, and only with an explicit measured status.
- Rank from the skill success rate. That rate mixes uses that were not citation measurements. Ranking reads the citation effect column only.
