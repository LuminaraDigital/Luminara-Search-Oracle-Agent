# Domain agent training mixture (external SLM)

**Status:** Guidance only (no datasets in git)  
**Date:** 2026-09-25  
**Product fit:** Luminara Suite remains an inference + MCP SaaS. Fine-tuning runs **outside** this repo.

## What to add in-product (done / keep here)

| Capability | Where | Why |
|---|---|---|
| Unified OpenAI tool-call export | `services/corpus/aeoCorpusService.ts` → `exportOpenAiToolTrajectories()` | Matches Hermes/xLAM/OpenManus message shape without bundling those datasets |
| Alpaca / ShareGPT exports | same service | Existing SFT formats for OracleMind Labs export |
| Honesty + agent evals | `evals/` | Product correctness, not model weights |
| PointerBench fetch | `services/grounding/` | Eval only; never train pointer weights in-app |

## From the offered HF / GitHub list: use outside this repo

Prioritize for an **AEO / research-agent** SLM (not "become Opus"):

1. **nvidia/Nemotron-Agentic-v1** - multi-turn tool selection (filter to research/API tools)
2. **NousResearch/hermes-function-calling-v1** - clean function-call syntax
3. **Salesforce/xlam-function-calling-60k** - broad API calling (convert to one schema)
4. **CharlieDreemur/OpenManus-RL** - ReAct + error recovery (drop household/OS unless you want that domain)
5. **open-r1/Mixture-of-Thoughts** - verified reasoning (keep concise traces)
6. **Domain fuel:** Luminara corpus exports (Alpaca + OpenAI tool trajectories) from customer audits

### Keep out of this git repo

- Full dataset downloads / `git clone` of OpenManus-RL into the product tree
- SWE-Lego / OpenHands coding trajectories (coding-agent product, wrong moat)
- Model weights, Axolotl/Unsloth pipelines, second `package.json` / Python training tree
- Mixed-license blobs without a license review (OpenManus-RL includes CC-BY-NC sources)

## Suggested external mixture (AEO agent)

```text
30%  Luminara OpenAI tool trajectories + Alpaca (domain)
25%  Nemotron-Agentic-v1 (filtered)
15%  Hermes + xLAM function calling (one schema)
15%  OpenManus-RL ReAct/error recovery (filtered)
10%  OpenR1 Mixture-of-Thoughts (verified, concise)
5%   Preference pairs (correct vs invented metrics / unsafe shell)
```

Convert every source to the same `messages` + `tool_calls` schema before SFT. Hold out validation per family.

## Production note

Hosted luminarasuite.com does **not** require this mixture to be production-ready. App Check, operator secrets, and honesty gates do. Training is an optional edge-SLM workstream.
