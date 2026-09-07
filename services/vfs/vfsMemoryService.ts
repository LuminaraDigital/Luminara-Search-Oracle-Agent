import { 
  BusinessDNA, 
  VfsMemoryCategory, 
  VfsMemoryItem, 
  VfsMemorySyncResult, 
  VfsNode 
} from '../../types';
import { vfsStorageService } from './vfsStorageService';

export class VfsMemoryService {
  private categoryPaths: Record<VfsMemoryCategory, string> = {
    profiles: 'viking://user/default/.memories/profiles',
    preferences: 'viking://user/default/.memories/preferences',
    entities: 'viking://user/default/.memories/entities',
    events: 'viking://user/default/.memories/events',
    cases: 'viking://user/default/.memories/cases',
    patterns: 'viking://user/default/.memories/patterns'
  };

  /**
   * List all memory items across or within specific categories.
   */
  public getMemoryItems(category?: VfsMemoryCategory): VfsMemoryItem[] {
    const categories: VfsMemoryCategory[] = category 
      ? [category] 
      : ['profiles', 'preferences', 'entities', 'events', 'cases', 'patterns'];

    const items: VfsMemoryItem[] = [];

    for (const cat of categories) {
      const dirUri = this.categoryPaths[cat];
      const entries = vfsStorageService.listDirectory(dirUri, false);

      for (const entry of entries) {
        if (entry.isDir) continue;
        const node = vfsStorageService.getNode(entry.uri);
        if (!node) continue;

        items.push({
          id: node.uri,
          category: cat,
          uri: node.uri,
          title: node.metadata.description || node.name,
          summaryL0: node.layers?.l0.content || '',
          detailL1: node.layers?.l1.content || '',
          fullDataL2: node.layers?.l2.content || '',
          tags: node.metadata.tags || [],
          relevanceScore: 1.0,
          updatedAt: node.metadata.updatedAt
        });
      }
    }

    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Add or update an individual memory item in the VFS.
   */
  public addMemoryItem(
    category: VfsMemoryCategory,
    title: string,
    content: string,
    tags: string[] = [],
    domainFocus?: 'SEO' | 'AEO' | 'GEO' | 'STRATEGY' | 'MEMORY'
  ): VfsMemoryItem {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
    const uri = `${this.categoryPaths[category]}/${slug}.md`;

    const node = vfsStorageService.createNode({
      uri,
      name: `${slug}.md`,
      type: 'memory',
      content,
      description: title,
      tags: [...tags, category, 'self-evolving-memory'],
      domainFocus: domainFocus || 'MEMORY'
    });

    return {
      id: node.uri,
      category,
      uri: node.uri,
      title: node.metadata.description || node.name,
      summaryL0: node.layers?.l0.content || '',
      detailL1: node.layers?.l1.content || '',
      fullDataL2: node.layers?.l2.content || '',
      tags: node.metadata.tags || [],
      relevanceScore: 1.0,
      updatedAt: node.metadata.updatedAt
    };
  }

  /**
   * Synchronizes Strategic Business DNA into VFS memory structures.
   * Links Brand Profile, Competitor Entities, and Strategic Gap cases.
   */
  public syncFromBusinessDNA(dna: BusinessDNA): VfsMemorySyncResult {
    let nodesCreated = 0;
    const syncedCategories: VfsMemoryCategory[] = ['profiles', 'entities', 'cases', 'preferences'];

    // 1. Profile
    const profileContent = `# Business DNA: ${dna.name}

**Brand**: ${dna.name}
**Mission**: ${dna.mission || 'Autonomous search & brand authority acceleration.'}
**Unique Value Proposition**: ${dna.usp || 'Continuous SERP grounding and AEO optimization.'}
**Target Audience**: ${dna.targetAudience || 'Growth leaders and enterprise teams.'}

## Strategic Summary
${dna.rawContext || 'No additional raw context provided.'}
`;

    vfsStorageService.createNode({
      uri: `${this.categoryPaths.profiles}/business_dna.md`,
      name: 'business_dna.md',
      type: 'memory',
      content: profileContent,
      description: `Strategic Business DNA for ${dna.name}`,
      tags: ['dna', 'profile', dna.name.toLowerCase()],
      domainFocus: 'STRATEGY'
    });
    nodesCreated++;

    // 2. Competitor Entities
    if (dna.competitors && dna.competitors.length > 0) {
      const compContent = `# Monitored Competitor Entities: ${dna.name}

Target brand **${dna.name}** active market competitors:
${dna.competitors.map((c, i) => `${i + 1}. **${c}** - Active Search & AEO Rival`).join('\n')}

*Auto-synchronized from Business DNA sequencing.*`;

      vfsStorageService.createNode({
        uri: `${this.categoryPaths.entities}/active_competitors.md`,
        name: 'active_competitors.md',
        type: 'memory',
        content: compContent,
        description: `Active Competitor Entities for ${dna.name}`,
        tags: ['dna', 'competitors', ...dna.competitors.map(c => c.toLowerCase())],
        domainFocus: 'STRATEGY'
      });
      nodesCreated++;
    }

    // 3. Perceived Strategic Gaps (Cases)
    if (dna.perceivedGaps && dna.perceivedGaps.length > 0) {
      const gapContent = `# Perceived Vulnerabilities & Growth Gaps: ${dna.name}

Strategic weaknesses and market vulnerabilities identified during DNA sequencing:
${dna.perceivedGaps.map((g, i) => `• [GAP-${i + 1}] ${g}`).join('\n')}

*Oracle Agent will prioritize these vectors during adversarial stress tests and AEO audits.*`;

      vfsStorageService.createNode({
        uri: `${this.categoryPaths.cases}/strategic_gaps.md`,
        name: 'strategic_gaps.md',
        type: 'memory',
        content: gapContent,
        description: `Strategic Market Gaps for ${dna.name}`,
        tags: ['dna', 'gaps', 'strategy', 'vulnerability'],
        domainFocus: 'STRATEGY'
      });
      nodesCreated++;
    }

    return {
      syncedCategories,
      itemsCount: this.getMemoryItems().length,
      nodesCreated,
      timestamp: Date.now()
    };
  }

  /**
   * Ingests a completed Instant Audit report into VFS resources and logs an event memory.
   */
  public ingestAuditAsResource(auditData: any, domainOrUrl: string): string {
    const cleanDomain = domainOrUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase();
    const uri = `viking://resources/audits/${cleanDomain}_audit.json`;

    const content = typeof auditData === 'string' ? auditData : JSON.stringify(auditData, null, 2);

    vfsStorageService.createNode({
      uri,
      name: `${cleanDomain}_audit.json`,
      type: 'resource',
      rawFormat: 'json',
      content,
      description: `Instant Strategic Audit for ${domainOrUrl}`,
      tags: ['audit', cleanDomain, 'serp', 'aeo'],
      domainFocus: 'AEO'
    });

    // Log Event Memory
    const eventSlug = `audit_${cleanDomain}_${Date.now().toString(36)}`;
    vfsStorageService.createNode({
      uri: `${this.categoryPaths.events}/${eventSlug}.md`,
      name: `${eventSlug}.md`,
      type: 'memory',
      content: `# Audit Completed: ${domainOrUrl}\n\n` +
        `- **Timestamp**: ${new Date().toISOString()}\n` +
        `- **Target**: ${domainOrUrl}\n` +
        `- **VFS Resource Location**: \`${uri}\`\n` +
        `- **Status**: Indexed with L0/L1/L2 multi-resolution layers for instant Oracle Agent recall.`,
      description: `Audit Event: ${domainOrUrl}`,
      tags: ['event', 'audit', cleanDomain],
      domainFocus: 'AEO'
    });

    return uri;
  }
}

export const vfsMemoryService = new VfsMemoryService();
