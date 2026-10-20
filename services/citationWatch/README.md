# Citation Watch

Scheduled, fixed prompt sets per account, client, domain, and engine. Each run is stored in D1 (`citation_watches`, `citation_watch_runs`, migration 0034). History is `GET /api/citation-watches/:id`.

## Verdicts

| Verdict | When | Counts |
| --- | --- | --- |
| `not_measured` | The run did not observe citations for the prompt set. | `citedCount`, `promptCount`, `share`, and `deltaShare` are null. |
| `insufficient` | The run was measured, and the prompt count is under `minPrompts`, or fewer than `minPriorRuns` earlier measured runs met `minPrompts`. | Share is the measured share. No change call. |
| `consistent` | Measured, enough history, and the absolute share change from the latest qualifying run is at or under `maxConsistentShareDelta`. | Share and delta are stored. |
| `drift` | Measured, enough history, and the absolute share change is above the threshold. | Share and delta are stored. |

Share is cited prompts divided by prompts in that run. It is not a blended SEO score. An estimated model completion is not a measured citation. The built-in probe does not call an engine.

## Defaults

These sit above typical small-sample flips. They are policy defaults, not a measured calibration. Override with the Worker var `CITATION_WATCH_THRESHOLDS`, a JSON object keyed by `chatgpt`, `google_aio`, and `perplexity`. A bad field keeps that default. `maxConsistentShareDelta` must be greater than 0 and at most 1.

| Engine | minPrompts | minPriorRuns | maxConsistentShareDelta |
| --- | --- | --- | --- |
| chatgpt | 8 | 2 | 0.30 |
| google_aio | 8 | 2 | 0.25 |
| perplexity | 8 | 2 | 0.20 |

## Schedule

The daily 08:00 UTC cron owns `citation_watch`. No second cron was added. `CITATION_WATCH_LIVE` must be the string `true` or the tick writes nothing. While the built-in probe is connected, a live tick still stores `not_measured`. A probe may return `measured` only when each prompt was actually observed. Cadence on a watch cannot be faster than the plan's `scheduledReaudit`. The active-watch cap reuses that plan's Sentinel limit.
