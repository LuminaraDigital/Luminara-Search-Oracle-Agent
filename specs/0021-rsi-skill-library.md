# Spec 0021: Self-learning skill library

## Status
Proposed / implemented behind session routes. Not merged.

## Context
Oracle prompts already live in `agent_skills` as versioned methodology text. Dreaming already stores what a recommendation did. Neither one tracks a learned SKILL.md that the product itself proposes after a fix works more than once, retires when it goes unused, or refuses to publish until a scan and an eval pass.

This library is a separate record (`rsi_skills`). It does not replace bundled playbooks or `agent_skills`.

## Design
A skill row is a versioned markdown body with usage counts, a success rate, a state (`active`, `stale`, `archived`), a pinned flag, and source-event refs. D1 holds the row and every revision. KV keeps the latest live body for five minutes.

Recording a fix outcome does not publish anything. The second measured success for the same signature proposes a create, or a patch when that slug is already live. Apply runs four checks: evidence present, skill not pinned, safety scan clean, built-in evals pass, and fewer than 3 automatic changes in the last 24 hours. A miss on the cap leaves the proposal pending. Any other miss blocks it.

The Monday 09:00 UTC cron marks an unpinned skill stale after 45 days without use, then archives it after 14 days stale. Pinned skills are listed and skipped. A body that fails the safety scan is archived ahead of the idle clock, still inside the cap, and still never when pinned.

Rollback writes a new revision whose body is the previous live body, after that body passes the current scan and evals. Pin and unpin are human actions and do not spend the change cap.

Success rate stays null until at least one use is marked success or failure.

## Alternatives
- Reuse `agent_skills` for learned text. That table is the runtime Oracle prompt. Mixing learned patches into it would let a curator change chat instructions without the skill gate.
- Store skills only in KV. A cache expiry would drop the only copy, and rollback needs an append-only history.
- Copy hermes-agent's skill manager. That project is MIT, and the behavior (usage, stale archive, a guard before publish) is the reference. The code here is original.

## Attribution
Inspired by Nous Research hermes-agent (MIT): `tools/skill_manager_tool.py`, `skill_usage.py`, `skills_guard.py`. https://github.com/NousResearch/hermes-agent

The propose / evaluate / retain loop follows the shape of Gen-Verse/RSI-Anything (Apache-2.0) without using its code. https://github.com/Gen-Verse/RSI-Anything

lobehub/awesome-rsi (CC0) was a reading list, not a source of code.
