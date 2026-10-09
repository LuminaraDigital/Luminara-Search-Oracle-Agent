# Kaito Architectural Patterns: Additive Plan (Track KP)

**Status:** v1.0. Approved 2026-10-07. Additive and complementary to existing tracks.  
**Date:** 2026-10-07  
**Pattern source:** Kaito AI Documentation and Whitepaper (`https://docs.kaito.ai/overview/what-is-kaito`). Concepts and architectural patterns only; Luminara brand, SQLite/D1 tables, and clean copy.  
**Companions (binding):** `docs/plans/weekly-decision-loop-10x-ship.md` (WDL product spine), `docs/plans/zetachain-patterns-additive-plan.md`, `services/visibility/shareOfVoiceService.ts`, `services/visibility/sourceCitationGraphService.ts`, `services/visibility/llmAnswerProbeService.ts`, `specs/0017-trust-receipts.md`, APS invariants in `AGENTS.md`.

---

## 0. Verdict

### 0.1 The Core Insights

Kaito AI established market leadership in Web3 intelligence by solving information fragmentation across unstructured conversational networks (X/Twitter, Farcaster, Discord, Telegram, podcasts, governance forums) and formalizing **InfoFi (Information Finance)**:
1. **Vertical Multi-Source MetaSearch**: Indexing high-signal conversational platforms rather than just static HTML.
2. **Mindshare & Narrative Dynamics**: Quantifying % share of attention and its velocity (rate of change) across tokens, entities, and thematic narratives.
3. **Sentiment & Driver Attribution**: Uncovering the root causal drivers behind sentiment shifts (pricing changes, bug reports, feature launches).
4. **Catalyst Calendar**: Correlating major external and internal events with attention spikes and narrative rotations.
5. **Creator & Influence Graph (Studio)**: Matching brands to the highest-leverage distribution nodes with empirical attribution.

In Luminara Suite, these same patterns solve our primary user hurdles:
- **From Static SERP to Dynamic Mindshare**: Currently, Luminara calculates a single-snapshot Share of Voice. Kaito's Mindshare pattern allows Luminara to track **Brand Mindshare %** and **Narrative Velocity** over time across Answer Engines (ChatGPT, Perplexity, Google AI Overviews, Gemini).
- **Instant Citation Driver Attribution**: Instead of just telling the user "You were cited" or "You were not cited", Luminara isolates the *exact reason* (e.g., pricing transparency, documentation recency, missing Schema.org markup, third-party review consensus).
- **AEO Catalyst & Impact Timeline**: Connects user actions (deploying Schema, publishing comparison tables) and platform events (OpenAI search updates, Google Core updates) directly to changes in citations.
- **Authority Source Scout**: LLMs derive citations from a narrow set of citation hubs (Reddit, GitHub, review wikis, industry directories). Identifying these gives the user high-leverage external PR and citation targets.

### 0.2 Non-Goals (Locked)

- No token, no cryptocurrency, no emissions, no staking, no pay-to-boost rankings.
- No invented SEO or AEO metrics: unmeasured parameters remain `not_measured` or `estimated` according to APS rules.
- No em dashes (U+2014) anywhere in new copy or code comments. Use `-`, `:`, or `.`.
- No disruptive breaking changes: all additions build on existing `services/visibility/` and `services/audit/` structures.
- No full-text novels: chat and briefings return verdict + one action + report link.

---

## 1. The 5 Additive 10x Patterns

### Pattern 1: Brand & Narrative Mindshare Radar (`services/visibility/mindshareService.ts`)

#### Architectural Concept:
Instead of measuring a domain in a vacuum, measure its share of total conversational volume and thematic topic velocity across AI search queries.

```typescript
export interface NarrativeCluster {
  id: string;
  name: string; // e.g., 'Local-First Architecture', 'SOC2 Compliance', 'Open Source Pricing'
  velocityPercentWoW: number; // Rate of change in AI query frequency
  brandMindsharePercent: number; // What % of citations on this narrative cite our brand
  topCompetitor: {
    domain: string;
    mindsharePercent: number;
  };
  status: 'surging' | 'stable' | 'decaying';
}

export interface BrandMindshareSummary {
  domain: string;
  measuredAt: number;
  overallMindsharePercent: number;
  mindshareVelocityPercentWoW: number;
  engineBreakdown: Record<'chatgpt' | 'perplexity' | 'google_aio' | 'gemini', number>;
  narrativeClusters: NarrativeCluster[];
  primaryDriver: string;
}
```

