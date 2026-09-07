import { ContextGraphRuleFinding } from '../../types';
import { contextGraphStore } from './contextGraphStore';

class AeoRuleEngine {
  public runRules(): ContextGraphRuleFinding[] {
    const findings: ContextGraphRuleFinding[] = [];
    const orgs = contextGraphStore.listNodes('Organization');
    const competitors = contextGraphStore.listNodes('Competitor');
    const findingsNodes = contextGraphStore.listNodes('Finding');
    const evidence = contextGraphStore.listNodes('Evidence');
    const stats = contextGraphStore.getStats();

    if (orgs.length === 0) {
      findings.push({
        ruleId: 'aeo_missing_org',
        name: 'Missing Organization Entity',
        severity: 'critical',
        message: 'No Organization node in the context graph.',
        recommendation: 'Run Sync from DNA or ingest an Instant Audit to seed the brand entity.',
        relatedNodeIds: []
      });
    }

    for (const org of orgs) {
      const neighbors = contextGraphStore.getNeighbors(org.id, 1);
      const hasJsonLdHint =
        String(org.properties.hasJsonLd || '') === 'true' ||
        findingsNodes.some(f => /json-?ld|schema\.org|organization/i.test(f.label));

      if (!hasJsonLdHint) {
        findings.push({
          ruleId: 'aeo_missing_jsonld',
          name: 'Thin Organization Schema Signal',
          severity: 'high',
          message: `Organization "${org.label}" has no JSON-LD / Organization schema signal in the graph.`,
          recommendation: 'Export JSON-LD from Context Graph Export tab and add Organization schema to the site.',
          relatedNodeIds: [org.id]
        });
      }

      const competitorLinks = neighbors.edges.filter(e => e.edgeType === 'competes_with');
      if (competitorLinks.length === 0 && competitors.length === 0) {
        findings.push({
          ruleId: 'aeo_competitor_gap',
          name: 'Competitor Coverage Gap',
          severity: 'medium',
          message: `No competitor edges for "${org.label}".`,
          recommendation: 'Add competitors in Business DNA and run kg sync.',
          relatedNodeIds: [org.id]
        });
      }

      if (evidence.length === 0) {
        findings.push({
          ruleId: 'aeo_no_evidence',
          name: 'No Evidence Nodes',
          severity: 'medium',
          message: 'Graph has no Evidence nodes from grounded SERP sources.',
          recommendation: 'Run Instant Audit and ingest the report into the context graph.',
          relatedNodeIds: [org.id]
        });
      }
    }

    if (stats.nodeCount > 0 && stats.nodeCount < 5) {
      findings.push({
        ruleId: 'aeo_thin_entity_coverage',
        name: 'Thin Entity Coverage',
        severity: 'low',
        message: `Only ${stats.nodeCount} nodes in the graph.`,
        recommendation: 'Sync DNA, ingest audits, and sync VFS entities to saturate the AEO entity graph.',
        relatedNodeIds: orgs.map(o => o.id)
      });
    }

    // Deduplicate by ruleId+first related
    const seen = new Set<string>();
    return findings.filter(f => {
      const key = `${f.ruleId}:${f.relatedNodeIds[0] || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export const aeoRuleEngine = new AeoRuleEngine();
