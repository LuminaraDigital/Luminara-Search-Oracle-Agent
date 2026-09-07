import { BusinessDNA, ContextGraphConflict } from '../../types';
import { contextGraphStore } from './contextGraphStore';

class ConflictService {
  public detectConflicts(): ContextGraphConflict[] {
    const conflicts: ContextGraphConflict[] = [];
    const orgs = contextGraphStore.listNodes('Organization');

    // DNA brand vs multiple Organization labels with different names but shared URL focus
    let dna: BusinessDNA | null = null;
    try {
      const raw = localStorage.getItem('luminara_business_dna');
      if (raw) dna = JSON.parse(raw);
    } catch {
      dna = null;
    }

    if (dna?.name) {
      const mismatched = orgs.filter(
        o => o.label.toLowerCase() !== dna!.name.toLowerCase() && String(o.properties.url || '')
      );
      for (const o of mismatched.slice(0, 5)) {
        conflicts.push({
          id: `conflict_brand_${o.id}`,
          entityId: o.id,
          field: 'label',
          values: [dna.name, o.label],
          severity: 'HIGH',
          sources: ['business_dna', String(o.provenance?.source || 'graph')],
          message: `Brand name mismatch: DNA says "${dna.name}" but graph org is "${o.label}".`
        });
      }
    }

    // Competitor also typed as Organization with same label
    const competitors = contextGraphStore.listNodes('Competitor');
    for (const c of competitors) {
      const asOrg = orgs.find(o => o.label.toLowerCase() === c.label.toLowerCase() && o.id !== c.id);
      if (asOrg) {
        conflicts.push({
          id: `conflict_type_${c.id}`,
          entityId: c.id,
          field: 'type',
          values: ['Competitor', 'Organization'],
          severity: 'MEDIUM',
          sources: [
            String(c.provenance?.source || 'graph'),
            String(asOrg.provenance?.source || 'graph')
          ],
          message: `"${c.label}" appears as both Competitor and Organization.`
        });
      }
    }

    // Conflicting USP / offering properties on same org
    for (const o of orgs) {
      const offerings = contextGraphStore
        .getNeighbors(o.id, 1)
        .nodes.filter(n => n.type === 'Offering');
      if (offerings.length >= 2) {
        const usps = offerings.map(x => String(x.properties.usp || x.label));
        const unique = new Set(usps.map(u => u.toLowerCase()));
        if (unique.size >= 2) {
          conflicts.push({
            id: `conflict_usp_${o.id}`,
            entityId: o.id,
            field: 'usp',
            values: usps.slice(0, 4),
            severity: 'LOW',
            sources: offerings.map(x => String(x.provenance?.source || 'graph')),
            message: `Multiple USP/offerings for "${o.label}" may conflict.`
          });
        }
      }
    }

    return conflicts;
  }
}

export const conflictService = new ConflictService();
