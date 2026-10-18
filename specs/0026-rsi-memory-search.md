# Spec 0026: Cross-session memory search

## Status
Proposed / implemented behind the RSI session routes. Stacked on the posting agent. Not merged.

## Context
Past audits and chats were not searchable as one account history. Vector search in `worker/memoryRag.ts` covers memory facts. It does not search the audit and chat text a person chooses to index, and it does not suggest saving a brand fact into the client vault.

## Design
`POST /rsi/memory/documents` indexes one audit or chat document for the signed-in account. A title and a body are required. The index is explicit: audit runs store a focus, a domain, and a report reference, and chats are not a D1 transcript today.

`GET /rsi/memory/search?q=` loads the latest 300 documents for that account and ranks them by token overlap. A title match counts more than a body match. Tokens shorter than 2 characters are ignored. Documents from another account are not loaded.

When a chat hit states a brand fact (a USP, an offer, competitors, or an audience), the response includes a nudge with a title and a short summary. The worker does not write `brandMemoryVaultService`. The client calls `saveBrandFact` if the person accepts.

Search uses ordinary SQL plus scoring in the worker. It does not use FTS5, so D1 and the node sqlite test double run the same statements.

## Alternatives
- FTS5. A virtual table is more machinery than a 300-row scan, and it can diverge between D1 and the test double.
- Auto-save every matching sentence into the vault. A nudge the person accepts keeps the vault a deliberate record.
