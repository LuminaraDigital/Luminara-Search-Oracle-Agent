import { ContextGraphProvenance } from '../../types';
import { contextGraphStore } from './contextGraphStore';

const PROV_KEY = 'luminara_context_graph_provenance';

export interface ProvenanceRecord {
  entityId: string;
  entries: ContextGraphProvenance[];
}

class ProvenanceService {
  private trails = new Map<string, ContextGraphProvenance[]>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(PROV_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, ContextGraphProvenance[]>;
      this.trails = new Map(Object.entries(obj));
    } catch {
      this.trails.clear();
    }
  }

  private persist(): void {
    try {
      const obj: Record<string, ContextGraphProvenance[]> = {};
      for (const [k, v] of this.trails) obj[k] = v;
      localStorage.setItem(PROV_KEY, JSON.stringify(obj));
    } catch {
      /* ignore */
    }
  }

  public track(
    entityId: string,
    source: string,
    extractor: string,
    confidence = 0.9,
    metadata?: Record<string, string | number | boolean>
  ): ContextGraphProvenance {
    const entry: ContextGraphProvenance = {
      source,
      extractor,
      confidence,
      recordedAt: Date.now(),
      metadata
    };
    const list = this.trails.get(entityId) || [];
    list.unshift(entry);
    this.trails.set(entityId, list.slice(0, 50));
    this.persist();

    const node = contextGraphStore.getNode(entityId);
    if (node) {
      contextGraphStore.upsertNode({
        id: entityId,
        type: node.type,
        label: node.label,
        properties: node.properties,
        provenance: entry
      });
    }
    return entry;
  }

  public getTrail(entityId: string): ContextGraphProvenance[] {
    return [...(this.trails.get(entityId) || [])];
  }

  public listAll(): ProvenanceRecord[] {
    return Array.from(this.trails.entries()).map(([entityId, entries]) => ({
      entityId,
      entries
    }));
  }

  public exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: Date.now(),
        trails: this.listAll()
      },
      null,
      2
    );
  }
}

export const provenanceService = new ProvenanceService();
