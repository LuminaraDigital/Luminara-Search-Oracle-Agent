import { contextGraphStore } from './contextGraphStore';
import { decisionService } from './decisionService';
import { provenanceService } from './provenanceService';

class JsonLdExporter {
  public exportOrganization(): string {
    const orgs = contextGraphStore.listNodes('Organization');
    const primary = orgs[0];
    if (!primary) {
      return JSON.stringify(
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Unknown',
          description: 'No Organization node in Luminara Context Graph. Sync DNA first.'
        },
        null,
        2
      );
    }

    const neighbors = contextGraphStore.getNeighbors(primary.id, 1);
    const offerings = neighbors.nodes.filter(n => n.type === 'Offering');
    const competitors = neighbors.nodes.filter(n => n.type === 'Competitor');

    const doc = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: primary.label,
      url: primary.properties.url || undefined,
      description: primary.properties.mission || primary.properties.usp || undefined,
      slogan: primary.properties.usp || undefined,
      knowsAbout: offerings.map(o => o.label),
      subjectOf: competitors.map(c => ({
        '@type': 'Thing',
        name: c.label,
        description: 'Competitor entity from Luminara Context Graph'
      })),
      identifier: primary.id
    };

    return JSON.stringify(doc, null, 2);
  }

  public exportProvenance(): string {
    return provenanceService.exportJson();
  }

  public exportFullGraph(): string {
    return JSON.stringify(
      {
        exportedAt: Date.now(),
        nodes: contextGraphStore.listNodes(),
        edges: contextGraphStore.listEdges(),
        decisions: decisionService.listDecisions(),
        jsonLdOrganization: JSON.parse(this.exportOrganization())
      },
      null,
      2
    );
  }
}

export const jsonLdExporter = new JsonLdExporter();
