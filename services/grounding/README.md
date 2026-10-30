# Grounding (GUI click models, PointerBench protocol)

## What this does

First-party stack for evaluating screenshot-click (computer-use) models on
PointerBench-style tasks. Lives under `services/grounding/` entirely:
protocol prompts, geometry scoring, a model gate, agentic zoom, and a CLI
(`npm run grounding:*`). This is a fallback for vision surfaces; it does not
replace DOM/Playwright tooling.

## Invariants

1. **Fixed 1024x768 absolute pixel frame.** `FRAME_WIDTH = 1024`,
   `FRAME_HEIGHT = 768` in `protocol.ts`; `assertFixedFrame` throws on any
   other size. No silent normalize or resize; zoom crops are resized back
   and remapped to the fixed frame before scoring (`agenticZoom.ts`).
2. **Planner / pointer split.** The planner emits language-only
   `PlannerIntent` and never click coordinates; `plannerEmittedCoordinates`
   rejects planner text that smuggles `\"point\":`/`\"bbox\":`/coord pairs
   (`plannerPointer.ts`). The pointer returns absolute geometry only.
3. **Per-subset gates.** Default bars in `gate.ts`: Sheets 0.70, Text 0.40,
   Pro 0.65, Luminara 0.70, plus a hard `textFloor` of 0.35. Vanity-bench-only
   candidates (e.g. ScreenSpot-Pro with no PointerBench Text) are rejected.
4. **Prefer DOM/Playwright when selectors exist.** Grounding is the fallback
   path for surfaces without reliable selectors (AGENTS.md line 37,
   specs/0006-gui-grounding.md).
5. **Scores are measured, never estimated.** Accuracy is `hits / n` from
   scored examples (`score.ts`); `macroAverage` is an arithmetic mean over total
   non-empty subsets, never a blended estimate. No fabricating numbers.
6. **Geometry is axis-aligned absolute pixels.** Points `[x, y]`, bboxes
   `[x0, y0, x1, y1]`, origin top-left. Eval uses point-in-bbox, asymmetric
   overlap (coverage >= 0.9, precision >= 0.7 defaults), or IoU >= 0.7.

## Stubbed vs live status today

- Live: protocol, scoring, gate, agentic zoom loop, seed dump, CLI, tests.
- The PointerBench dataset itself is fetched on demand (`npm run grounding:fetch`,
  clone + `huggingface-cli download` into gitignored `tmp/`); nothing bundled.
- DOM/accessibility-first automation (`services/browserAction/`) uses indexed DOM marks first and falls back to this PointerBench 1024x768 coordinate grounding stack via `services/browserAction/visionFallback.ts` (`resolvePointerBenchFallback`) when DOM targets are absent or stale (`target_not_found`, `stale_element`) after up to 2 DOM retries.

## Env vars

Read: none directly. The CLI uses local file paths only (`--gt`,
`--predictions`, `--write-seed`, `--json`).

## Key tests

- `tests/grounding.test.ts`: fixed-frame prompt, parse of noisy model text,
  point-in-bbox, asymmetric overlap, planner/pointer split, agentic zoom
  two-step loop, gate rejects vanity-only + dead-Text, Luminara surface seed
  perfect-score round trip, outside-target miss.

See `specs/0006-gui-grounding.md` and `docs/plans/gui-grounding-pointerbench.md`.
