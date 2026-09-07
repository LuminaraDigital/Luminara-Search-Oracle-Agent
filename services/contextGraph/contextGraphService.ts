import { BusinessDNA, ContextGraphCausalType } from '../../types';
import { contextGraphStore } from './contextGraphStore';
import { decisionService } from './decisionService';
import { provenanceService } from './provenanceService';
import { entityExtractService, AuditIngestPayload } from './entityExtractService';
import { conflictService } from './conflictService';
import { aeoRuleEngine } from './aeoRuleEngine';
import { hybridRetrieve } from './hybridRetrieve';
import { jsonLdExporter } from './jsonLdExporter';

const LAST_AUDIT_KEY = 'luminara_last_audit_report';
const GRAPH_AWARE_KEY = 'luminara_graph_aware_agents';

export interface LastAuditRecord {
  url: string;
  focus: string;
  text: string;
  sources?: Array<{ uri: string; title: string }>;
  dnaName?: string;
  savedAt: number;
}

class ContextGraphService {
  public subscribe(fn: () => void): () => void {
    const u1 = contextGraphStore.subscribe(fn);
    const u2 = decisionService.subscribe(fn);
    return () => {
      u1();
      u2();
    };
  }

  public getStats() {
    const stats = contextGraphStore.getStats();
    stats.conflictCount = conflictService.detectConflicts().length;
    return stats;
  }

  public listNodes(type?: Parameters<typeof contextGraphStore.listNodes>[0]) {
    return contextGraphStore.listNodes(type);
  }

  public listEdges() {
    return contextGraphStore.listEdges();
  }

  public getNode(id: string) {
    return contextGraphStore.getNode(id);
  }

  public getNeighbors(id: string, hops = 1) {
    return contextGraphStore.getNeighbors(id, hops);
  }

  public findNodes(query: string) {
    return contextGraphStore.findNodesByLabel(query);
  }

  public addEdge(fromId: string, toId: string, edgeType: Parameters<typeof contextGraphStore.addEdge>[0]['edgeType']) {
    return contextGraphStore.addEdge({ fromId, toId, edgeType });
  }

  public loadDna(): BusinessDNA | null {
    try {
      const raw = localStorage.getItem('luminara_business_dna');
      return raw ? (JSON.parse(raw) as BusinessDNA) : null;
    } catch {
      return null;
    }
  }

  public syncFromDna(dna?: BusinessDNA | null) {
    const d = dna || this.loadDna();
    if (!d) return { ok: false as const, message: 'No Business DNA found. Configure Business DNA first.' };
    const result = entityExtractService.fromBusinessDNA(d);
    const vfsCount = entityExtractService.syncFromVfsEntities();
    return {
      ok: true as const,
      message: `Synced DNA "${d.name}": ${result.nodes.length} nodes, ${result.edgesCreated} edges, ${vfsCount} VFS entities.`,
      ...result,
      vfsCount
    };
  }

  public saveLastAudit(payload: AuditIngestPayload): void {
    const record: LastAuditRecord = { ...payload, savedAt: Date.now() };
    try {
      localStorage.setItem(LAST_AUDIT_KEY, JSON.stringify(record));
    } catch {
      /* ignore */
    }
  }

  public getLastAudit(): LastAuditRecord | null {
    try {
      const raw = localStorage.getItem(LAST_AUDIT_KEY);
      return raw ? (JSON.parse(raw) as LastAuditRecord) : null;
    } catch {
      return null;
    }
  }

  public ingestAudit(payload?: AuditIngestPayload) {
    const data = payload || this.getLastAudit();
    if (!data) return { ok: false as const, message: 'No audit report available. Run Instant Audit first.' };

    const extracted = entityExtractService.fromAuditReport(data);
    const decision = decisionService.recordDecision({
      category: 'aeo_audit',
      scenario: `Instant Audit ${data.focus} for ${data.url}`,
      reasoning: `Ingested audit report (${data.text.length} chars) into context graph with ${extracted.nodes.length} entities.`,
      outcome: `${data.focus}_audit_completed`,
      confidence: 0.85,
      metadata: { url: data.url, focus: data.focus, orgId: extracted.orgId },
      provenance: {
        source: `audit:${data.url}`,
        extractor: 'contextGraphService.ingestAudit',
        confidence: 0.85,
        recordedAt: Date.now()
      }
    });

    // Link org -> decision
    contextGraphStore.addEdge({
      fromId: extracted.orgId,
      toId: decision.id,
      edgeType: 'related_to'
    });

    return {
      ok: true as const,
      message: `Ingested audit for ${data.url}: ${extracted.nodes.length} nodes, decision ${decision.id}.`,
      decision,
      ...extracted
    };
  }

  public recordDecision(...args: Parameters<typeof decisionService.recordDecision>) {
    return decisionService.recordDecision(...args);
  }

  public addCausalLink(fromId: string, toId: string, type: ContextGraphCausalType = 'CAUSED') {
    return decisionService.addCausalLink(fromId, toId, type);
  }

  public traceDecision(id: string) {
    return decisionService.traceChain(id);
  }

  public similarDecisions(query: string, max = 5) {
    return decisionService.findSimilar(query, max);
  }

  public listDecisions() {
    return decisionService.listDecisions();
  }

  public getProvenanceTrail(entityId: string) {
    return provenanceService.getTrail(entityId);
  }

  public listProvenance() {
    return provenanceService.listAll();
  }

  public detectConflicts() {
    return conflictService.detectConflicts();
  }

  public runAeoRules() {
    return aeoRuleEngine.runRules();
  }

  public query(text: string) {
    return hybridRetrieve.query(text);
  }

  public exportJsonLd() {
    return jsonLdExporter.exportOrganization();
  }

  public exportProvenance() {
    return jsonLdExporter.exportProvenance();
  }

  public exportFull() {
    return jsonLdExporter.exportFullGraph();
  }

  public isGraphAwareAgents(): boolean {
    try {
      return localStorage.getItem(GRAPH_AWARE_KEY) === '1';
    } catch {
      return false;
    }
  }

  public setGraphAwareAgents(on: boolean): void {
    try {
      localStorage.setItem(GRAPH_AWARE_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  public buildAgentContextSnippet(prompt: string, maxChars = 1200): string {
    if (!this.isGraphAwareAgents()) return '';
    const result = hybridRetrieve.query(prompt, { maxHits: 6, vfsBudget: 800 });
    if (result.hits.length === 0) return '';
    const body = result.assembledContext.slice(0, maxChars);
    return `\n\n[Luminara Context Graph precedents]\n${body}\n`;
  }
}

export const contextGraphService = new ContextGraphService();
export { contextGraphStore } from './contextGraphStore';
export { decisionService } from './decisionService';
export { provenanceService } from './provenanceService';
export { entityExtractService } from './entityExtractService';
export { conflictService } from './conflictService';
export { aeoRuleEngine } from './aeoRuleEngine';
export { hybridRetrieve } from './hybridRetrieve';
export { jsonLdExporter } from './jsonLdExporter';