#### User Experience Lift:
- Users immediately see which category topics are gaining momentum in AI answers and where they are losing citations to competitors.
- 1-Click Action: "Generate Playbook for Surging Narrative" directly links to Instant Audit or Idea Scout.

---

### Pattern 2: Citation Driver Attribution (`services/visibility/citationDriverService.ts`)

#### Architectural Concept:
Extends `llmAnswerProbeService` and `geminiService` to parse semantic drivers behind AI citations or omissions.

```typescript
export type CitationDriverType =
  | 'pricing_transparency'
  | 'schema_clarity'
  | 'documentation_freshness'
  | 'third_party_consensus'
  | 'security_compliance'
  | 'feature_parity'
  | 'unknown';

export interface CitationDriver {
  type: CitationDriverType;
  label: string; // Plain-English label: 'Competitor has public pricing table'
  impact: 'positive' | 'negative' | 'neutral';
  evidenceSnippet: string;
  recommendedActionId?: string; // Links directly to WDL action
}

export interface EmpiricalCitationWithDrivers {
  engine: string;
  query: string;
  brandCited: boolean;
  drivers: CitationDriver[];
}
```

#### User Experience Lift:
- Eliminates guesswork: instead of wondering why an LLM picked a competitor, the user gets a 3-bullet breakdown:
  1. *Competitor cited*: Explicit feature comparison table detected on their docs.
  2. *Brand omitted*: No pricing or FAQ schema found on the landing page.
- Direct link to WDL: 1-click commit to "Deploy FAQ Schema".

---

### Pattern 3: AEO Catalyst & Impact Timeline (`services/visibility/catalystService.ts`)

#### Architectural Concept:
Merges external industry/model events with internal brand execution milestones.

```typescript
export type CatalystOrigin = 'platform' | 'brand';

export interface AEOCatalyst {
  id: string;
  date: string; // YYYY-MM-DD
  origin: CatalystOrigin;
  title: string; // e.g., 'OpenAI Search Update' or 'Schema.org JSON-LD Deployed'
  description: string;
  impactObserved?: {
    metric: 'mindshare' | 'citation_rate' | 'health_score';
    deltaPercent: number;
  };
}
```

#### User Experience Lift:
- Chronological correlation: Shows a visual timeline proving that when the brand shipped a WDL action on Tuesday, citations on Perplexity shifted on Thursday.

---

### Pattern 4: Authority Source Scout (`services/visibility/authorityScoutService.ts`)

#### Architectural Concept:
Aggregates and ranks the third-party platforms, directories, communities, and review sites most frequently cited by Answer Engines in the user's category.

```typescript
export interface AuthoritySource {
  domain: string;
  category: 'community' | 'directory' | 'docs' | 'reviews' | 'publication';
  citationFrequencyPercent: number; // e.g., 72% of category queries cite this source
  brandPresent: boolean;
  presenceUrl?: string;
  leverageScore: 'high' | 'medium' | 'low';
}
```

#### User Experience Lift:
- Directs user attention where it matters most: "Perplexity cites Reddit and G2 for 80% of your category's queries. Establishing presence on these 2 sources is 5x more effective than publishing new blogs."

---

### Pattern 5: 1-Minute Executive Oracle Briefing (`services/oracle/executiveBriefingService.ts`)

#### Architectural Concept:
Synthesizes Mindshare, Citation Drivers, and Catalyst events into a strict 3-part executive briefing:

1. **Verdict**: Current Mindshare % and trend.
2. **Key Driver**: Primary factor driving changes this week.
3. **The One Action**: Highest-conviction action for the Weekly Decision Loop.

Can be called via web dashboard, Telegram Mini App bot push, or MCP (`get_executive_briefing`).

---

## 2. Implementation Roadmap

### Phase 1: Mindshare & Driver Extraction (Track KP-1)
- Create `services/visibility/citationDriverService.ts` to enrich empirical answer probes with driver classification.
- Add driver badges and plain-English reasons to `WeeklyDecisionCard.tsx` and `InstantAuditView.tsx`.

### Phase 2: Narrative Radar & Authority Scout (Track KP-2)
- Build `services/visibility/mindshareService.ts` and `services/visibility/authorityScoutService.ts`.
- Add Mindshare and Narrative tracking to the Dashboard and Competitor Watchlist.

### Phase 3: Catalyst Timeline & Executive Briefing (Track KP-3)
- Create `services/visibility/catalystService.ts` and link to `ShipCommitment` timestamps.
- Integrate 1-Minute Briefing into Oracle chat and MCP tools.

---

## 3. Quality Gates & Verification

Before merging any KP track changes:
1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. Verified absence of em dashes and invented metrics across all new files.
