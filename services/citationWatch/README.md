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

The daily 08:00 UTC cron owns `citation_watch`. No second cron was added. The tick anchors `next_run_at` on the cron's scheduled time, so a late start does not skip the next fire. It pages through due watches, up to 500 in one fire. `CITATION_WATCH_LIVE` must be the string `true` or neither the tick nor `POST /citation-watches/:id/run` writes a run. A manual run also requires the watch to be active, the plan to still allow that cadence, and `next_run_at` to be due. While the built-in probe is connected, a live run still stores `not_measured`. A probe may return `measured` only when each prompt was actually observed. Cadence on a watch cannot be faster than the plan's `scheduledReaudit`. The active-watch cap reuses that plan's Sentinel limit. Migration 0035 replaces the full unique index from 0034 with a partial index on `active = 1`, so a soft-deleted watch can be created again. A create response includes `warning` when the prompt set is shorter than `minPrompts`.

Share changes are compared with integer counts, so a delta that lands on the threshold stays `consistent`.

## Watch notes

Behind `WATCH_AGENT_ENABLED` (and `CITATION_WATCH_LIVE`), the tick writes a note after all probes are stored, for at most 50 runs per tick. `agentNote.ts` holds the rules; `runCitationWatchTick` applies them.

- A note is due when a run's state (verdict plus measurement status) differs from the previous run of the same watch, on the first measured run, and on the first failure after a measured run. `insufficient` to `consistent` counts. Repeated identical states, including repeated failures, write nothing.
- Code builds the numbers and picks the verdict sentence (up, down, same, first measured, check failed). The model writes only the action sentence, from the numbers and the previous note as fenced data, with no tools. The action is replaced by a fixed template if it has a number not in the numbers, a domain or capitalised name not in the watch's domain, engine names or prompts, or if the call fails or passes the 9 second timeout. A failed check never reads as "no change".
- The note is stored at `observations_json.agentNote` with `json_set` guarded by `json_extract(...) IS NULL`, so a retry cannot double-write. No migration. The evidence record and the privacy export select explicit columns and never include `observations_json`.
- Retry reads only each claimed watch's latest three run rows (never a table scan). A note failure never touches the run row or `next_run_at`.
