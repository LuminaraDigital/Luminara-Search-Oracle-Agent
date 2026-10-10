# Spec 0020: Luminara Dreaming (Business DNA Consolidation & Reflection Layer)

## Status
Approved / Implemented

## Context & Motivation
Luminara Suite audits organic rankings, AI Overview presence, ChatGPT citations, and Perplexity answers, producing prioritised recommendations and Weekly Decision cards. However, audits run as snapshot evaluations: repeated audits can re-recommend dismissed fixes, strategic pivots in business positioning (e.g. shifts in target audience or primary competitors) require manual re-entry, and lessons from prior successful fixes are not consolidated across runs.

Inspired by the Hermes Agent memory architecture, Luminara Dreaming adds a workspace-scoped memory consolidation and reflection layer directly above audits, recommendations, and chat interactions.

## Design

### 1. Ingestion Queue & Wake Gate (Non-LLM Shield)
To avoid unnecessary LLM calls and token spend on every click or minor page view, events are enqueued into `dream_events` and evaluated by a deterministic Wake Gate:
- **Deduplication**: Content hashes suppress duplicate audit payloads within a 15-minute window.
- **Signal Weighting**: Profile modifications (weight 2.5) and action outcomes (weight 2.0) wake faster than routine scrapes (weight 1.0).
- **Threshold Rule**: LLM consolidation is awakened only when accumulated signal score reaches 3.0, high-signal events occur, stale memories require pruning, or an explicit manual trigger (`Dream Now` or MCP `dream_consolidate`) is invoked.

### 2. The 5 Core Memory Types
Memories are workspace-scoped across 5 domains:
1. `business_dna`: Foundational company profile, mission, USP, priority competitors, and service regions.
2. `visibility_profile`: Empirically measured AI engine citation rates, recurring blindspots, and competitor citation moats.
3. `action_memory`: Recommendation outcomes: actions completed, dismissed, or proven effective.
4. `preference_memory`: Client communication style, reporting cadence, and strategic focus areas.
5. `evidence_memory`: High-confidence SERP citation quotes and schema markup snapshots.

### 3. Constrained Consolidation & Review Governance
The Dream Agent proposes at most 5 memory changes per run, enforcing:
- **Grounding**: Every proposal must cite source event IDs in `sourceRefs`.
- **Update over Duplicate**: Proposes updates to existing records rather than duplicating conflicting facts.
- **Three-Tier Policy**:
  - Auto-apply: Low-risk visibility metric refreshes and timestamp updates.
  - Pending review: Structural Business DNA changes (positioning, competitors, service areas) queue for user approval.
  - Reject: Proposals with confidence below 0.50 are discarded.
- **Rollback**: Every run snapshot preserves the exact previous state of mutated memories for one-click reversion.

### 4. Product Surface Integration
- **Audit Prompts**: `geminiService.ts` injects active Business DNA and consolidated memories into audit prompts.
- **Weekly Decision Loop**: `weeklyDecisionService.ts` checks `action_memory` to avoid suggesting dismissed interventions.
- **MCP Programmatic Access**: Free MCP tools (`dream_status`, `dream_consolidate`, `get_business_memory`, `review_dream_proposal`) provide programmatic access for external IDE agents.
- **User Interface**: `DreamingMemoryHub` provides an active memory matrix, review queue, "Why did Luminara remember this?" evidence drawer, and run timeline.

## Alternatives Considered
- *Unconstrained Vector Storage (Mem0 only)*: Unfiltered raw LLM extractions written to vector databases suffered from memory drift and lack of auditability. The Wake Gate and proposal review model ensures grounded, user-audited facts.
- *Single Monolithic Business DNA Record*: A single blob makes incremental updates difficult to trace. Partitioning into 5 typed records with versioned proposals enables fine-grained approval and rollbacks.
