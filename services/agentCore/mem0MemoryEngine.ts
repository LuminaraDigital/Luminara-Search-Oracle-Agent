/**
 * Mem0-Inspired 4-Tier Memory Engine & Autonomous Delta Extractor
 * 
 * Clean-room implementation of Mem0's multi-level memory architecture:
 * 1. User Tier: Tone, preferences, technical literacy level
 * 2. Session Tier: Active thread context, follow-ups
 * 3. Agent Working Tier: Scratchpad between crew agents
 * 4. Domain / Entity Tier: Brand graph, competitor relationships, resolved issues
 * 
 * Features:
 * - Autonomous semantic delta pass (ADD, UPDATE, DELETE, NOOP)
 * - Conflict resolution (auto-resolves fixed schema gaps, updates competitor list)
 * - Zero external vector DB requirements; edge-native KV + IndexedDB/LocalStorage
 */

import {
  MemoryTier,
  MemoryFact,
  MemoryDelta,
  MemoryAction,
  MemoryRelation,
  MemoryRelationDelta,
  AuditStateGraphContext,
} from './types';

const STORAGE_KEY = 'luminara_mem0_facts_v1';
const RELATIONS_STORAGE_KEY = 'luminara_mem0_relations_v1';
const MAX_FACTS = 1000;
const MAX_RELATIONS = 1000;

export const HALF_LIFE_MAP: Record<MemoryTier, number> = {
  user: 90 * 86_400_000,
  domain_entity: 30 * 86_400_000,
  session: 2 * 3_600_000,
  agent_working: 30 * 60_000,
};

/**
 * Compute exponential recency decay score:
 * score(t) = confidence * 0.5^(delta_time / half_life)
 */
export function computeDecayScore(
  baseConfidence: number,
  updatedAt: number,
  tier: MemoryTier = 'domain_entity',
  halfLifeDaysOverride?: number
): number {
  const halfLifeMs = halfLifeDaysOverride
    ? halfLifeDaysOverride * 86_400_000
    : HALF_LIFE_MAP[tier] || 30 * 86_400_000;
  const elapsed = Math.max(0, Date.now() - updatedAt);
  const decay = Math.pow(0.5, elapsed / halfLifeMs);
  return Number((baseConfidence * decay).toFixed(4));
}

/**
 * Mem0 canonical extraction prompt schema
 */
export const MEM0_EXTRACTION_PROMPT_SCHEMA = `
You are an autonomous Memory & Relationship Extraction Engine following the Mem0 architecture.
Given an audit report or interaction transcript, extract:
1. "facts": Key-value attributes categorized by tier (user, session, agent_working, domain_entity).
2. "relations": Graph entity triplets (source, predicate, target) capturing competition, missing schemas, audience, or technical traits.

JSON Output Schema:
{
  "facts": [
    {
      "tier": "domain_entity",
      "entityId": "<domain or entity>",
      "key": "<attribute key>",
      "value": "<attribute value>",
      "action": "ADD" | "UPDATE" | "DELETE",
      "confidence": 0.0-1.0,
      "rationale": "<explanation>"
    }
  ],
  "relations": [
    {
      "source": "<entity A>",
      "predicate": "competes_with" | "lacks_schema" | "has_issue" | "targets_audience" | "authoritative_for" | "operates_in",
      "target": "<entity B>",
      "action": "ADD" | "UPDATE" | "DELETE",
      "confidence": 0.0-1.0
    }
  ]
}
`.trim();

class Mem0MemoryEngine {
  private facts: MemoryFact[] = [];
  private relations: MemoryRelation[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  private canStorage(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem('__mem0_probe__', '1');
      localStorage.removeItem('__mem0_probe__');
      return true;
    } catch {
      return false;
    }
  }

  private load(): void {
    if (!this.canStorage()) return;
    try {
      const rawFacts = localStorage.getItem(STORAGE_KEY);
      if (rawFacts) {
        const parsed = JSON.parse(rawFacts);
        if (Array.isArray(parsed)) {
          this.facts = parsed;
        }
      }
    } catch {
      this.facts = [];
    }

    try {
      const rawRelations = localStorage.getItem(RELATIONS_STORAGE_KEY);
      if (rawRelations) {
        const parsedRel = JSON.parse(rawRelations);
        if (Array.isArray(parsedRel)) {
          this.relations = parsedRel;
        }
      }
    } catch {
      this.relations = [];
    }
  }

