# Scope Notes: Agentic Oracle (REA)

2026-11-06.

## Track

All three targets are open-source source trees, so this is **source reading**, not runtime analysis. Nothing from them is installed, built or run. Clones are shallow (`--depth 1`) and live in a `rea-refs` folder outside this repository, treated as untrusted data.

| Target | Commit read | Licence (OBSERVED in the clone) | What we may take |
|---|---|---|---|
| Significant-Gravitas/AutoGPT | `ff7b0a6` (2026-11-05) | Root `LICENSE`: two licences. `autogpt_platform/` is PolyForm Shield 1.0.0; the rest is MIT. | Ideas only. No code, text or schemas from `autogpt_platform/`. PolyForm Shield forbids use in a competing product. |
| bytedance/deer-flow | `4a53a36` (2026-11-05) | MIT | Ideas. Code is written fresh anyway (REA boundary). |
| NousResearch/hermes-agent | `84a03014` (2026-11-05) | MIT | Ideas. Code is written fresh anyway. |

## Luminara side

The parts to wire are read in place, in the `feat/agentic-oracle` worktree cut from `origin/staging` at `5464754`:

- `services/browserAction/*` (indexed DOM action loop; plan `docs/plans/indexed-dom-action-agent.md` says B0-B5 built, pending deploy approval)
- `services/rlm/*` (RLM runner; only its types are used by the UI today)
- `services/grounding/agenticZoom.ts` (exported, never called)
- `services/tools/runToolLoop.ts` (live only behind a hidden localStorage flag)
- `crawler/` (Patchright service; the only place a browser can run)

## Tools available

- `git`, `gh`, ripgrep, node and npm: present.
- Not used: no target is run, so no VM or sandbox is needed.

## Limitations

- Shallow clones: no history, so "why" a pattern exists comes from docs and comments, not commits.
- Claims about how a target behaves at runtime are INFERRED from source, never OBSERVED running.

## Permission check

Passed. Public open-source repositories; reading them is allowed. Code reuse is ruled out regardless of licence.
