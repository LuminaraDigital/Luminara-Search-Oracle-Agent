# Engineering guide (Luminara Suite)

This repository is **Luminara Suite**: React (Vite) + Cloudflare Workers + D1, with optional Electron and Telegram Mini App surfaces.

## Product surfaces

- **Web / Electron / TMA:** Instant Audit, Oracle chat, Settings, share links.
- **MCP (`/mcp`):** Programmatic access to the same projects, context, and reports as the app.
- **Methodology playbooks:** SEO/AEO/GEO skills under `.claude/skills/seo*` compile into app playbooks via `npm run playbooks`.
- **Product workflows:** `plugins/luminara/skills/*` (context, research log, MCP, `save_report`).

## Engineering principles

- Prefer simple, readable, flat code. Search before adding helpers.
- Worker D1 access lives under `worker/`. Shared types under `services/` or `types.ts`.
- Validate untrusted input at trust boundaries. Prefer instructive error messages.
- No em dashes (U+2014) in new copy. Use `-`, `:`, or `.`.
- Prefer edit over create. Do not fork OpenSEO into the product; pattern library only.
- Subsystem invariants live in per-folder README.md files. Update the README when you change an invariant.
- Specs under `specs/` are public design records: what, why, alternatives. No line numbers, secrets, or migration dump noise.

## Code quality and simplicity defaults (Ponytail, pstack, Thermo-Nuclear)

These three standards are default and mandatory across all code changes to keep the codebase unbloated, clean, direct, and maintainable:

1. **Ponytail (Lazy senior dev mode):**
   - The best code is the code never written. Solve the whole problem with the least new code.
   - The smallest complete change: stop at the first rung that works (1. Does it need to exist? 2. Already in codebase? 3. Standard library / platform feature? 4. Installed dependency? 5. One clear line? 6. Minimum working code).
   - Deletion beats addition. Never add wrappers, speculative options, or boilerplate.
   - Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, or tests for non-trivial logic.

2. **pstack (Rigorous engineering discipline):**
   - Go deep first: trace the real flow before picking a solution. Read all code your change touches.
   - Laziness protocol: bias toward deletion and smallest change.
   - Subtract before you add: remove dead weight first, then build on the simpler base.
   - Minimize reader load: collapse one-caller wrappers, reduce layers and hidden mutable state.
   - Boundary discipline: validate at system edges, trust internal types, keep business logic pure.
   - Type system discipline: make illegal states unrepresentable. Test observable behavior, not internal plumbing.

3. **Thermo-Nuclear Code Quality Review (Strict maintainability and code judo):**
   - Ambitious structural simplification: seek "code judo" moves that make entire branches, helpers, or layers disappear.
   - 1,000-line ceiling: do not let a change push a file from under 1k lines to over 1k lines without decomposing first.
   - Zero spaghetti condition growth: reject ad-hoc conditionals and scattered flags in existing flows. Push logic into dedicated abstractions or domain models.
   - Canonical layer reuse: keep logic in its rightful package/module; reuse canonical utilities instead of bespoke duplicates.


## Quality gates

Before merging to `main`:

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

CI runs the same gates. `main` requires a pull request and a green CI check.

## Product invariants (APS)

See `docs/plans/agent-mcp-product-surface.md`.

1. Free MCP tools (Growth+): `whoami`, projects, project context, agent reports.
2. Paid research tools need Agency `apiAccess` or BYOK DataForSEO.
3. Callers must `get_project_context` before paid calls; check research log within 30 days.
4. Chat returns verdict + one action + report link, not full HTML novels.
5. Never invent SEO metrics. Use `not_measured` / `unknown` when data is missing.

## Papercuts

Small non-blocking friction: append to `.agents/PAPERCUTS.md` in the moment. Continue the task. No secrets.

## GUI grounding

Screenshot-click automation uses `services/grounding/` (PointerBench protocol): fixed 1024x768 absolute pixels, planner/pointer split, per-subset gate. Prefer DOM/Playwright when selectors exist. See `specs/0006-gui-grounding.md`.

## Related plans

- `docs/plans/weekly-decision-loop-10x-ship.md` (product spine WDL0-WDL8 + Track P/V merge; authoritative)
- `docs/plans/investor-marketable-10x-ship.md` (activation + VAL + live governance spine M0-M8)
- `docs/plans/suite-10x-production-ship.md` (paperclip Track P + Blender/Canvas Track V)
- `docs/plans/landing-moat-100x.md` (landing moat Sessions S0-S6; Three.js S6 CEO-only)
- `docs/plans/conversion-honesty-ship.md` (C0-C4 Probe honesty + guest CTA + L7 gate)
- `docs/plans/commercial-credibility-100x-ship.md` (CC0-CC5 sellability: honesty residual + Stripe + pitch + Fix/streak + 10-20 payers; authoritative for charging)
- `docs/plans/agent-mcp-product-surface.md` (APS A0-A8)
- `docs/plans/virality-activation-loops.md` (share OG + MCP mint activation)
- `docs/plans/e2e-visibility-agent-platform.md` (W0-W8)
- `docs/plans/gui-grounding-pointerbench.md`
- `docs/plans/indexed-dom-action-agent.md` (B0-B5)
- `docs/plans/evidence-bound-decision-100x.md` (claim ledger + intent router + citation gate; no TypeSafe)
- `docs/plans/genui-canvas-100x-architecture.md` (Luminara GenUI 100x Canvas streaming DSL)
