# Oracle tool loop (`worker/oracleAgent`)

Oracle chat's step-by-step mode: the model chooses tools, sees their results, and answers. Design and review record: `docs/rea/agentic-oracle/Blueprint.md`. Off unless `ORACLE_AGENT_ENABLED` is `"true"`; with it off, `worker/oracleChat.ts` behaves exactly as before.

| File | What it holds |
|---|---|
| `toolTable.ts` | The frozen tool table: effect (`read`, `draft`, `external`), gate, run or prepare/execute |
| `loop.ts` | The loop, its rules, limits, grace call, receipts, source check |
| `modelCall.ts` | `callOracleModel`, the only provider call (Track SW SW1b replaces it) |
| `approvals.ts` | Parking an external action as a card; deciding it once |
| `admission.ts` | Daily caps (account, IP, global), refunds, counters |
| `context.ts` | The tool context, built from the signed-in account |
| `limits.ts` | Per-plan limits; `ORACLE_AGENT_LIMITS` overrides |

## Invariants

1. **The table is code.** `AGENT_TOOLS` is frozen at module load. Nothing at run time changes a tool's effect or gate. No tool takes an account, a project, or (for `create_watch`) a domain from the model: the project is the chat's, the domain is the project's.
2. **External tools never run in the loop.** They are parked in the `OracleSession` object as an `AgentActionGate` and shown as a card whose text is built by code. They run only from `decideAction`, after the user approves.
3. **One latch, one run.** `pending -> executing` happens once in the session object; `claimExternalEffect` (insert, do nothing on conflict, keyed on the action id) is the second lock. An outcome that cannot be confirmed becomes `failed_unknown` and is never retried. `remember` and the remembered-tools list never apply to agent actions.
4. **Arguments come from the stored card.** The approval request body carries only `actionId` and `approved`. The account is re-bound from the signed-in user, the project from the card, ownership is checked again, and the args hash must match.
5. **Tool results are untrusted.** Each goes back as a `tool` message wrapped by `fenceToolResult`; the rule is in the stable system prefix. Every slice-1 card is marked tainted.
6. **Nothing unchecked is sent.** Rounds are not streamed. The final text goes through `guardPasteReadyCopy`, `runAllValidators`, `withoutUnmeasuredClaims` and the source check before the first `token` frame. Only results with a structured `measured` status count as evidence; search results never do.
7. **Receipts are code-built.** Step summaries come from the tool and its result status, never model prose.
8. **Caps fail closed.** Agent turns go through `spendDailyQuota` (a missing meter refuses). Over a cap the chat answers `429 AGENT_CAP`; a turn that produced no answer is refunded and the client falls back to the simple chat.
9. **Non-Agency plans** reach only `/oracle/chat` and `/oracle/session/:id/(approval|history|events)`, on one fixed session per account, and cannot use the legacy tool gate.
10. **Unattended runs** (none in slice 1 use tools) see read, non-paid tools only.

## Known limits (slice 1)

- The honesty filter is today's: it redacts figures about the user, the site under discussion or a named site. A general sentence with a figure about unnamed third parties ("rivals get N visits") is not redacted, in this mode or in the old one.
- Browser tools, deep research (RLM) and the learning loop are not wired here yet (Blueprint section 11).
