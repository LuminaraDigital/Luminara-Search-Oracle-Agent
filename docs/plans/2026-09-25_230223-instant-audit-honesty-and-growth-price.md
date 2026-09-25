# Fix plan: Instant Audit honesty + Growth/Agency pricing labels

## Decisions locked (operator deferred to eng/business judgment, 2026-09-25)

1. **Keep both bugs in one PR.** Fake metrics on a guest CTA is a trust/brand P0. Broken Growth hero price is a conversion P0. Same PR, no artificial split.
2. **Pricing labels:** Growth `US$149`, Agency `US$349`. Anchored on Starter `US$49` and Stars ratios (3× / ~7.2×), rounded for SaaS pricing psychology. Keep Stars/TON sublines aligned with PaywallModal. Do not switch Growth to Stars-only while Starter shows USD.
3. **Do not expand** into ROI calculators, Labs surfaces, or full LLM-prose honesty in this PR. Track as a follow-on papercut/plan.
4. **Implementation after yes:** Cursor **cloud agent** on `LuminaraDigital/Luminara-Search-Oracle-Agent` (multi-file honesty work is non-trivial). Outcome-focused brief; this plan is the source of truth. Deploy still requires a separate explicit yes.
5. **Operator approval:** implementation approved 2026-09-25. Deploy remains blocked until a separate explicit yes.

## Goal

1. Guest Instant Audit (`#instant_audit`) must not show numeric SEO metrics or "ground-truth" completion copy when Firecrawl/Tavily/workspace providers fail (401/429/localhost). Use `not_measured` / `unknown` / null; never invent citation %, SOV, or health scores.
2. `/pricing` Growth and Agency cards must show numeric USD `priceLabel` values (`US$149` / `US$349`) instead of the plan name. Starter stays `US$49`.

Operator approved implementation on 2026-09-25. Deploy only after a separate explicit approval.

## Context and assumptions

- Live QA (2026-09-25): guest scout showed "100% COMPLETE" with ~45% citation / ~43 SOV / ~73 health while console had Firecrawl/Tavily 401s, localhost refusals, 429s. Growth card showed "Growth / 30 DAYS".
- Product rules (`AGENTS.md` APS honesty, `docs/plans/premium-craft-surface.md`): ban fake score fallbacks; missing data = `not_measured`. Visibility stack already has the right vocabulary (`engineVisibilityTypes.ts`); Instant Audit crew path ignores it.
- Payment rails are Stars/TON (PaywallModal). Pricing page is marketing labels; no Stripe IDs on that page. "Card checkout is coming."
- Locked commercial display: Starter `US$49` / 2,500 Stars; Growth `US$149` / 7,500 Stars; Agency `US$349` / 18,000 Stars.

## Approach and trade-offs

### Bug A - Instant Audit honesty (primary)

Root cause: crew pipeline seeds fake baselines and hardcodes fallbacks on empty evidence, then Mission Control treats "any report object + all agents completed" as "100% verified against ground-truth."

Minimal approach:

1. Make metrics nullable / `not_measured` in crew types.
2. Remove invention branches (especially SERP empty → 45%, orchestrator seeds 50/75, playbook empty → baseScore 85, gemini `?? 65`).
3. Propagate unmeasured through executive brief + attestation (skip or mark unmeasured).
4. Split UI copy: pipeline progress vs measurement quality.

Trade-off: broader honesty audit (ROI calculators, Labs, LLM prose inventing numbers) is **explicitly out of scope**; open a follow-on plan after this ships.

### Bug B - Growth + Agency price labels

`PricingPage.tsx`: set Growth and Agency `priceLabel` to locked USD. Keep Stars/TON sublines. Optional small shared constant next to tiers if it stays one file tidy.

Trade-off: a shared pricing module across PaywallModal + PricingPage is nicer later; not required to close the conversion hole.

## Bite-sized tasks

### A1 - Types

- Files: `services/agentCore/types.ts` (and any immediate consumers that assume `number`)
- Change: `citationRatePercent`, `shareOfVoiceScore`, `healthScore` → `number | null`; add `measurementStatus: 'measured' | 'not_measured'` (optional `measurementReason: string`)
- Expected: typecheck surfaces call sites to fix

### A2 - Stop seeding fakes

- File: `services/agentCore/crewOrchestrator.ts`
- Change: init metrics to `null` / `not_measured` (delete `50` / `50` / `75` seeds)
- Expected: initial context never looks "measured"

