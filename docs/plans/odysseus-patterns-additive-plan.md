# Odysseus Architectural Patterns: Additive Plan (Track OP)

**Status:** v1.0. Approved 2026-10-09. Additive and complementary to existing tracks.
**Date:** 2026-10-09
**Pattern source:** `odysseus-dev/odysseus` (Self-hosted AI workspace). Concepts, control loops, and architectural patterns only; clean-room TypeScript/React/Cloudflare Worker implementation; Luminara brand, SQLite/D1 schemas, and zero em dashes.
**Companions (binding):** `docs/plans/weekly-decision-loop-10x-ship.md` (WDL product spine), `docs/plans/kaito-patterns-additive-plan.md`, `specs/0017-trust-receipts.md`, APS invariants in `AGENTS.md`.

---

## 0. Verdict

### 0.1 The Core Insights

The Odysseus architecture addresses the fundamental friction points in autonomous agent execution, context exhaustion, evidence honesty, and deep research:
1. **IterResearch / Goal-Based Extraction**: Iterative Think -> Search -> Extract -> Synthesize loops. Rather than dumping raw crawled HTML into LLM context, it runs goal-based extraction isolating rationale, verbatim quotes, and claim summaries.
2. **Deterministic Evidence Ledger**: Prohibits agents from claiming task completion without verifying artifact existence, non-emptiness, header signatures, and tool validation. Unverified external effects are stamped `EXTERNAL_EFFECT_UNVERIFIED`.
3. **Cursor-Style Context Auto-Compaction**: Triggers at 85% of model context window, compiling conversation history into a structured 4-part summary (`User Goal`, `What Was Done`, `Current State`, `Next Steps`) with uniform multimodal image decimation.
4. **Teacher Escalation Flywheel**: Detects student model failures inline, escalates to a SOTA teacher model, and automatically synthesizes a new `SKILL.md` procedure so future runs execute locally.
5. **Zero-Dependency Editorial Dossier**: Generates self-contained, offline-safe single-file HTML reports with system typography, dark/light themes, and sticky TOC.
6. **Multi-Engine Perception Matrix**: Side-by-side comparative model perception and consensus/divergence extraction.

### 0.2 Non-Goals (Locked)

- No AGPL-3.0 code copying: 100% clean-room TypeScript and React implementation.
- No invented SEO metrics: unmeasured parameters remain `not_measured` or `unknown` in accordance with APS rules.
- No em dashes (U+2014) anywhere in copy or code comments. Use `-`, `:`, or `.`.
- No breaking changes to existing `services/visibility/` or `services/audit/` structures.
- Chat returns verdict + one action + report link, not full HTML novels.

---

## 1. Architectural Modules (Track OP)

### Module 1: Context Compactor & Multimodal Pruner (`services/oracle/contextCompactorService.ts`)
- Manages conversation context budgets.
- Auto-triggers when estimated token count exceeds 85% of model context limit.
- Prunes multimodal image payloads uniformly across history to prevent visual bloat.
- Formats structured 4-part summaries preserving paths, URLs, metrics, and decisions.

### Module 2: Deterministic Evidence Ledger (`services/audit/evidenceLedgerService.ts`)
- Records immutable tool events, HTTP response status, and SHA-256 payload digests.
- Enforces strict artifact usability (non-zero size, signature validation).
- Calculates deterministic `CompletionDecision` (`verified`, `satisfied`, `unverified`, `failed`).

### Module 3: Goal-Based Citation Scout (`services/visibility/citationScoutService.ts`)
- Bounded multi-round autonomous research loop.
- Extracts `rational`, `evidence`, and `summary` from cited competitor pages.
- Categorizes citation drivers: `pricing_transparency`, `technical_benchmark`, `schema_freshness`, `third_party_consensus`.

### Module 4: Zero-Dependency Visual Dossier (`services/reports/portableDossierService.ts`)
- Compiles audit data and citation graphs into a single-file, offline-functional HTML document.
- Zero remote scripts, CDN links, or external fonts.
- Includes sticky Table of Contents, prefers-color-scheme styles, and print media rules.

### Module 5: Teacher-Escalation Playbook Flywheel (`services/oracle/teacherEscalationService.ts`)
- Identifies student model failures or unsupported tool actions.
- Inline escalation to SOTA teacher endpoint.
- Produces a corrective answer and drafts a new methodology playbook skill for `.claude/skills/`.

### Module 6: Perception Matrix (`components/visibility/PerceptionMatrix.tsx`)
- Visual cross-engine perception breakdown (ChatGPT Search, Perplexity, Google AIO, Claude).
- Highlights consensus insights and divergence points for executive review.
