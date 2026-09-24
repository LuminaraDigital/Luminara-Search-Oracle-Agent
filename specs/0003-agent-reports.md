# Agent reports

## Status

Accepted (APS A3)

## Context

Agents dumped long markdown into chat. W1 share links exist for humans but agents could not save a durable artifact.

## Decision

`agent_reports` table: title, summary (markdown), self-contained HTML, skill slug. MCP `save_report` / `list_reports` / `get_report`. Sandboxed viewer. Optional mint into W1 `shared_reports`. Chat returns verdict + link only.

## Alternatives considered

- Store HTML only in share tokens: wrong auth and list model.
- R2 for v1: unnecessary for tens of KB documents.

## Not in scope

Server-side PDF, version history, scripts inside reports.
