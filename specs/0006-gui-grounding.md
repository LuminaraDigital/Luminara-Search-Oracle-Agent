# GUI grounding (PointerBench playbook)

## Status

Accepted for computer-use / screenshot-click paths. Not a replacement for DOM/Playwright tools.

## Context

Planner LLMs can say "click Submit" while still missing the pixel. Public GUI benches saturate and hide office-style failures (cells, carets, dense pro UI). Warmwind PointerBench measures that grounding step on Sheets, Text, and Pro.

## Decision

Ship a first-party grounding stack under `services/grounding/`:

1. Fixed protocol: 1024x768 absolute pixels, JSON `point` / `bbox`, no silent normalize/resize.
2. Planner / pointer split: planner emits intent only; pointer returns geometry only.
3. Per-subset scoring and a model gate that rejects vanity-bench-only claims and Text-floor failures.
4. Optional agentic zoom-crop-verify before the final click.
5. Private Luminara surface seed (same record shape) for product UI targets.

## Alternatives considered

- Trust ScreenSpot-Pro alone: saturates; weak signal for sheet/caret work.
- End-to-end VLM that plans and clicks in one call: harder to debug; smuggles coords into plans.
- DOM-only automation: preferred when selectors exist; grounding is the fallback for vision surfaces.

## Not in scope

Training a custom pointer weights release, bundling PointerBench PNGs in git, or claiming general computer-use competence from a high score.
