# Agent guidance (Luminara Suite)

This repo is **Luminara Suite**: React (Vite) + Cloudflare Workers + D1 + optional Electron/Telegram.

## Product surfaces

- **Web / Electron / TMA:** Instant Audit, Oracle chat, Settings, share links.
- **MCP (`/mcp`):** Primary AI agent surface. Cursor, Claude, Codex, and other MCP clients call the same projects, context, and reports as the app.
- **Methodology skills:** `.claude/skills/seo*` (claude-seo). Compile into playbooks via `npm run playbooks`. Do not assume the Python runtime.
- **Product skills:** `plugins/luminara/skills/*`. Thin workflows: context → research log → MCP → `save_report`.

## Engineering principles

- Prefer simple, readable, flat code. Search before adding helpers.
- Worker D1 access lives under `worker/`. Shared types under `services/` or `types.ts`.
- Validate untrusted input at trust boundaries. Prefer instructive error messages (agents read them).
- No em dashes (U+2014) in new copy. Use `-`, `:`, or `.`.
- Prefer edit over create. Do not fork OpenSEO into the product; pattern library only.
- Specs under `specs/` are public design records: what, why, alternatives. No line numbers, secrets, or migration dump noise.

## APS invariants

See `docs/plans/agent-mcp-product-surface.md`.

1. Free MCP tools (Growth+): `whoami`, projects, project context, agent reports.
2. Paid research tools need Agency `apiAccess` or BYOK DataForSEO.
3. Agents must `get_project_context` before paid calls; check research log within 30 days.
4. Chat returns verdict + one action + report link, not full HTML novels.
5. Never invent SEO metrics. Use `not_measured` / `unknown` when data is missing.

## Papercuts

Small non-blocking friction: append to `.agents/PAPERCUTS.md` in the moment. Continue the task. No secrets.

## GUI grounding

Screenshot-click agents use `services/grounding/` (PointerBench protocol): fixed 1024x768 absolute pixels, planner/pointer split, per-subset gate (Sheets/Text/Pro), optional agentic zoom, Luminara surface seed. Prefer DOM/Playwright when selectors exist. See `specs/0006-gui-grounding.md` and `docs/plans/gui-grounding-pointerbench.md`.

## Related plans

- `docs/plans/agent-mcp-product-surface.md` (APS A0-A8)
- `docs/plans/e2e-visibility-agent-platform.md` (W0-W8; MCP owned by APS)
- `docs/plans/gui-grounding-pointerbench.md` (computer-use click gate)
- `docs/plans/indexed-dom-action-agent.md` (B0-B5; additive DOM observe/act; not grounding)
