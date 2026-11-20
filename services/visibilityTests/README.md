# Visibility Unit Tests

One yes/no question at a time about whether AI can find and describe a business. Every verdict has a plain `why`. Design record: `specs/0032-visibility-unit-tests.md`.

## Invariants

- **`score(raw)` is the only path to a verdict.** It is pure. A regrade runs it on the saved raw record and calls no provider.
- **Closed vocabulary.** Families: `presence`, `accuracy`, `citation`, `structure`. Tag kinds: `engine`, `suburb`, `service`, `intent`. Tags slice results and never change a verdict.
- **The headline is the mean of the families,** so adding tests to one family never changes its weight. Owners see counts, not a percentage.
- **Three results, not two.** `not_measured` is never a fail: a failed call, an unread website, or a fact on an answer that never mentioned the business. It is left out of the score and shown as a count.
- **A refusal fails presence and citation only.** It said nothing that could be right or wrong, so accuracy tests stay `not_measured`, as they do for an error or an empty answer. The scorecard counts refusals and errors.
- **Own-model answers stay estimates.** `byok_probe` is the owner's model through a plain API call, not what people see in ChatGPT, Perplexity or AI Overviews. Do not label them measured.
- **Client-collected evidence is never a receipt.** The browser collects raw answers, so the Worker grades them for the account's own use. They must not feed signed receipts, attestations or public scores.
- **Expected facts are the owner's.** Only `factsConfirmedAt` on Business DNA makes a test `dna_confirmed`. Saving a changed graded detail or a new scan clears it. The audit view unmounts when the owner leaves, so a past report reopens the newest saved run for its website, and Check again uses the current facts. Anything else reads as Estimated.
- **Web search is never called AI.** `search` answers read as Search results in every label and reason.
- **Own keys spend only from the button.** Audit-time checks reuse rows the audit already collected. `askOwnModels` runs only from Ask my AI accounts and the card states how many questions it sends. It uses OpenRouter only: `GroqProvider` rotates to a fallback key that may be hosted, and it walks to other models. Do not add a provider with a fallback here.
- **Costs are reported or null.** Cost is what OpenRouter reports for the call. There is no rate table, because one flat rate misstated models by an order of magnitude. Unknown cost is `null`, never 0, and the scorecard counts how many answers have none.
- **A question with the name in it proves nothing about being found.** `asksByName` makes Presence and Citation `not_measured` on those answers, and accuracy is still graded there. Presence comes from `discoveryQuestion`, which never names the business and needs a service in Business DNA. The audit runs it as one extra search, kept out of citation rate and share of voice.
- **Raw is private.** Raw answers live in R2 and never leave through a route, a share link or MCP. The only exits are the owner's privacy export and the regrade. A share link carries `passList`: presence, citation and website-label checks that passed on every answer. The Worker builds it from the account's own verdict rows, so a client cannot publish checks that never passed, and own-model answers never appear there because they are estimates. Fact and claim labels quote the owner's private words and never qualify.
- **Retention follows the plan's audit history depth.** Audit runs and own-model runs each have that depth, so own-model presses cannot push out an audit. Past it, raw goes first. If that delete fails the row stays, so the next save retries. Saves and regrades also have a daily ceiling, because each writes to R2 and D1.
- **Erase removes raw before rows,** because the keys live on the rows. A failed raw delete stops the erase so a retry can find them. Export carries the newest raw records, up to 25 and 12 MB, and counts the rest.

## Storage

Verdict rows are in D1 (migration 0059). This is D1 only: unlike audit history it has no Firestore mirror. Raw is in the optional `AUDIT_EVIDENCE` R2 bucket at `visibility-raw/<run id>.json`. With no bucket, verdicts still save, `canRegrade` is false, and regrade returns 409 `RAW_NOT_STORED`.

## Adding a test type

Add it to `VisibilityTestType` and `FAMILY_BY_TYPE`, add a case in `gradeAnswer` or `gradeSite`, and bump `SCORER_VERSION` when a saved run could grade differently. Add an `evals/visibility` case.
