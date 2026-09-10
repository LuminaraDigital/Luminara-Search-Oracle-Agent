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

import { MemoryTier, MemoryFact, MemoryDelta, MemoryAction, AuditStateGraphContext } from './types';

const STORAGE_KEY = 'luminara_mem0_facts_v1';
const MAX_FACTS = 1000;

class Mem0MemoryEngine {
  private facts: MemoryFact[] = [];
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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.facts = parsed;
        }
      }
    } catch {
      this.facts = [];
    }
  }

  private save(): void {
    if (!this.canStorage()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.facts.slice(-MAX_FACTS)));
    } catch {
      /* ignore */
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
   * Search / retrieve facts by tier and entity ID
   */
  public getFacts(options?: { tier?: MemoryTier; entityId?: string; query?: string }): MemoryFact[] {
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

  /**
   * Autonomous Memory Delta Extractor: Runs after an audit or chat interaction
   * Automatically derives facts from AuditStateGraphContext and resolves conflicts.
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

    // 3. Competitors Extraction
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
    }

    // Apply all generated deltas
    for (const d of deltas) {
      this.applyDelta(d);
    }

    return deltas;
  }

  /**
   * Format relevant facts as a concise context injection for AI prompts
   */
  public formatContextForAgent(entityId: string, maxTokens = 600): string {
    const relevant = this.getFacts({ entityId });
    if (relevant.length === 0) return '';

    const lines = [
      `[AUTONOMOUS BRAND MEMORY GRAPH | ${entityId.toUpperCase()}]`,
      ...relevant.map((f) => `- ${f.key}: ${f.value} (Confidence: ${Math.round(f.confidence * 100)}%)`),
      '--------------------------------------------------',
    ];
    return lines.join('\n');
  }

  public clear(): void {
    this.facts = [];
    this.save();
  }
}

export const mem0MemoryEngine = new Mem0MemoryEngine();
