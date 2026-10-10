# Business Brain and Agent Crew (Track BB): retired

**Status:** retired on 2026-10-10. Do not build from this file.  
**Use instead:** Track SW, which is the one plan for this brief. Owners start at [`founder-swarm-owner-brief.md`](./founder-swarm-owner-brief.md); builders at [`founder-swarm-business-brain-additive-plan.md`](./founder-swarm-business-brain-additive-plan.md).

## Why this file is a pointer

On 2026-10-10 two sessions were given the same owner brief and each wrote a master plan. This one (Track BB v1.0) and Track SW overlapped on most of their scope and collided on names: both defined `ship_notes`, `connector_sources`, `metric_snapshots` and `agent_jobs` with different columns, the same `/ship-notes` routes, and a migration both called `brain_connectors`. Every table was created with `IF NOT EXISTS`, so whichever shipped second would have done nothing, silently.

The owner chose Track SW as the plan to keep. Track BB v1.0 was never revised. Its content was folded into Track SW v0.2, and Track SW v0.3 and v0.4 then applied two more review rounds. Track SW is four files; section numbers are the same in all of them.

| Track BB had | Now in Track SW | File |
|---|---|---|
| Phase BB0: payment, honesty and release fixes | Hazards 9 to 21 (section 1.2) and SW0a (section 5.1) | the plan |
| Phase BB1: Fix list, ship notes | SW3 (section 8) | the plan |
| Phase BB2: server-side crew | SW1 (section 6) | the plan |
| Phase BB2, the roster with limits; Phase BB3, business brain | SW2 (section 7); SW4 (section 9) | `founder-swarm-later-phases.md` |
| Phase BB4: jobs | SW6 (section 11) | `founder-swarm-later-phases.md` |
| Phase BB5: community | Sections 14.3 to 14.6 | the plan |
| Phase BB6: desktop, wallet link, on-chain badges | SW8 (section 13) and section 15 | `founder-swarm-later-phases.md` |
| Owner decisions | Section 20 | `founder-swarm-owner-brief.md` |
| Reference projects and licences | Section 24.2 | `founder-swarm-appendix.md` |
| Corrections to the gamified draft | Section 24.3 | `founder-swarm-appendix.md` |
| Review round 1 (CEO gate, full-stack, AI and machine learning, blockchain and payments, citation and SQL verifier) | Section 22, and section 24.4 for where each finding landed | the plan; `founder-swarm-appendix.md` |
| Design choices Track SW did not take, and why | Section 24.5 | `founder-swarm-appendix.md` |

## What review round 1 said about Track BB v1.0

Recorded here because it is the reason this file was not simply revised.

| Reviewer | Verdict |
|---|---|
| CEO gate | No-go for the track; go for the hotfix slice |
| Full-stack | No-go as written (6 blockers) |
| AI and machine learning | Conditional go (5 blockers) |
| Blockchain and payments | Conditional go for the fixes; no-go for jobs and the gated chat as written (4 blockers) |
| Citation and SQL verifier | 52 items to fix; the four migrations applied cleanly |

The full text of v1.0 is in git history at commit `42880f5`.
