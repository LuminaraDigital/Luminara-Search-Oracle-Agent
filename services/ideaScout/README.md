# Idea Scout rules

Pure card schema and continuum checks. The Worker mints and stores cards.

- A card has no percentage fields, no numeric metrics, and no `measured` badge. Page evidence is `fetched` or `not_measured`.
- Competitor URLs use the same public-hostname rules as Instant Audit.
- Continuum into Instant Audit requires a public hostname. A guest claim of `measured` is rejected. A `measured` status without evidence is rejected.
- Free hosted generation is 2 cards per UTC day. The Worker checks the hosted meter before fetch or the model. It claims the idea slot with a D1 compare-and-swap only after the card row is stored. A lost claim deletes the row and does not refund the hosted charge. Anonymous callers are not a client concern here: the Worker refuses them before fetch or model spend.
- One handoff links one Instant Audit. `takeContinuumLink` clears the id for the next audit. A successful link clears it. Telegram back, popstate, hash change, leaving Idea Scout, and opening Instant Audit without that handoff also clear it.
