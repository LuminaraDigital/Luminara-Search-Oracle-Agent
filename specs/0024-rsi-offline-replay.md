# Spec 0024: Offline replay before a strategy goes live

## Status
Proposed / implemented behind the RSI session routes. Stacked on fix-outcome logging. Not merged.

## Context
Audit, probe, and ranking strategies are expensive to try on a live site. A new strategy should be scored on runs that already happened before it replaces the one in use.

## Design
Each logged run is a replay node: domain, kind (`audit`, `probe`, or `ranking`), strategy id, cost, and an outcome score. `not_measured` stores no score and does not enter the mean.

`POST /rsi/replay/select` scores the current strategy and the candidates on that log. The current strategy is always in the set. A candidate is enabled only when both sides have at least 3 measured runs and the candidate mean is strictly higher. Otherwise the current strategy stays, including when its own history is still `not_measured`. One enable per domain and kind per ISO week. A pinned slot does not change.

This is the replay idea only. It is not an implementation of Dream-RSI.

## Attribution
Zheng et al., "Dream-RSI: Recursive Self-Improvement through Evolving Worlds", arXiv:2609.14858, https://arxiv.org/abs/2609.14858. That work has no licence we can reuse. Nothing from the paper's text, math, or code is copied. Luminara nodes are audit, probe, and ranking logs.

## Alternatives
- Re-run the audit for every candidate strategy. That spends the crawl again for an answer the log already has.
- Enable the highest mean even when it is below the current strategy. That can ship a regression. The current strategy remains a candidate so the enabled one is not worse on the measured log.
