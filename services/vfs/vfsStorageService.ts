import { 
  VfsNode, 
  VfsNodeType, 
  VfsLayerType, 
  VfsLayerData, 
  VfsTreeSummary 
} from '../../types';
import { VfsCreateNodeInput, VfsLsEntry, VfsTreeNode } from './vfsTypes';

const STORAGE_KEY = 'luminara_vfs_nodes_v2';
const PROTOCOL_VIKING = 'viking://';
const PROTOCOL_ORACLE = 'oracle://';

// Helper for rough token estimation (typically 1 token ≈ 3.8 to 4 chars)
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const charBased = Math.ceil(text.length / 3.8);
  const wordBased = Math.ceil(words.length * 1.3);
  return Math.max(1, Math.round((charBased + wordBased) / 2));
}

// Multi-resolution distillation generator (clean-room algorithm)
export function distillLayers(
  rawContent: string, 
  format: 'markdown' | 'json' | 'text' | 'yaml' = 'markdown',
  title?: string
): VfsLayerData {
  const l2Content = rawContent.trim();
  const l2Tokens = estimateTokens(l2Content);

  // Extract keywords (TF-IDF / frequency heuristic)
  const cleanWords = l2Content
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !['this', 'that', 'with', 'from', 'have', 'were', 'which', 'their', 'about', 'there'].includes(w));
  
  const freqMap: Record<string, number> = {};
  for (const w of cleanWords) {
    freqMap[w] = (freqMap[w] || 0) + 1;
  }
  const keywords = Object.entries(freqMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  // Generate L1 Overview (~500 - 2,000 tokens)
  let l1Content = '';
  const sections: string[] = [];

  if (format === 'json') {
    try {
      const parsed = JSON.parse(l2Content);
      const keys = Object.keys(parsed);
      sections.push(...keys.slice(0, 8));
      const summaryObj: Record<string, any> = {};
      for (const k of keys.slice(0, 8)) {
        const val = parsed[k];
        if (typeof val === 'object' && val !== null) {
          summaryObj[k] = Array.isArray(val) ? `[Array(${val.length})]` : `{Object keys: ${Object.keys(val).slice(0, 4).join(', ')}}`;
        } else {
          summaryObj[k] = val;
        }
      }
      l1Content = `### Overview: ${title || 'Structured Data'}\n` +
        `**Key Fields**: ${sections.join(', ')}\n` +
        `\`\`\`json\n${JSON.stringify(summaryObj, null, 2)}\n\`\`\``;
    } catch {
      l1Content = l2Content.slice(0, 1200) + (l2Content.length > 1200 ? '\n...[Overview truncated]' : '');
    }
  } else {
    // Markdown or Text
    const lines = l2Content.split('\n');
    const headerLines = lines.filter(l => l.startsWith('#') || l.startsWith('**'));
    const bulletLines = lines.filter(l => l.trim().startsWith('-') || l.trim().startsWith('*') || /^\d+\./.test(l.trim()));

    if (l2Content.length <= 600) {
      l1Content = l2Content;
      sections.push(...headerLines.map(h => h.replace(/^[#*\s]+/, '').trim()).slice(0, 8));
    } else if (headerLines.length > 0 || bulletLines.length > 0) {
      const leadParagraph = lines.find(l => l.trim().length > 30 && !l.startsWith('#')) || '';
      l1Content = `### Overview: ${title || 'Document Outline'}\n\n` +
        (leadParagraph ? `> ${leadParagraph.trim()}\n\n` : '') +
        (sections.length > 0 ? `**Key Structure**:\n${sections.map(s => `• ${s}`).join('\n')}\n\n` : '') +
        (bulletLines.length > 0 ? `**Highlights**:\n${bulletLines.slice(0, 10).join('\n')}` : '');
    } else {
      l1Content = l2Content.slice(0, 1500) + (l2Content.length > 1500 ? '\n... [Overview truncated]' : '');
    }
  }

  const l1Tokens = Math.min(l2Tokens, estimateTokens(l1Content));

  // Generate L0 Abstract (~50 - 150 tokens)
  let l0Summary = '';
  if (title) {
    l0Summary = `[${title.toUpperCase()}] `;
  }
  const firstSentence = l2Content.replace(/\n+/g, ' ').split(/(?<=[.?!])\s+/)[0] || '';
  const topKw = keywords.slice(0, 6).join(', ');
  l0Summary += `${firstSentence.slice(0, 180)} (Keywords: ${topKw})`;
  const l0Tokens = estimateTokens(l0Summary);

  return {
    l0: {
      content: l0Summary,
      tokenCount: l0Tokens,
      keywords
    },
    l1: {
      content: l1Content,
      tokenCount: l1Tokens,
      sections
    },
    l2: {
      content: l2Content,
      tokenCount: l2Tokens,
      rawFormat: format
    }
  };
}

class VfsStorageService {
  private nodes: Map<string, VfsNode> = new Map();
  private listeners: Array<() => void> = [];

  constructor() {
    this.init();
  }

  public normalizeUri(uri: string): string {
    if (!uri) return PROTOCOL_VIKING;
    let clean = uri.trim();
    if (clean.startsWith(PROTOCOL_ORACLE)) {
      clean = PROTOCOL_VIKING + clean.slice(PROTOCOL_ORACLE.length);
    }
    if (!clean.startsWith(PROTOCOL_VIKING)) {
      clean = clean.replace(/^\/+/, '');
      clean = PROTOCOL_VIKING + clean;
    }
    // Remove duplicate slashes except after viking://
    const prefix = PROTOCOL_VIKING;
    const path = clean.slice(prefix.length).replace(/\/+/g, '/').replace(/\/+$/, '');
    return prefix + path;
  }

  private init(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed: VfsNode[] = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.nodes = new Map(parsed.map(n => [this.normalizeUri(n.uri), n]));
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to load VFS from localStorage, seeding defaults', e);
      }
    }
    this.seedDefaultFilesystem();
  }

  private persist(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const array = Array.from(this.nodes.values());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(array));
      } catch (e) {
        console.error('Failed to save VFS to localStorage', e);
      }
    }
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) { console.error('VFS listener error', e); }
    });
  }

  // ---------------- Seed Filesystem ----------------
  public seedDefaultFilesystem(): void {
    this.nodes.clear();

    const addDir = (uri: string, description: string) => {
      const norm = this.normalizeUri(uri);
      const name = norm.split('/').filter(Boolean).pop() || '';
      const parent = this.getParentUri(norm);
      this.nodes.set(norm, {
        uri: norm,
        name,
        type: 'directory',
        parentUri: parent,
        childrenUris: [],
        metadata: {
          description,
          createdAt: Date.now() - 86400000 * 7,
          updatedAt: Date.now() - 86400000 * 2,
          sizeBytes: 0
        }
      });
    };

    const addFile = (input: {
      uri: string;
      name?: string;
      type: VfsNodeType;
      content: string;
      format?: 'markdown' | 'json' | 'text' | 'yaml';
      description: string;
      tags: string[];
      domainFocus?: 'SEO' | 'AEO' | 'GEO' | 'STRATEGY' | 'MEMORY';
    }) => {
      const norm = this.normalizeUri(input.uri);
      const name = input.name || norm.split('/').filter(Boolean).pop() || 'file';
      const parent = this.getParentUri(norm);
      const layers = distillLayers(input.content, input.format || 'markdown', name);
      const sizeBytes = new Blob([input.content]).size;
      const savingsPct = layers.l2.tokenCount > 0 
        ? Math.max(0, Math.round(((layers.l2.tokenCount - layers.l0.tokenCount) / layers.l2.tokenCount) * 100))
        : 0;

      this.nodes.set(norm, {
        uri: norm,
        name,
        type: input.type,
        parentUri: parent,
        layers,
        metadata: {
          description: input.description,
          tags: input.tags,
          author: 'Luminara Oracle System',
          createdAt: Date.now() - 86400000 * 4,
          updatedAt: Date.now() - 86400000 * 1,
          sizeBytes,
          tokenSavingsPct: savingsPct,
          domainFocus: input.domainFocus
        }
      });
    };

    // Root directories
    addDir('viking://user', 'User root directory');
    addDir('viking://user/default', 'Default user workspace');
    addDir('viking://user/default/.memories', '6-Category self-evolving long-term agent memory');
    addDir('viking://user/default/.memories/profiles', 'User and brand identity profiles');
    addDir('viking://user/default/.memories/preferences', 'Operational preferences and scoring thresholds');
    addDir('viking://user/default/.memories/entities', 'Key corporate, competitor, and domain entities');
    addDir('viking://user/default/.memories/events', 'Historical algorithm updates and audit milestones');
    addDir('viking://user/default/.memories/cases', 'Resolved technical problems, ranking recoveries, and wins');
    addDir('viking://user/default/.memories/patterns', 'Empirical heuristics and search ranking patterns');

    addDir('viking://resources', 'Curated knowledge bases, SERP caches, and audits');
    addDir('viking://resources/audits', 'Saved full-spectrum SEO/AEO/GEO audits');
    addDir('viking://resources/serp_cache', 'High-fidelity search engine results and citation snapshots');
    addDir('viking://resources/schemas', 'Structured data templates and JSON-LD entity graphs');

    addDir('viking://skills', 'Agentic capabilities, tool specs, and execution instructions');
    addDir('viking://sessions', 'Active conversation context, scratchpads, and execution trajectories');

    // Seed Memories
    addFile({
      uri: 'viking://user/default/.memories/profiles/luminara_brand_dna.md',
      type: 'memory',
      domainFocus: 'STRATEGY',
      description: 'Luminara Search Core Business DNA and Sovereign Operating System Profile',
      tags: ['dna', 'profile', 'brand', 'sovereign'],
      content: `# Luminara Search: Strategic Autonomous Operating DNA

**Brand Identity**: Luminara Search & Oracle Agent
**Mission**: Eliminate expensive monthly marketing agency retainers with continuous search simulation, adversarial stress testing, and real-time SERP grounding.
**Unique Selling Proposition (USP)**: Real-time autonomous search simulation powered by Gemini 3 Pro reasoning, TimesFM foundation forecasting, and on-device OracleMind SLM neural harnesses.
**Primary Target Audience**: Tech founders, VP Marketing, Growth Directors, and Autonomous Agent Developers demanding deterministic SERP citation control.
**Core Competitive Advantage**: Triple-vector diagnostic scanning (SEO, AEO, GEO) combined with native virtual filesystem context management.

## Strategic Architectural Pillars
- **Sovereign Agent Core**: Eliminates recurring retainer waste with deterministic, always-on AI auditors.
- **Hierarchical VFS OS**: Organizes agent context under viking:// protocols, reducing prompt token costs by up to 90% via multi-resolution L0/L1/L2 distillation.
- **Continuous SERP Validation**: Cross-checks every strategic hypothesis against live Google Search chunks before committing recommendations.
- **Plain English Mandate**: Translates complex technical audits into concise, high-impact grade-8 executive directives.`
    });

    addFile({
      uri: 'viking://user/default/.memories/preferences/audit_scoring_policy.md',
      type: 'memory',
      domainFocus: 'AEO',
      description: 'Default scoring weights and priority channels for search evaluations',
      tags: ['preferences', 'aeo', 'scoring', 'rules'],
      content: `# Audit Scoring & Priority Policy

- **AEO Weight**: 45% (AI Overviews, Perplexity Citations, ChatGPT Search mentions)
- **GEO Weight**: 30% (Generative entity clarity, quotation probability, structured schema)
- **Technical SEO Weight**: 25% (Core Web Vitals, Crawl Budget, Canonical hygiene)
- **Reading Level Ceiling**: Flesch-Kincaid Grade 8 maximum for all executive Plain English reports.
- **Verification Rule**: Never assert a ranking claim without grounding against live Google Search SERP chunks.`
    });

    addFile({
      uri: 'viking://user/default/.memories/entities/competitor_landscape.md',
      type: 'memory',
      domainFocus: 'STRATEGY',
      description: 'Monitored competitors, agency benchmarks, and positioning matrices',
      tags: ['entities', 'competitors', 'market'],
      content: `# Strategic Competitor Landscape

1. **Traditional Legacy Agencies**: Single Grain, WebFX, Omnicom.
   - *Weakness*: \$15k–\$30k monthly retainers, slow quarterly PDF reports, zero agentic automation.
2. **SaaS Tooling**: Ahrefs, Semrush, Conductor, BrightEdge.
   - *Weakness*: Flat retroactive dashboards without predictive foundation forecasting or generative AEO simulation.
3. **Luminara Advantage**: Real-time simulation, instant remediation diffs, zero retainer overhead.`
    });

    addFile({
      uri: 'viking://user/default/.memories/events/google_march_2026_update.md',
      type: 'memory',
      domainFocus: 'SEO',
      description: 'Google March 2026 Core Algorithm Update Analysis & Impact',
      tags: ['events', 'google', 'algorithm', 'update'],
      content: `# Google March 2026 Core Search & AI Overview Update

- **Rollout Period**: March 1 - March 15, 2026.
- **Key Observation**: Drastic reduction in citations for generic AI-generated fluff.
- **Winners**: Brands possessing verified first-party case studies, comprehensive JSON-LD entity structures, and high author topical authority.
- **Action Taken**: Automated audit rules updated to penalize thin content and award bonus points to verifiable data citations.`
    });

    addFile({
      uri: 'viking://user/default/.memories/cases/case_stripe_aeo_fix.md',
      type: 'memory',
      domainFocus: 'AEO',
      description: 'Case Study: Stripe Documentation Schema & AI Overview Citation Spike',
      tags: ['cases', 'stripe', 'success', 'schema'],
      content: `# Case Study: Optimizing Stripe Integration Docs for AEO

- **Issue**: Stripe third-party developer guide was losing citation share to outdated blog summaries in Gemini and ChatGPT search.
- **Intervention**: Deployed nested \`HowTo\` and \`SoftwareApplication\` schema with exact code snippet entity markers.
- **Result**: +42% citation frequency in AI Overviews within 14 days, reducing bounce rate by 18%.`
    });

    addFile({
      uri: 'viking://user/default/.memories/patterns/aeo_citation_heuristics.md',
      type: 'memory',
      domainFocus: 'AEO',
      description: 'Top recurring heuristics governing high LLM citation probability',
      tags: ['patterns', 'heuristics', 'citation', 'aeo'],
      content: `# Empirical AEO Citation Patterns

1. **Concise Definitional Anchors**: LLMs strongly favor quoting definitions positioned in the first 25 words of an H2 section.
2. **Direct Data Tables**: Markdown tables with numerical comparisons receive 3.4x higher quotation probability than bulleted lists.
3. **Verifiable Source Attribution**: Direct outbound references to academic or primary documentation elevate domain trust score.`
    });

    // Seed Resources
    addFile({
      uri: 'viking://resources/audits/stripe_aeo_benchmark.json',
      type: 'resource',
      format: 'json',
      domainFocus: 'AEO',
      description: 'Complete diagnostic audit of Stripe payment processing visibility in Answer Engines',
      tags: ['audit', 'stripe', 'benchmark', 'aeo'],
      content: JSON.stringify({
        targetUrl: 'https://stripe.com',
        auditDate: '2026-03-01T12:00:00Z',
        overallScore: 88,
        dimensions: {
          aeoScore: 92,
          geoScore: 84,
          seoSScore: 89
        },
        radarMetrics: {
          informationalIntent: 94,
          commercialIntent: 86,
          comparativeIntent: 78,
          citationProbability: 91,
          schemaRichness: 89
        },
        competitorGaps: [
          'Adyen captures higher quotation volume on European cross-border processing.',
          'PayPal dominates branded merchant trust queries.'
        ],
        remediationPlan: [
          'Add Table schema to pricing comparison matrix.',
          'Inject Plain English summary blocks at top of developer API guides.'
        ]
      }, null, 2)
    });

    addFile({
      uri: 'viking://resources/schemas/faq_schema_template.jsonld',
      type: 'resource',
      format: 'json',
      domainFocus: 'SEO',
      description: 'Standard Schema.org FAQPage JSON-LD template optimized for Answer Engine extraction',
      tags: ['schema', 'jsonld', 'faq', 'aeo'],
      content: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How does Answer Engine Optimization (AEO) differ from traditional SEO?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "While traditional SEO focuses on driving clicks from 10 blue search links, AEO optimizes brand content to become the cited direct answer in conversational engines like Gemini, ChatGPT, and Perplexity."
            }
          },
          {
            "@type": "Question",
            "name": "Can on-device SLMs perform accurate JSON-LD schema parsing?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Luminara's OracleMind 64M and 100M MoE models are specifically fine-tuned for zero-latency structured entity extraction and syntax verification."
            }
          }
        ]
      }, null, 2)
    });

    // Seed Skills
    addFile({
      uri: 'viking://skills/aeo-schema-architect.md',
      type: 'skill',
      domainFocus: 'AEO',
      description: 'Autonomous skill for generating schema.org JSON-LD markup from raw HTML',
      tags: ['skills', 'schema', 'tool', 'architect'],
      content: `# Skill: AEO Schema Architect

**Purpose**: Ingests raw webpage content and generates syntactically flawless, validated Schema.org JSON-LD.
**Supported Types**: \`FAQPage\`, \`Article\`, \`SoftwareApplication\`, \`Organization\`, \`HowTo\`.
**Execution Rule**: Always cross-reference Google Rich Result guidelines and ensure all required fields (e.g. \`name\`, \`headline\`, \`author\`) are populated.`
    });

    addFile({
      uri: 'viking://skills/flesch-kincaid-grade8-rewriter.md',
      type: 'skill',
      domainFocus: 'STRATEGY',
      description: 'Luminara Plain English Protocol rewriter reducing reading grade level to 8th grade',
      tags: ['skills', 'plain-english', 'rewriter'],
      content: `# Skill: Plain English Protocol Rewriter

**Objective**: Take complex technical SEO and neural forecasting jargon and rewrite it into high-impact, C-level executive bullet points.
**Target Metrics**: Flesch-Kincaid Grade Level <= 8.0, sentence length <= 16 words, active voice >= 90%.`
    });

    // Seed Sessions
    addFile({
      uri: 'viking://sessions/active_scratchpad.md',
      type: 'session',
      domainFocus: 'STRATEGY',
      description: 'Active agent scratchpad and multi-turn reasoning cache',
      tags: ['session', 'scratchpad', 'active'],
      content: `# Active Agent Session Scratchpad

- Current Focus: Integrating OpenViking VFS context operating system.
- Target Metric: Token reduction > 70% using L0/L1 layer resolution.
- Pending Tasks: Connect VFS to Oracle Agent neural prompt injection.`
    });

    // Update parent childrenUris
    this.rebuildChildPointers();
    this.persist();
  }

  private getParentUri(uri: string): string | null {
    const norm = this.normalizeUri(uri);
    const parts = norm.slice(PROTOCOL_VIKING.length).split('/').filter(Boolean);
    if (parts.length <= 1) return null;
    parts.pop();
    return PROTOCOL_VIKING + parts.join('/');
  }

  private rebuildChildPointers(): void {
    // Reset all children
    for (const node of this.nodes.values()) {
      if (node.type === 'directory') {
        node.childrenUris = [];
      }
    }
    // Link
    for (const node of this.nodes.values()) {
      if (node.parentUri && this.nodes.has(node.parentUri)) {
        const parent = this.nodes.get(node.parentUri)!;
        if (!parent.childrenUris) parent.childrenUris = [];
        if (!parent.childrenUris.includes(node.uri)) {
          parent.childrenUris.push(node.uri);
        }
      }
    }
  }

  // ---------------- Core Operations ----------------

  public getNode(uri: string): VfsNode | null {
    return this.nodes.get(this.normalizeUri(uri)) || null;
  }

  public getAllNodes(): VfsNode[] {
    return Array.from(this.nodes.values());
  }

  public createNode(input: VfsCreateNodeInput): VfsNode {
    const normUri = this.normalizeUri(input.uri);
    const name = input.name || normUri.split('/').filter(Boolean).pop() || 'untitled';
    const parentUri = this.getParentUri(normUri);

    // Auto-create parents if missing
    if (parentUri && !this.nodes.has(parentUri)) {
      this.createNode({
        uri: parentUri,
        type: 'directory',
        description: `Auto-created parent directory for ${normUri}`
      });
    }

    let layers: VfsLayerData | undefined;
    let sizeBytes = 0;
    let savingsPct = 0;

    if (input.type !== 'directory') {
      const content = input.content || '';
      layers = distillLayers(content, input.rawFormat || 'markdown', name);
      sizeBytes = new Blob([content]).size;
      savingsPct = layers.l2.tokenCount > 0 
        ? Math.round(((layers.l2.tokenCount - layers.l1.tokenCount) / layers.l2.tokenCount) * 100)
        : 0;
    }

    const node: VfsNode = {
      uri: normUri,
      name,
      type: input.type,
      parentUri,
      childrenUris: input.type === 'directory' ? [] : undefined,
      layers,
      metadata: {
        description: input.description,
        tags: input.tags || [],
        author: input.author || 'User / Agent',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sizeBytes,
        tokenSavingsPct: savingsPct,
        domainFocus: input.domainFocus
      }
    };

    this.nodes.set(normUri, node);
    this.rebuildChildPointers();
    this.persist();
    return node;
  }

  public updateNode(uri: string, updates: Partial<VfsNode>): VfsNode | null {
    const norm = this.normalizeUri(uri);
    const existing = this.nodes.get(norm);
    if (!existing) return null;

    const updated: VfsNode = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        ...(updates.metadata || {}),
        updatedAt: Date.now()
      }
    };

    this.nodes.set(norm, updated);
    this.persist();
    return updated;
  }

  public updateNodeContent(uri: string, newContent: string, format?: 'markdown' | 'json' | 'text' | 'yaml'): VfsNode | null {
    const norm = this.normalizeUri(uri);
    const existing = this.nodes.get(norm);
    if (!existing || existing.type === 'directory') return null;

    const currentFormat = format || existing.layers?.l2.rawFormat || 'markdown';
    const layers = distillLayers(newContent, currentFormat, existing.name);
    const sizeBytes = new Blob([newContent]).size;
    const savingsPct = layers.l2.tokenCount > 0 
      ? Math.round(((layers.l2.tokenCount - layers.l1.tokenCount) / layers.l2.tokenCount) * 100)
      : 0;

    return this.updateNode(norm, {
      layers,
      metadata: {
        ...existing.metadata,
        sizeBytes,
        tokenSavingsPct: savingsPct,
        updatedAt: Date.now()
      }
    });
  }

  public deleteNode(uri: string, recursive: boolean = true): boolean {
    const norm = this.normalizeUri(uri);
    if (!this.nodes.has(norm)) return false;

    const node = this.nodes.get(norm)!;
    if (node.type === 'directory') {
      const children = Array.from(this.nodes.values()).filter(n => n.uri.startsWith(norm + '/'));
      if (children.length > 0 && !recursive) {
        throw new Error(`Directory ${norm} is not empty. Pass recursive=true to delete.`);
      }
      for (const child of children) {
        this.nodes.delete(child.uri);
      }
    }

    this.nodes.delete(norm);
    this.rebuildChildPointers();
    this.persist();
    return true;
  }

  public listDirectory(dirUri: string = PROTOCOL_VIKING, recursive: boolean = false): VfsLsEntry[] {
    const norm = this.normalizeUri(dirUri);
    const results: VfsLsEntry[] = [];

    for (const node of this.nodes.values()) {
      if (node.uri === norm) continue;

      const isDirectChild = norm === PROTOCOL_VIKING 
        ? (node.parentUri === null || node.parentUri === PROTOCOL_VIKING)
        : node.parentUri === norm;
      const isDescendant = node.uri.startsWith(norm === PROTOCOL_VIKING ? PROTOCOL_VIKING : norm + '/');

      if ((!recursive && isDirectChild) || (recursive && isDescendant)) {
        results.push({
          uri: node.uri,
          name: node.name,
          type: node.type,
          isDir: node.type === 'directory',
          sizeBytes: node.metadata.sizeBytes,
          l0Tokens: node.layers?.l0.tokenCount || 0,
          l1Tokens: node.layers?.l1.tokenCount || 0,
          l2Tokens: node.layers?.l2.tokenCount || 0,
          updatedAt: node.metadata.updatedAt,
          tags: node.metadata.tags || []
        });
      }
    }

    return results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  public getTree(rootUri: string = PROTOCOL_VIKING, maxDepth: number = 5): VfsTreeNode {
    const norm = this.normalizeUri(rootUri);
    const rootNode = this.nodes.get(norm) || {
      uri: norm,
      name: 'root',
      type: 'directory' as VfsNodeType,
      parentUri: null,
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), sizeBytes: 0 }
    };

    const buildTree = (currentUri: string, depth: number): VfsTreeNode => {
      const node = this.nodes.get(currentUri);
      const isDir = node?.type === 'directory' || currentUri === PROTOCOL_VIKING;
      const name = node?.name || (currentUri === PROTOCOL_VIKING ? 'viking://' : currentUri.split('/').filter(Boolean).pop() || '');
      
      const l0 = node?.layers?.l0.tokenCount || 0;
      const l1 = node?.layers?.l1.tokenCount || 0;
      const l2 = node?.layers?.l2.tokenCount || 0;
      const savingsPct = node?.metadata.tokenSavingsPct || 0;

      const treeNode: VfsTreeNode = {
        uri: currentUri,
        name,
        type: node?.type || 'directory',
        isDir,
        depth,
        children: [],
        l0Tokens: l0,
        l1Tokens: l1,
        l2Tokens: l2,
        savingsPct
      };

      if (isDir && depth < maxDepth) {
        const isRoot = currentUri === PROTOCOL_VIKING;
        const directChildren = Array.from(this.nodes.values())
          .filter(n => isRoot ? (n.parentUri === null || n.parentUri === PROTOCOL_VIKING) && n.uri !== currentUri : n.parentUri === currentUri)
          .sort((a, b) => {
            if ((a.type === 'directory') !== (b.type === 'directory')) {
              return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });

        for (const child of directChildren) {
          treeNode.children.push(buildTree(child.uri, depth + 1));
        }
      }

      return treeNode;
    };

    return buildTree(norm, 0);
  }

  public find(query: string, options?: { type?: VfsNodeType; rootUri?: string }): VfsNode[] {
    const q = query.toLowerCase();
    const root = options?.rootUri ? this.normalizeUri(options.rootUri) : null;
    const matches: VfsNode[] = [];

    for (const node of this.nodes.values()) {
      if (root && !node.uri.startsWith(root)) continue;
      if (options?.type && node.type !== options.type) continue;

      const nameMatch = node.name.toLowerCase().includes(q);
      const uriMatch = node.uri.toLowerCase().includes(q);
      const tagMatch = node.metadata.tags?.some(t => t.toLowerCase().includes(q));
      const descMatch = node.metadata.description?.toLowerCase().includes(q);
      const kwMatch = node.layers?.l0.keywords.some(k => k.toLowerCase().includes(q));

      if (nameMatch || uriMatch || tagMatch || descMatch || kwMatch) {
        matches.push(node);
      }
    }

    return matches;
  }

  public grep(
    pattern: string, 
    rootUri: string = PROTOCOL_VIKING, 
    layer: VfsLayerType = 'L2'
  ): Array<{ uri: string; line: number; text: string; layer: VfsLayerType }> {
    const regex = new RegExp(pattern, 'i');
    const root = this.normalizeUri(rootUri);
    const results: Array<{ uri: string; line: number; text: string; layer: VfsLayerType }> = [];

    for (const node of this.nodes.values()) {
      if (node.type === 'directory' || !node.uri.startsWith(root) || !node.layers) continue;

      let content = '';
      if (layer === 'L0') content = node.layers.l0.content;
      else if (layer === 'L1') content = node.layers.l1.content;
      else content = node.layers.l2.content;

      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        if (regex.test(lineText)) {
          results.push({
            uri: node.uri,
            line: idx + 1,
            text: lineText.trim(),
            layer
          });
        }
      });
    }

    return results.slice(0, 50);
  }

  public readLayer(
    uri: string, 
    layer: VfsLayerType = 'L1'
  ): { content: string; tokenCount: number; layer: VfsLayerType; title: string } | null {
    const node = this.getNode(uri);
    if (!node || node.type === 'directory' || !node.layers) return null;

    if (layer === 'L0') {
      return {
        content: node.layers.l0.content,
        tokenCount: node.layers.l0.tokenCount,
        layer: 'L0',
        title: node.name
      };
    } else if (layer === 'L2') {
      return {
        content: node.layers.l2.content,
        tokenCount: node.layers.l2.tokenCount,
        layer: 'L2',
        title: node.name
      };
    } else {
      return {
        content: node.layers.l1.content,
        tokenCount: node.layers.l1.tokenCount,
        layer: 'L1',
        title: node.name
      };
    }
  }

  public getTreeSummary(): VfsTreeSummary {
    let totalNodes = 0;
    let totalDirectories = 0;
    let totalFiles = 0;
    let totalL0Tokens = 0;
    let totalL1Tokens = 0;
    let totalL2Tokens = 0;
    let memories = 0;
    let resources = 0;
    let skills = 0;
    let sessions = 0;

    for (const node of this.nodes.values()) {
      totalNodes++;
      if (node.type === 'directory') {
        totalDirectories++;
      } else {
        totalFiles++;
        if (node.layers) {
          totalL0Tokens += node.layers.l0.tokenCount;
          totalL1Tokens += node.layers.l1.tokenCount;
          totalL2Tokens += node.layers.l2.tokenCount;
        }
      }

      if (node.uri.includes('.memories')) memories++;
      else if (node.uri.includes('resources')) resources++;
      else if (node.uri.includes('skills')) skills++;
      else if (node.uri.includes('sessions')) sessions++;
    }

    const overallTokenSavingsPct = totalL2Tokens > 0
      ? Math.max(0, Math.round(((totalL2Tokens - totalL0Tokens) / totalL2Tokens) * 100))
      : 0;

    return {
      totalNodes,
      totalDirectories,
      totalFiles,
      totalL0Tokens,
      totalL1Tokens,
      totalL2Tokens,
      overallTokenSavingsPct,
      namespaces: {
        memories,
        resources,
        skills,
        sessions
      }
    };
  }

  public resetToDefaults(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.seedDefaultFilesystem();
  }

  public exportJson(): string {
    return JSON.stringify(Array.from(this.nodes.values()), null, 2);
  }

  public importJson(jsonStr: string): boolean {
    try {
      const parsed: VfsNode[] = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.nodes = new Map(parsed.map(n => [this.normalizeUri(n.uri), n]));
        this.rebuildChildPointers();
        this.persist();
        return true;
      }
    } catch (e) {
      console.error('Failed to import VFS JSON', e);
    }
    return false;
  }
}

export const vfsStorageService = new VfsStorageService();
