# App Context: Agentic Oracle (REA)

Long-term memory for this reverse-engineering project. Written 2026-11-06 from the owner's answers in chat.

## Goal

Make Luminara Suite truly agentic: a user hands the Oracle chat agent a job, and the agent plans, researches, browses, drafts and comes back with a verdict, one action and a report. Done by studying agent patterns in three open-source projects and rebuilding them as Luminara's own code.

## Targets to study (patterns only)

| Project | Why it is here | Licence (to confirm in SCOPE) |
|---|---|---|
| Significant-Gravitas/AutoGPT | Scheduled and triggered agents, block graphs, run history | Mixed: classic is MIT, platform is Polyform Shield. Patterns only, no code. |
| bytedance/deer-flow | Planner, parallel researchers, reporter, human feedback on the plan | Expected MIT |
| NousResearch/hermes-agent | Tool loop, skills the agent writes from experience, memory | Expected MIT |

No code, text, images or branding is copied from any of them. Every part is written fresh for Luminara (REA boundary, and AGENTS.md "pattern library only").

## Owner decisions (2026-11-06)

1. **Autonomy: approve outside changes.** The agent plans, researches, browses and drafts with nobody watching. Anything that changes the outside world waits for a one-click approval: publishing to a client's CMS, sending an email or message, paid research spend over the account's budget.
2. **First surface: Oracle chat on the web** (the Telegram Mini App shares it). Electron and MCP follow.
3. **Jobs that must work end to end in the first build, all four:**
   - **Fix my visibility:** audit, browse competitors, explain why AI answers skip the site, draft fixes (schema, llms.txt, content), queue them for approval.
   - **Deep research report:** plan, parallel researchers over search and pages, a cited report saved to the project.
   - **Ongoing watch missions:** scheduled re-checks of citations or competitors, each returning a verdict and one action.
   - **Learn and remember:** the agent saves what worked as reusable skills and per-project memory.
4. **Wire the built-but-unused parts:** the browser action loop (`services/browserAction`), the RLM runner (`services/rlm`), and grounding zoom (`services/grounding/agenticZoom`).

## Owner decisions after MAP (2026-11-06)

5. **First slice:** the Oracle tool loop (F1 + F2), approval cards (F3), and the watch-mission wake gate (J3). Then durable runs with cited research (F4, F5, J2), then "fix my visibility" end to end, then learning (J4), then screenshot zoom.
6. **Who gets it:** all signed-in plans, with per-plan step and spend caps. Paid tools keep their existing plan gates.
7. **Crawler:** the owner asked me to check. `wrangler secret list` (read-only, names only) shows no `PATCHRIGHT_URL`, `CRAWLER_TOKEN` or `OPENROUTER_API_KEY` in production or staging; present are `GROQ_API_KEY` (plus a fallback in production) and `TAVILY_API_KEY`. So browser tools ship dark and report "browser unavailable" until a crawler is hosted. The agent loop runs on Groq.

## Who it is for

Luminara users: founders, small businesses and agencies who want to be found and cited by AI answers. Mostly non-technical. They see the verdict and the one action, not the agent's internals.

## Platform and constraints

- React (Vite) web app, Cloudflare Workers + D1, Electron, Telegram Mini App, MCP at `/mcp`.
- Workers cannot drive Chromium. Browser actions run in `crawler/` (Patchright) and the Worker calls it over HTTP (indexed DOM action plan, decision 5).
- Track SW (`docs/plans/founder-swarm-business-brain-additive-plan.md`) is the one plan for agent work. Its server run engine (SW1, `swarm_runs`) is designed and not built; spike A favours a Cloudflare Workflow. This project builds on that engine and its names, and does not define rival tables (the Track BB lesson).
- Already in the tree and reused, not rebuilt: RSI skill library (migration 0027), memory facts and history (0008, 0016), Luminara Dreaming (0022), agent skills (0010), the external-effects record (`worker/externalEffectsService.ts`), the 4-round tool loop (`services/tools/runToolLoop.ts`).
- Product invariants (AGENTS.md): never invent SEO metrics; chat returns verdict + one action + report link; `get_project_context` before paid calls.
- Owner merges every non-draft PR in waves, so unready work stays a draft PR.

## Privacy note

The analysis runs on the owner's machine, but everything read is sent to the AI provider behind this coding session.

## Permission check

All three targets are public open-source repositories, so studying them is allowed. Code reuse is not taken in any case.
