import {
  ContextGraphCausalType,
  ContextGraphDecision,
  ContextGraphProvenance
} from '../../types';
import { contextGraphStore } from './contextGraphStore';

const DECISIONS_KEY = 'luminara_context_graph_decisions';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

class DecisionService {
  private decisions: ContextGraphDecision[] = [];
  private listeners: Array<() => void> = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(DECISIONS_KEY);
      this.decisions = raw ? JSON.parse(raw) : [];
    } catch {
      this.decisions = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(DECISIONS_KEY, JSON.stringify(this.decisions));
    } catch {
      /* ignore */
    }
    this.notify();
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  public listDecisions(): ContextGraphDecision[] {
    return [...this.decisions].sort((a, b) => b.createdAt - a.createdAt);
  }

  public getDecision(id: string): ContextGraphDecision | undefined {
    return this.decisions.find(d => d.id === id);
  }

  public recordDecision(input: {
    category: string;
    scenario: string;
    reasoning: string;
    outcome: string;
    confidence: number;
    metadata?: Record<string, string | number | boolean>;
    provenance?: ContextGraphProvenance;
  }): ContextGraphDecision {
    const id = `decision_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const decision: ContextGraphDecision = {
      id,
      category: input.category,
      scenario: input.scenario,
      reasoning: input.reasoning,
      outcome: input.outcome,
      confidence: Math.max(0, Math.min(1, input.confidence)),
      metadata: input.metadata,
      createdAt: Date.now()
    };

    this.decisions.unshift(decision);
    if (this.decisions.length > 2000) this.decisions = this.decisions.slice(0, 2000);

    contextGraphStore.upsertNode({
      id,
      type: 'Decision',
      label: `${input.category}: ${input.outcome}`,
      properties: {
        category: input.category,
        scenario: input.scenario,
        reasoning: input.reasoning,
        outcome: input.outcome,
        confidence: decision.confidence
      },
      provenance: input.provenance || {
        source: 'decision_service',
        extractor: 'decisionService.recordDecision',
        confidence: decision.confidence,
        recordedAt: Date.now()
      }
    });

    this.persist();
    return decision;
  }

  public addCausalLink(
    fromDecisionId: string,
    toDecisionId: string,
    relationshipType: ContextGraphCausalType = 'CAUSED'
  ): boolean {
    if (!this.getDecision(fromDecisionId) || !this.getDecision(toDecisionId)) {
      // Still allow if nodes exist as Decision type
      if (!contextGraphStore.getNode(fromDecisionId) || !contextGraphStore.getNode(toDecisionId)) {
        return false;
      }
    }
    const edge = contextGraphStore.addEdge({
      fromId: fromDecisionId,
      toId: toDecisionId,
      edgeType: relationshipType,
      provenance: {
        source: 'decision_service',
        extractor: 'decisionService.addCausalLink',
        confidence: 1,
        recordedAt: Date.now()
      }
    });
    return !!edge;
  }

  public traceChain(decisionId: string): {
    rootId: string;
    chain: ContextGraphDecision[];
    edgeTypes: string[];
  } {
    const chain: ContextGraphDecision[] = [];
    const edgeTypes: string[] = [];
    const visited = new Set<string>();
    let current = decisionId;

    while (current && !visited.has(current)) {
      visited.add(current);
      const d = this.getDecision(current);
      if (d) chain.unshift(d);
      else {
        const n = contextGraphStore.getNode(current);
        if (n) {
          chain.unshift({
            id: n.id,
            category: String(n.properties.category || n.type),
            scenario: String(n.properties.scenario || n.label),
            reasoning: String(n.properties.reasoning || ''),
            outcome: String(n.properties.outcome || n.label),
            confidence: Number(n.properties.confidence ?? 0.5),
            createdAt: n.createdAt
          });
        }
      }

      const inbound = contextGraphStore
        .listEdges()
        .find(
          e =>
            e.toId === current &&
            (e.edgeType === 'CAUSED' || e.edgeType === 'INFLUENCED' || e.edgeType === 'PRECEDENT_FOR')
        );
      if (!inbound) break;
      edgeTypes.unshift(inbound.edgeType);
      current = inbound.fromId;
    }

    return {
      rootId: chain[0]?.id || decisionId,
      chain,
      edgeTypes
    };
  }

  public findSimilar(query: string, maxResults = 5): Array<ContextGraphDecision & { score: number }> {
    const qTokens = tokenize(query);
    return this.listDecisions()
      .map(d => {
        const blob = tokenize(`${d.category} ${d.scenario} ${d.reasoning} ${d.outcome}`);
        return { ...d, score: jaccard(qTokens, blob) };
      })
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }
}

export const decisionService = new DecisionService();