  private save(): void {
    if (!this.canStorage()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.facts.slice(-MAX_FACTS)));
      localStorage.setItem(RELATIONS_STORAGE_KEY, JSON.stringify(this.relations.slice(-MAX_RELATIONS)));
    } catch {
      /* ignore storage quota errors */
    }
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {
        /* listener error */
      }
    });
  }

  /**
   * Search / retrieve facts by tier and entity ID with optional recency decay calculation
   */
  public getFacts(options?: {
    tier?: MemoryTier;
    entityId?: string;
    query?: string;
    applyDecay?: boolean;
    minDecayedScore?: number;
    halfLifeDaysOverride?: number;
  }): MemoryFact[] {
    let result = [...this.facts];
    if (options?.tier) {
      result = result.filter((f) => f.tier === options.tier);
    }
    if (options?.entityId) {
      const needle = options.entityId.toLowerCase();
      result = result.filter((f) => f.entityId.toLowerCase() === needle);
    }
    if (options?.query) {
      const q = options.query.toLowerCase();
      result = result.filter(
        (f) =>
          f.key.toLowerCase().includes(q) ||
          f.value.toLowerCase().includes(q) ||
          f.entityId.toLowerCase().includes(q)
      );
    }

    // Attach recency decay score
    result = result.map((fact) => ({
      ...fact,
      decayedScore: computeDecayScore(
        fact.confidence,
        fact.updatedAt,
        fact.tier,
        options?.halfLifeDaysOverride
      ),
    }));

    if (options?.minDecayedScore !== undefined) {
      const min = options.minDecayedScore;
      result = result.filter((f) => (f.decayedScore ?? f.confidence) >= min);
    }

    if (options?.applyDecay) {
      result.sort((a, b) => (b.decayedScore ?? b.confidence) - (a.decayedScore ?? a.confidence));
    }

    return result;
  }

  /**
   * Apply an explicit memory delta
   */
  public applyDelta(delta: MemoryDelta): MemoryFact | null {
    const existingIndex = this.facts.findIndex(
      (f) => f.tier === delta.tier && f.entityId.toLowerCase() === delta.entityId.toLowerCase() && f.key === delta.key
    );

    const now = Date.now();

    if (delta.action === 'DELETE') {
      if (existingIndex !== -1) {
        const removed = this.facts[existingIndex];
        this.facts.splice(existingIndex, 1);
        this.save();
        return removed;
      }
      return null;
    }

    if (delta.action === 'UPDATE' || delta.action === 'ADD') {
      if (existingIndex !== -1) {
        this.facts[existingIndex] = {
          ...this.facts[existingIndex],
          value: delta.value,
          confidence: delta.confidence,
          updatedAt: now,
        };
        this.save();
        return this.facts[existingIndex];
      } else {
        const newFact: MemoryFact = {
          id: `fact-${now}-${Math.random().toString(36).slice(2, 7)}`,
          tier: delta.tier,
          entityId: delta.entityId,
          key: delta.key,
          value: delta.value,
          confidence: delta.confidence,
          createdAt: now,
          updatedAt: now,
        };
        this.facts.push(newFact);
        this.save();
        return newFact;
      }
    }

    return null;
  }

  // ==========================================================================
  // Entity-Relation Graph Triplet Layer
  // ==========================================================================

  public getRelations(options?: {
    source?: string;
    predicate?: string;
    target?: string;
    minConfidence?: number;
    applyDecay?: boolean;
  }): MemoryRelation[] {
    let result = [...this.relations];
    if (options?.source) {
      const s = options.source.toLowerCase();
      result = result.filter((r) => r.source.toLowerCase() === s);
    }
    if (options?.predicate) {
      const p = options.predicate.toLowerCase();
      result = result.filter((r) => r.predicate.toLowerCase() === p);
    }
    if (options?.target) {
      const t = options.target.toLowerCase();
      result = result.filter((r) => r.target.toLowerCase() === t);
    }

    result = result.map((r) => ({
      ...r,
      decayedScore: computeDecayScore(r.confidence, r.updatedAt, 'domain_entity'),
    }));

    if (options?.minConfidence !== undefined) {
      const min = options.minConfidence;
      result = result.filter((r) => (r.decayedScore ?? r.confidence) >= min);
    }

    if (options?.applyDecay) {
      result.sort((a, b) => (b.decayedScore ?? b.confidence) - (a.decayedScore ?? a.confidence));
    }

    return result;
  }

  public addRelation(
    relation: Omit<MemoryRelation, 'id' | 'createdAt' | 'updatedAt' | 'decayedScore'> & {
      id?: string;
      createdAt?: number;
      updatedAt?: number;
    }
  ): MemoryRelation {
    const s = relation.source.toLowerCase();
    const p = relation.predicate.toLowerCase();
    const t = relation.target.toLowerCase();
    const now = Date.now();

    const existingIndex = this.relations.findIndex(
      (r) => r.source.toLowerCase() === s && r.predicate.toLowerCase() === p && r.target.toLowerCase() === t
    );

    if (existingIndex !== -1) {
      this.relations[existingIndex] = {
        ...this.relations[existingIndex],
        confidence: relation.confidence,
        updatedAt: now,
        metadata: { ...this.relations[existingIndex].metadata, ...relation.metadata },
      };
      this.save();
      return this.relations[existingIndex];
    }

    const newRel: MemoryRelation = {
      id: relation.id || `rel-${now}-${Math.random().toString(36).slice(2, 7)}`,
      source: s,
      predicate: p,
      target: t,
      confidence: relation.confidence,
      createdAt: relation.createdAt || now,
      updatedAt: now,
      metadata: relation.metadata,
    };
    this.relations.push(newRel);
    this.save();
    return newRel;
  }

  public deleteRelation(
    matcher: string | { source: string; predicate: string; target: string }
  ): boolean {
    let index = -1;
    if (typeof matcher === 'string') {
      index = this.relations.findIndex((r) => r.id === matcher);
    } else {
      const s = matcher.source.toLowerCase();
      const p = matcher.predicate.toLowerCase();
      const t = matcher.target.toLowerCase();
      index = this.relations.findIndex(
        (r) => r.source.toLowerCase() === s && r.predicate.toLowerCase() === p && r.target.toLowerCase() === t
      );
    }

    if (index !== -1) {
      this.relations.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  public applyRelationDelta(delta: MemoryRelationDelta): MemoryRelation | null {
    if (delta.action === 'DELETE') {
      this.deleteRelation({ source: delta.source, predicate: delta.predicate, target: delta.target });
      return null;
    }
    if (delta.action === 'ADD' || delta.action === 'UPDATE') {
      return this.addRelation({
        source: delta.source,
        predicate: delta.predicate,
        target: delta.target,
        confidence: delta.confidence,
        metadata: delta.metadata,
      });
    }
    return null;
  }

  /**
   * Autonomous Memory Delta Extractor: Runs after an audit or chat interaction
   * Automatically derives facts and graph relations from AuditStateGraphContext and resolves conflicts.
   */
  public extractAndSyncAuditContext(context: AuditStateGraphContext): MemoryDelta[] {
    const deltas: MemoryDelta[] = [];
    const domain = context.targetUrl.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (!domain) return deltas;

    // 1. Health Score Fact
    if (typeof context.healthScore === 'number' && context.healthScore > 0) {
      deltas.push({
        action: 'UPDATE',
        tier: 'domain_entity',
        entityId: domain,
        key: 'latest_health_score',
        value: String(context.healthScore),
        rationale: 'Updated from autonomous audit completion',
        confidence: 0.95,
      });
    }

    // 2. Citation Rate Fact
    if (typeof context.citationRatePercent === 'number') {
      deltas.push({
        action: 'UPDATE',
        tier: 'domain_entity',
        entityId: domain,
        key: 'ai_citation_rate',
        value: `${context.citationRatePercent}%`,
        rationale: 'Live empirical SERP citation rate measurement',
        confidence: 0.9,
      });
    }

    // 3. Competitors Extraction & Relations
    if (context.topCompetitors && context.topCompetitors.length > 0) {
      deltas.push({
        action: 'UPDATE',
        tier: 'domain_entity',
        entityId: domain,
        key: 'competitors_list',
        value: context.topCompetitors.join(', '),
        rationale: 'Discovered via SERP radar & competitive analysis',
        confidence: 0.88,
      });

      for (const comp of context.topCompetitors) {
        if (comp && comp.trim()) {
          this.addRelation({
            source: domain,
            predicate: 'competes_with',
            target: comp.trim().toLowerCase(),
            confidence: 0.88,
          });
        }
      }
    }

    // 4. Critical Findings & Schema Gaps
    const criticalFindings = context.findings.filter((f) => f.severity === 'critical');
    if (criticalFindings.length > 0) {
      deltas.push({
        action: 'UPDATE',
        tier: 'domain_entity',
        entityId: domain,
        key: 'unresolved_critical_gaps',
        value: criticalFindings.map((f) => f.title).join(' | '),
        rationale: 'Identified by Playbook Auditor & verified by Critic',
        confidence: 0.92,
      });

      for (const finding of criticalFindings) {
        this.addRelation({
          source: domain,
          predicate: 'lacks_schema',
          target: finding.title,
          confidence: 0.92,
        });
      }
    }

    // 5. Check if previously reported gaps were fixed
    const existingGapFact = this.facts.find(
      (f) => f.tier === 'domain_entity' && f.entityId.toLowerCase() === domain && f.key === 'unresolved_critical_gaps'
    );
    if (existingGapFact && criticalFindings.length === 0) {
      deltas.push({
        action: 'UPDATE',
        tier: 'domain_entity',
        entityId: domain,
        key: 'unresolved_critical_gaps',
        value: 'All prior critical gaps resolved',
        rationale: 'Playbook auditor confirmed zero critical vulnerabilities remaining',
        confidence: 0.95,
      });
      // Prune prior lacks_schema relations for this domain
      this.relations = this.relations.filter(
        (r) => !(r.source === domain && r.predicate === 'lacks_schema')
      );
      this.save();
    }

    // 6. Audience & Authoritative Relations
    const audience = context.dna?.targetAudience || (context.dna as any)?.audience;
    if (audience) {
      this.addRelation({
        source: domain,
        predicate: 'targets_audience',
        target: audience,
        confidence: 0.95,
      });
    }

    if (typeof context.citationRatePercent === 'number' && context.citationRatePercent >= 70) {
      this.addRelation({
        source: domain,
        predicate: 'authoritative_for',
        target: `${context.focus.toLowerCase()}_search`,
        confidence: 0.9,
      });
    }

    // Apply all generated deltas
    for (const d of deltas) {
      this.applyDelta(d);
    }

    return deltas;
  }

  /**
   * Format relevant facts and graph triplets as a concise context injection for AI prompts
   */
  public formatContextForAgent(entityId: string, _maxTokens = 600): string {
    const relevantFacts = this.getFacts({ entityId, applyDecay: true, minDecayedScore: 0.1 });
    const relevantRelations = this.getRelations({ source: entityId, applyDecay: true, minConfidence: 0.1 });

    if (relevantFacts.length === 0 && relevantRelations.length === 0) return '';

    const lines = [
      `[AUTONOMOUS BRAND MEMORY GRAPH | ${entityId.toUpperCase()}]`,
    ];

    if (relevantFacts.length > 0) {
      lines.push('Key Facts (Recency Decayed):');
      for (const f of relevantFacts) {
        const decayPct = Math.round((f.decayedScore ?? f.confidence) * 100);
        lines.push(`- ${f.key}: ${f.value} (Effective Confidence: ${decayPct}%)`);
      }
    }

    if (relevantRelations.length > 0) {
      lines.push('Graph Relationships:');
      for (const r of relevantRelations) {
        const decayPct = Math.round((r.decayedScore ?? r.confidence) * 100);
        lines.push(`- ${r.source} --[${r.predicate}]--> ${r.target} (Confidence: ${decayPct}%)`);
      }
    }

    lines.push('--------------------------------------------------');
    return lines.join('\n');
  }

  public clear(): void {
    this.facts = [];
    this.relations = [];
    this.save();
  }
}

export const mem0MemoryEngine = new Mem0MemoryEngine();
