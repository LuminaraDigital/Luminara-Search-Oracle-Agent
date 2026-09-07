import {
  ContextGraphEdge,
  ContextGraphNode,
  ContextGraphNodeType,
  ContextGraphEdgeType,
  ContextGraphProvenance,
  ContextGraphSnapshot,
  ContextGraphStats
} from '../../types';

const STORAGE_KEY = 'luminara_context_graph';
const MAX_NODES = 5000;
const SNAPSHOT_VERSION = 1;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'node';
}

function makeId(prefix: string, label: string): string {
  return `${prefix}_${slugify(label)}_${Math.random().toString(36).slice(2, 6)}`;
}

class ContextGraphStore {
  private nodes = new Map<string, ContextGraphNode>();
  private edges = new Map<string, ContextGraphEdge>();
  private listeners: Array<() => void> = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as ContextGraphSnapshot;
      this.nodes.clear();
      this.edges.clear();
      for (const n of snap.nodes || []) this.nodes.set(n.id, n);
      for (const e of snap.edges || []) this.edges.set(e.id, e);
    } catch {
      this.nodes.clear();
      this.edges.clear();
    }
  }

  private persist(): void {
    try {
      const snap: ContextGraphSnapshot = {
        version: SNAPSHOT_VERSION,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        decisions: [],
        updatedAt: Date.now()
      };
      // Decisions live in decisionService storage; keep snapshot nodes/edges only here.
      // Merge decisions from companion key if present for backup completeness.
      try {
        const dRaw = localStorage.getItem('luminara_context_graph_decisions');
        if (dRaw) snap.decisions = JSON.parse(dRaw);
      } catch {
        /* ignore */
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch {
      /* storage disabled */
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

  public clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.persist();
  }

  public getNode(id: string): ContextGraphNode | undefined {
    return this.nodes.get(id);
  }

  public listNodes(type?: ContextGraphNodeType): ContextGraphNode[] {
    const all = Array.from(this.nodes.values());
    const filtered = type ? all.filter(n => n.type === type) : all;
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public findNodesByLabel(query: string, limit = 20): ContextGraphNode[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.listNodes().slice(0, limit);
    return this.listNodes()
      .filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .slice(0, limit);
  }

  public upsertNode(
    input: {
      id?: string;
      type: ContextGraphNodeType;
      label: string;
      properties?: Record<string, string | number | boolean | string[]>;
      provenance?: ContextGraphProvenance;
    }
  ): ContextGraphNode {
    const now = Date.now();
    const existingByLabel = Array.from(this.nodes.values()).find(
      n => n.type === input.type && n.label.toLowerCase() === input.label.toLowerCase()
    );
    const id = input.id || existingByLabel?.id || makeId(input.type.toLowerCase(), input.label);

    const prev = this.nodes.get(id);
    const node: ContextGraphNode = {
      id,
      type: input.type,
      label: input.label,
      properties: { ...(prev?.properties || {}), ...(input.properties || {}) },
      provenance: input.provenance || prev?.provenance,
      createdAt: prev?.createdAt || now,
      updatedAt: now
    };

    this.nodes.set(id, node);
    this.pruneIfNeeded();
    this.persist();
    return node;
  }

  public addEdge(input: {
    fromId: string;
    toId: string;
    edgeType: ContextGraphEdgeType;
    weight?: number;
    properties?: Record<string, string | number | boolean>;
    provenance?: ContextGraphProvenance;
    id?: string;
  }): ContextGraphEdge | null {
    if (!this.nodes.has(input.fromId) || !this.nodes.has(input.toId)) return null;

    const dup = Array.from(this.edges.values()).find(
      e =>
        e.fromId === input.fromId &&
        e.toId === input.toId &&
        e.edgeType === input.edgeType
    );
    if (dup) return dup;

    const edge: ContextGraphEdge = {
      id: input.id || `edge_${input.edgeType}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      fromId: input.fromId,
      toId: input.toId,
      edgeType: input.edgeType,
      weight: input.weight ?? 1,
      properties: input.properties,
      provenance: input.provenance,
      createdAt: Date.now()
    };
    this.edges.set(edge.id, edge);
    this.persist();
    return edge;
  }

  public listEdges(): ContextGraphEdge[] {
    return Array.from(this.edges.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getNeighbors(nodeId: string, hops = 1): {
    nodes: ContextGraphNode[];
    edges: ContextGraphEdge[];
  } {
    const visited = new Set<string>([nodeId]);
    let frontier = new Set<string>([nodeId]);
    const edgeAcc: ContextGraphEdge[] = [];

    for (let h = 0; h < hops; h++) {
      const next = new Set<string>();
      for (const e of this.edges.values()) {
        if (frontier.has(e.fromId) && !visited.has(e.toId)) {
          next.add(e.toId);
          edgeAcc.push(e);
        } else if (frontier.has(e.toId) && !visited.has(e.fromId)) {
          next.add(e.fromId);
          edgeAcc.push(e);
        } else if (frontier.has(e.fromId) || frontier.has(e.toId)) {
          edgeAcc.push(e);
        }
      }
      next.forEach(id => visited.add(id));
      frontier = next;
    }

    visited.delete(nodeId);
    const nodes = Array.from(visited)
      .map(id => this.nodes.get(id))
      .filter((n): n is ContextGraphNode => !!n);

    const uniqueEdges = Array.from(new Map(edgeAcc.map(e => [e.id, e])).values());
    return { nodes, edges: uniqueEdges };
  }

  public getStats(): ContextGraphStats {
    const nodesByType: Record<string, number> = {};
    for (const n of this.nodes.values()) {
      nodesByType[n.type] = (nodesByType[n.type] || 0) + 1;
    }
    let decisionCount = 0;
    try {
      const dRaw = localStorage.getItem('luminara_context_graph_decisions');
      if (dRaw) decisionCount = (JSON.parse(dRaw) as unknown[]).length;
    } catch {
      decisionCount = this.listNodes('Decision').length;
    }
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      decisionCount,
      conflictCount: 0,
      nodesByType
    };
  }

  private pruneIfNeeded(): void {
    if (this.nodes.size <= MAX_NODES) return;
    const sorted = this.listNodes().sort((a, b) => a.updatedAt - b.updatedAt);
    const toRemove = sorted.slice(0, this.nodes.size - MAX_NODES);
    for (const n of toRemove) {
      this.nodes.delete(n.id);
      for (const [eid, e] of this.edges) {
        if (e.fromId === n.id || e.toId === n.id) this.edges.delete(eid);
      }
    }
  }
}

export const contextGraphStore = new ContextGraphStore();
export { slugify, makeId };
