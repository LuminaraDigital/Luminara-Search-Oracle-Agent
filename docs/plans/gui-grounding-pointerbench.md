# GUI grounding playbook (PointerBench)

## Why

PointerBench asks: given a screenshot and an instruction, can the model point to the right place? A strong score is not general computer-use competence. It is the click-grounding gate for vision agents.

Upstream:

- https://github.com/warmwindOS/pointerbench
- https://huggingface.co/datasets/WarmwindOS/pointerbench
- https://about.warmwind.com/pointer-bench/

## What we shipped

| Piece | Path |
| --- | --- |
| Protocol + prompts | `services/grounding/protocol.ts` |
| Planner / pointer split | `services/grounding/plannerPointer.ts` |
| Agentic zoom | `services/grounding/agenticZoom.ts` |
| Score + asymmetric bbox | `services/grounding/score.ts`, `geometry.ts` |
| Model gate | `services/grounding/gate.ts` |
| Luminara surface seed | `services/grounding/surfaces.ts` |
| CLI | `services/grounding/cli.ts` |

## Commands

```bash
npm run grounding:prompt
npm run grounding:seed
npm run grounding:fetch
npm run grounding:gate -- --sheets 0.82 --text 0.48 --pro 0.77
npm run grounding:score -- --gt tests/fixtures/grounding/luminara-surfaces.jsonl --predictions tests/fixtures/grounding/luminara-perfect-preds.jsonl --required luminara
```

Download PointerBench into `tmp/pointerbench` (gitignored) via `npm run grounding:fetch`.

## Rules of use

1. Report Sheets / Text / Pro separately. Do not gate on a single average.
2. Enforce the Text floor. Sheet heroes with dead caret accuracy must not ship as click models.
3. Reject vanity-only claims (`--vanity-only` on the gate).
4. Prefer DOM/Playwright when stable selectors exist; use grounding for screenshot surfaces.
5. Do not train on the public PointerBench set if it is your held-out ruler.
