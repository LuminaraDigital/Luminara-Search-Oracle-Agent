# Idea Scout rules

Pure card schema and continuum checks. The Worker mints and stores cards.

- A card has no percentage fields, no numeric metrics, and no `measured` badge. Page evidence is `fetched` or `not_measured`.
- Competitor URLs use the same public-hostname rules as Instant Audit.
- Continuum into Instant Audit requires a public hostname. A guest claim of `measured` is rejected. A `measured` status without evidence is rejected.
- Free hosted generation is 2 cards per UTC day. The Worker claims that slot with a D1 compare-and-swap only after the card row is stored, then spends the hosted meter. A failed insert does not spend either. Anonymous callers are not a client concern here: the Worker refuses them before fetch or model spend.
- One handoff links one Instant Audit. `takeContinuumLink` clears the id for the next audit. A successful link, leaving Idea Scout, or opening Instant Audit without that handoff also clears it.
