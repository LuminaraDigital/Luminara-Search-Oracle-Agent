import { HybridRetrieveHit, HybridRetrieveResult } from '../../types';
import { contextGraphStore } from './contextGraphStore';
import { decisionService } from './decisionService';
import { vfsRetrievalService } from '../vfs/vfsRetrievalService';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function scoreText(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;
  const blob = new Set(tokenize(text));
  let hits = 0;
  for (const t of queryTokens) if (blob.has(t)) hits++;
  return hits / queryTokens.length;
}

class HybridRetrieve {
  public query(query: string, options?: { vfsBudget?: number; maxHits?: number }): HybridRetrieveResult {
    const start = Date.now();
    const maxHits = options?.maxHits ?? 12;
    const qTokens = tokenize(query);
    const hits: HybridRetrieveHit[] = [];

    for (const n of contextGraphStore.listNodes()) {
      const text = `${n.label} ${n.type} ${JSON.stringify(n.properties)}`;
      const score = scoreText(qTokens, text);
      if (score <= 0) continue;
      const neighbors = contextGraphStore.getNeighbors(n.id, 1);
      const boost = Math.min(0.2, neighbors.nodes.length * 0.02);
      hits.push({
        kind: 'graph',
        id: n.id,
        title: `[${n.type}] ${n.label}`,
        snippet: String(n.properties.mission || n.properties.description || n.properties.scenario || n.label).slice(0, 220),
        score: score + boost,
        meta: { type: n.type, neighborCount: neighbors.nodes.length }
      });
    }

    for (const d of decisionService.findSimilar(query, 5)) {
      hits.push({
        kind: 'graph',
        id: d.id,
        title: `[Decision] ${d.category}: ${d.outcome}`,
        snippet: d.scenario.slice(0, 220),
        score: d.score + 0.15,
        meta: { type: 'Decision', confidence: d.confidence }
      });
    }

    try {
      const vfs = vfsRetrievalService.retrieve(query, {
        tokenBudget: options?.vfsBudget ?? 1500,
        includeTrajectory: false
      });
      for (const m of vfs.matchedItems) {
        hits.push({
          kind: 'vfs',
          id: m.node.uri,
          title: `[VFS/${m.layer}] ${m.node.name}`,
          snippet: m.content.slice(0, 220),
          score: Math.min(1, m.score / 10),
          meta: { layer: m.layer, tokens: m.tokenCount }
        });
      }
    } catch {
      /* vfs optional */
    }

    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, maxHits);
    const assembledContext = top
      .map((h, i) => `${i + 1}. (${h.kind}, score=${h.score.toFixed(3)}) ${h.title}\n${h.snippet}`)
      .join('\n\n');

    return {
      query,
      hits: top,
      assembledContext,
      executionTimeMs: Date.now() - start
    };
  }
}

export const hybridRetrieve = new HybridRetrieve();
