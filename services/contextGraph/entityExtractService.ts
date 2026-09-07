import { BusinessDNA, ContextGraphNode } from '../../types';
import { contextGraphStore } from './contextGraphStore';
import { provenanceService } from './provenanceService';
import { vfsMemoryService } from '../vfs/vfsMemoryService';

export interface AuditIngestPayload {
  url: string;
  focus: string;
  text: string;
  sources?: Array<{ uri: string; title: string }>;
  dnaName?: string;
}

function extractCompetitorMentions(text: string, known: string[]): string[] {
  const found: string[] = [];
  for (const c of known) {
    if (c && text.toLowerCase().includes(c.toLowerCase())) found.push(c);
  }
  // Heuristic: lines with "competitor" nearby
  const lines = text.split(/\n/);
  for (const line of lines) {
    if (/competitor/i.test(line)) {
      const m = line.match(/\*\*([^*]+)\*\*/);
      if (m && m[1].trim().length > 1 && m[1].trim().length < 60) {
        found.push(m[1].trim());
      }
    }
  }
  return Array.from(new Set(found));
}

function extractHeadings(text: string): string[] {
  return text
    .split(/\n/)
    .filter(l => /^#{1,3}\s+/.test(l))
    .map(l => l.replace(/^#{1,3}\s+/, '').trim())
    .filter(h => h.length > 2 && h.length < 80)
    .slice(0, 12);
}

class EntityExtractService {
  public fromBusinessDNA(dna: BusinessDNA): {
    nodes: ContextGraphNode[];
    edgesCreated: number;
  } {
    const nodes: ContextGraphNode[] = [];
    let edgesCreated = 0;

    const org = contextGraphStore.upsertNode({
      type: 'Organization',
      label: dna.name || 'Unknown Brand',
      properties: {
        mission: dna.mission || '',
        usp: dna.usp || '',
        rawContext: dna.rawContext || ''
      },
      provenance: {
        source: 'business_dna',
        extractor: 'entityExtractService.fromBusinessDNA',
        confidence: 1,
        recordedAt: Date.now()
      }
    });
    nodes.push(org);
    provenanceService.track(org.id, 'business_dna', 'entityExtractService.fromBusinessDNA', 1);

    if (dna.targetAudience) {
      const aud = contextGraphStore.upsertNode({
        type: 'Audience',
        label: dna.targetAudience.slice(0, 80),
        properties: { description: dna.targetAudience },
        provenance: {
          source: 'business_dna',
          extractor: 'entityExtractService.fromBusinessDNA',
          confidence: 0.95,
          recordedAt: Date.now()
        }
      });
      nodes.push(aud);
      if (contextGraphStore.addEdge({ fromId: org.id, toId: aud.id, edgeType: 'targets' })) {
        edgesCreated++;
      }
    }

    if (dna.usp) {
      const offering = contextGraphStore.upsertNode({
        type: 'Offering',
        label: dna.usp.slice(0, 80),
        properties: { usp: dna.usp },
        provenance: {
          source: 'business_dna',
          extractor: 'entityExtractService.fromBusinessDNA',
          confidence: 0.9,
          recordedAt: Date.now()
        }
      });
      nodes.push(offering);
      if (contextGraphStore.addEdge({ fromId: org.id, toId: offering.id, edgeType: 'offers' })) {
        edgesCreated++;
      }
    }

    for (const c of dna.competitors || []) {
      if (!c.trim()) continue;
      const comp = contextGraphStore.upsertNode({
        type: 'Competitor',
        label: c.trim(),
        properties: { name: c.trim() },
        provenance: {
          source: 'business_dna',
          extractor: 'entityExtractService.fromBusinessDNA',
          confidence: 0.9,
          recordedAt: Date.now()
        }
      });
      nodes.push(comp);
      if (contextGraphStore.addEdge({ fromId: org.id, toId: comp.id, edgeType: 'competes_with' })) {
        edgesCreated++;
      }
    }

    for (const g of dna.perceivedGaps || []) {
      if (!g.trim()) continue;
      const gap = contextGraphStore.upsertNode({
        type: 'Gap',
        label: g.trim().slice(0, 80),
        properties: { description: g.trim() },
        provenance: {
          source: 'business_dna',
          extractor: 'entityExtractService.fromBusinessDNA',
          confidence: 0.85,
          recordedAt: Date.now()
        }
      });
      nodes.push(gap);
      if (contextGraphStore.addEdge({ fromId: org.id, toId: gap.id, edgeType: 'related_to' })) {
        edgesCreated++;
      }
    }

    // Mirror entities into VFS memory
    try {
      vfsMemoryService.addMemoryItem(
        'entities',
        `KG Org: ${org.label}`,
        `Organization node ${org.id}\nMission: ${dna.mission}\nUSP: ${dna.usp}`,
        ['context-graph', 'organization'],
        'STRATEGY'
      );
    } catch {
      /* vfs optional */
    }

    return { nodes, edgesCreated };
  }

  public fromAuditReport(payload: AuditIngestPayload): {
    nodes: ContextGraphNode[];
    edgesCreated: number;
    orgId: string;
  } {
    const nodes: ContextGraphNode[] = [];
    let edgesCreated = 0;
    const brandLabel =
      payload.dnaName ||
      (() => {
        try {
          return new URL(payload.url).hostname.replace(/^www\./, '');
        } catch {
          return payload.url.slice(0, 64);
        }
      })();

    const org = contextGraphStore.upsertNode({
      type: 'Organization',
      label: brandLabel,
      properties: { url: payload.url, focus: payload.focus },
      provenance: {
        source: `audit:${payload.url}`,
        extractor: 'entityExtractService.fromAuditReport',
        confidence: 0.9,
        recordedAt: Date.now()
      }
    });
    nodes.push(org);
    provenanceService.track(org.id, `audit:${payload.url}`, 'entityExtractService.fromAuditReport', 0.9);

    let dnaCompetitors: string[] = [];
    try {
      const raw = localStorage.getItem('luminara_business_dna');
      if (raw) dnaCompetitors = (JSON.parse(raw) as BusinessDNA).competitors || [];
    } catch {
      /* ignore */
    }

    for (const c of extractCompetitorMentions(payload.text, dnaCompetitors)) {
      const comp = contextGraphStore.upsertNode({
        type: 'Competitor',
        label: c,
        properties: { mentionedIn: payload.url },
        provenance: {
          source: `audit:${payload.url}`,
          extractor: 'entityExtractService.fromAuditReport',
          confidence: 0.75,
          recordedAt: Date.now()
        }
      });
      nodes.push(comp);
      if (contextGraphStore.addEdge({ fromId: org.id, toId: comp.id, edgeType: 'competes_with' })) {
        edgesCreated++;
      }
    }

    for (const h of extractHeadings(payload.text)) {
      const finding = contextGraphStore.upsertNode({
        type: 'Finding',
        label: h,
        properties: { focus: payload.focus, url: payload.url },
        provenance: {
          source: `audit:${payload.url}`,
          extractor: 'entityExtractService.fromAuditReport',
          confidence: 0.7,
          recordedAt: Date.now()
        }
      });
      nodes.push(finding);
      if (contextGraphStore.addEdge({ fromId: org.id, toId: finding.id, edgeType: 'mentions' })) {
        edgesCreated++;
      }
    }

    for (const s of payload.sources || []) {
      const ev = contextGraphStore.upsertNode({
        type: 'Evidence',
        label: s.title || s.uri,
        properties: { uri: s.uri, title: s.title },
        provenance: {
          source: s.uri,
          extractor: 'entityExtractService.fromAuditReport',
          confidence: 0.95,
          recordedAt: Date.now()
        }
      });
      nodes.push(ev);
      if (contextGraphStore.addEdge({ fromId: org.id, toId: ev.id, edgeType: 'evidences' })) {
        edgesCreated++;
      }
    }

    return { nodes, edgesCreated, orgId: org.id };
  }

  public syncFromVfsEntities(): number {
    let count = 0;
    try {
      const items = vfsMemoryService.getMemoryItems('entities');
      for (const item of items) {
        contextGraphStore.upsertNode({
          type: 'Generic',
          label: item.title,
          properties: { uri: item.uri, summary: item.summaryL0 },
          provenance: {
            source: item.uri,
            extractor: 'entityExtractService.syncFromVfsEntities',
            confidence: 0.8,
            recordedAt: Date.now()
          }
        });
        count++;
      }
    } catch {
      /* ignore */
    }
    return count;
  }
}

export const entityExtractService = new EntityExtractService();