### A3 - SERP empty path

- File: `services/agentCore/agents/serpRadarAgent.ts`
- Change: when `totalItems === 0` or all probes failed, return null metrics + not_measured message; **delete** `: 45` fallback and derived SOV invent
- Expected: unit test with empty Tavily / no key → nulls

### A4 - Playbook health without evidence

- File: `services/agentCore/agents/playbookAuditorAgent.ts`
- Change: if scraped pages empty / zero wordCount and no SERP evidence, `healthScore: null` (do not start from 85)
- Expected: empty scrape → not_measured health

### A5 - Scout failure honesty

- File: `services/agentCore/agents/scoutAgent.ts`
- Change: total scrape failure → `failed` or completed-with-`not_measured` (no pretend successful crawl)
- Expected: Firecrawl 401 path does not look like a successful page fetch

### A6 - Executive + attestation

- Files: `services/agentCore/agents/executiveTranslatorAgent.ts`, attestation path in orchestrator / `tonAttestationService`
- Change: only cite numeric metrics when non-null; otherwise say not measured; skip or mark attestation unmeasured
- Expected: brief + badge do not stamp invented scores

### A7 - Mission Control copy

- Files: `components/audit/AgentMissionControl.tsx`, `components/audit/InstantAuditView.tsx`
- Change: when complete but metrics not_measured, copy like "Audit finished - some signals not measured"; remove "100% verified against ground-truth evidence" for that case. Keep pipeline `% COMPLETE` only if labeled as agent progress, not evidence quality
- Expected: UI regression with mocked not_measured report

### A8 - Gemini corpus fallback

- File: `services/geminiService.ts`
- Change: replace `empiricalSummary?.citationRatePercent ?? 65` with null / skip when missing
- Expected: no silent 65

### A9 - Tests

- Add/adjust unit tests: serpRadar empty; crew initial context; Mission Control copy; optional playbook empty
- Expected: targeted tests + typecheck green

### B1 - Pricing labels

- File: `components/PricingPage.tsx`
- Change: Growth `priceLabel: 'US$149'`; Agency `priceLabel: 'US$349'`; Starter unchanged
- Expected: both cards show `US$… / 30 days`; Stars sublines unchanged

### Ship shape

- Branch from `main`, open PR (never push to `main`)
- After operator yes: launch **Cursor cloud agent** with this plan as the brief (outcome-focused, not line-by-line micromanagement)
- Screenshots in PR: guest audit failure path + pricing Growth/Agency cards
- Run eng-verify / quality-gates before merge request
- Deploy: **blocked** until separate operator yes

## Critical files

1. `services/agentCore/crewOrchestrator.ts`
2. `services/agentCore/agents/serpRadarAgent.ts`
3. `services/agentCore/agents/playbookAuditorAgent.ts`
4. `services/agentCore/agents/scoutAgent.ts`
5. `components/audit/AgentMissionControl.tsx`
6. `components/PricingPage.tsx`
7. `services/agentCore/types.ts`

Also as needed: `executiveTranslatorAgent.ts`, `InstantAuditView.tsx`, `geminiService.ts` (read PaywallModal for Stars align only).

## Tests / verification

1. Force provider failure (no keys / mock 401): guest `#instant_audit` → no 45/50/75/65; UI not claiming ground-truth verified metrics; shows not_measured/unknown.
2. Happy path with live keys (manual or staging): numeric metrics only when evidence length > 0.
3. `/pricing`: Growth `US$149 / 30 days`, Agency `US$349 / 30 days`, Starter `US$49`.
4. Typecheck + targeted tests.
5. No deploy from this plan without explicit deploy approval.

## Follow-on (explicitly not this PR)

- Shared pricing constant module (PricingPage + PaywallModal)
- ROI / Labs / executive-prose honesty pass (LLM inventing numbers after metrics are fixed)
- Stripe card checkout

## Risks (accepted)

- Nullable health ripples into attestation / Brand Memory / PDF badge: keep attestation optional when unmeasured.
- Pipeline progress % can still confuse users if copy is weak: A7 must separate "agents finished" from "metrics verified."

## PR shape (after approval)

- Title: `fix: Instant Audit not_measured on provider failure; Growth/Agency USD price labels`
- Body: link this plan; before/after screenshots; note honesty APS
