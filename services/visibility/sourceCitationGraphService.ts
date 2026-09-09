/**
 * Luminara Source Citation Graph: nodes/edges from audit sources + empirical cites.
 * Clean-room graph model (site-graph / GEO citation-graph ideas; no upstream code).
 */

import type { EmpiricalCitationSummary } from '../audit/empiricalCitationService';

export type SourceNodeKind = 'brand' | 'page' | 'external' | 'competitor' | 'query' | 'error';
export type SourceEdgeRel = 'cites' | 'ranks_for' | 'competes_on' | 'sourced_from';

export interface SourceGraphNode {
  id: string;
  label: string;
  url?: string;
  kind: SourceNodeKind;
  httpStatus?: number;
  weight: number;
}

export interface SourceGraphEdge {
  id: string;
  from: string;
  to: string;
  rel: SourceEdgeRel;
  weight: number;
}

export interface SourceCitationGraph {
  domain: string;
  measuredAt: number;
  nodes: SourceGraphNode[];
  edges: SourceGraphEdge[];
  stats: {
    brandCites: number;
    externalSources: number;
    competitorNodes: number;
    queryNodes: number;
  };
}

function nodeId(kind: string, key: string): string {
  return `${kind}:${key.toLowerCase().replace(/[^a-z0-9._:-]+/g, '_').slice(0, 80)}`;
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

export function buildSourceCitationGraph(input: {
  domain: string;
  sources?: Array<{ uri: string; title: string }>;
  empirical?: EmpiricalCitationSummary | null;
  measuredAt?: number;
}): SourceCitationGraph {
  const domain = extractHost(input.domain);
  const measuredAt = input.measuredAt ?? Date.now();
  const nodes = new Map<string, SourceGraphNode>();
  const edges: SourceGraphEdge[] = [];

  const upsert = (n: SourceGraphNode) => {
    const prev = nodes.get(n.id);
    if (!prev) {
      nodes.set(n.id, n);
      return;
    }
    nodes.set(n.id, { ...prev, weight: prev.weight + n.weight, label: prev.label || n.label });
  };

  const brandId = nodeId('brand', domain);
  upsert({ id: brandId, label: domain, url: `https://${domain}`, kind: 'brand', weight: 3 });

  for (const src of input.sources || []) {
    if (!src?.uri) continue;
    const host = extractHost(src.uri);
    const id = nodeId('ext', host || src.uri);
    upsert({
      id,
      label: src.title || host,
      url: src.uri,
      kind: host === domain ? 'page' : 'external',
      weight: 1,
    });
    edges.push({
      id: `e-src-${edges.length}`,
      from: brandId,
      to: id,
      rel: 'sourced_from',
      weight: 1,
    });
  }

  let brandCites = 0;
  for (const ev of input.empirical?.evidenceList || []) {
    const qId = nodeId('query', ev.query);
    upsert({ id: qId, label: ev.query, kind: 'query', weight: 1 });
    edges.push({
      id: `e-q-${edges.length}`,
      from: brandId,
      to: qId,
      rel: 'ranks_for',
      weight: ev.brandCited ? 2 : 1,
    });

    if (ev.brandCited && ev.citedUrl) {
      brandCites += 1;
      const host = extractHost(ev.citedUrl);
      const pageId = nodeId('page', ev.citedUrl);
      upsert({
        id: pageId,
        label: host,
        url: ev.citedUrl,
        kind: host === domain ? 'page' : 'external',
        weight: 2,
      });
      edges.push({
        id: `e-cite-${edges.length}`,
        from: qId,
        to: pageId,
        rel: 'cites',
        weight: 2,
      });
    }

    for (const comp of ev.competitorsCited) {
      const cId = nodeId('comp', comp);
      upsert({ id: cId, label: comp, kind: 'competitor', weight: 1 });
      edges.push({
        id: `e-comp-${edges.length}`,
        from: qId,
        to: cId,
        rel: 'competes_on',
        weight: 1,
      });
    }
  }

  const list = [...nodes.values()];
  return {
    domain,
    measuredAt,
    nodes: list,
    edges,
    stats: {
      brandCites,
      externalSources: list.filter((n) => n.kind === 'external').length,
      competitorNodes: list.filter((n) => n.kind === 'competitor').length,
      queryNodes: list.filter((n) => n.kind === 'query').length,
    },
  };
}

export const sourceCitationGraphService = {
  build: buildSourceCitationGraph,
};
