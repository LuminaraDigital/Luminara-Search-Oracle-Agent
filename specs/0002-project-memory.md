# Project memory

## Status

Accepted (APS A2)

## Context

Business knowledge lived in BusinessDNA, local mem0, and chat. Agents re-interviewed users and re-bought research.

## Decision

Per-project D1 store: typed sections (`business_overview`, `current_goal`, `positioning`, `writing_preferences`), competitors, key pages, research log. Free MCP `get_project_context` / `update_project_context`. Seed from BusinessDNA when empty. Caps keep context injectable every turn.

## Alternatives considered

- Markdown blob only: hard for UI and typed competitors.
- mem0/Vectorize only: wrong shape for structured SEO facts (W8 can embed later).

## Not in scope

Full sitemap inventory in context (use audit pages / GSC instead).
