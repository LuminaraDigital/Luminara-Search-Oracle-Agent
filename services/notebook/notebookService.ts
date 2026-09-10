/**
 * Luminara Intelligence Studio Service
 * 
 * Manages source-grounded research notebooks, strict citation RAG querying,
 * source ingestion (URLs, audits, DNA, text, files), and studio artifacts
 * (Briefing Docs, Study Guides, FAQs, Timelines, Comparison Matrices).
 */

import {
  Notebook,
  NotebookSource,
  NotebookMessage,
  NotebookCitation,
  StudioArtifact,
  StudioArtifactType,
  NotebookNote,
  BusinessDNA,
  OracleMode,
} from '../../types';
import { aiProviderService } from '../aiProviderService';
import { UnifiedScraperService } from '../scraping/unifiedScraper';
import { noteWorkspaceDirty } from '../sync/workspaceSyncService';

const NOTEBOOKS_STORAGE_KEY = 'luminara_studio_dossiers';
const LEGACY_NOTEBOOKS_KEY = 'luminara_notebooklm_dossiers';
const ACTIVE_NOTEBOOK_KEY = 'luminara_studio_active_id';
const LEGACY_ACTIVE_KEY = 'luminara_notebooklm_active_id';

export const DEMO_NOTEBOOK: Notebook = {
  id: 'demo-notebook-aeo',
  title: 'Competitor AEO & Search Visibility Benchmark',
  description: 'Grounded intelligence comparing top ranking competitors, entity graph authority, and generative AI search presence.',
  createdAt: 1726000000000,
  updatedAt: 1726000000000,
  sources: [
    {
      id: 'src-1',
      title: 'Luminara AEO Playbook & Entity Guidelines',
      type: 'text',
      content: `# Luminara Answer Engine Optimization (AEO) Playbook

## Core Principles
Answer Engine Optimization (AEO) focuses on securing brand mentions and citations across generative AI engines (ChatGPT, Google AI Overviews, Perplexity, Gemini). 

1. Entity Authority: AI engines resolve brands via Schema.org entity graphs. An unambiguous Organization schema linked to Wikidata and Crunchbase is the highest-leverage asset.
2. Direct Answer Architecture: Content structured with concise 40-60 word definitive answers directly under H2 headers wins 73% more AI Overviews citations than long-form narrative.
3. Plain English Defensibility: Content scored at an 8th-grade reading level outperforms complex jargon because LLMs prefer clear, unhedged factual statements.
4. Information Gain: Generative search engines penalize regurgitated content. Original benchmark statistics, proprietary methodology, and first-party case studies are prioritized for citation.`,
      summary: 'Guidelines for winning AI citations through Schema entity graphs and direct answer architecture.',
      wordCount: 138,
      addedAt: 1726000000000,
      selected: true,
      keyEntities: ['AEO', 'Schema.org', 'AI Overviews', 'Entity Authority', 'Information Gain'],
    },
    {
      id: 'src-2',
      title: 'Competitor Intelligence: ApexRank & SearchPilot Audit',
      type: 'audit',
      content: `# Competitor Audit Report: ApexRank.io vs SearchPilot.com

## ApexRank.io Analysis
- Overall Visibility Score: 64/100
- AI Overviews Citation Rate: 28%
- Entity Graph Status: Incomplete (Missing sameAs links to Wikidata, orphaned Product nodes)
- Key Vulnerability: Heavy reliance on legacy 2021-style keyword stuffing. No direct FAQ or HowTo markup. Average reading level grade 14 (too dense for concise AI retrieval).

## SearchPilot.com Analysis
- Overall Visibility Score: 82/100
- AI Overviews Citation Rate: 65%
- Entity Graph Status: Robust JSON-LD Organization graph with founder mentions and verified credentials.
- Winning Play: Publishes weekly A/B testing statistical data which generative engines frequently quote as primary source evidence.`,
      summary: 'Audit of two leading competitors highlighting entity schema strengths and weaknesses.',
      wordCount: 114,
      addedAt: 1726000100000,
      selected: true,
      keyEntities: ['ApexRank', 'SearchPilot', 'Visibility Score', 'Citation Rate', 'JSON-LD'],
    },
    {
      id: 'src-3',
      title: 'Google AI Overviews & Perplexity Algorithm Shifts',
      type: 'url',
      url: 'https://developers.google.com/search/docs/fundamentals/ai-search',
      content: `# Grounding & Retrieval Shifts in Generative Search Engines

Recent evaluations of Google AI Overviews and Perplexity Pro indicate:
- Multi-Source Consensus: Queries triggering AI Overviews synthesize answers from an average of 3.4 distinct sources.
- Consensus Bias: If your site makes an empirical claim contradicted by 3 trusted authoritative domains, AI Overviews filters your brand out.
- Technical Prerequisites: 
  * TTFB under 400ms for crawler responsiveness.
  * Clean semantic HTML5 (nav, main, article, section) without DOM hydration traps.
  * HTTPS and valid HSTS headers.`,
      summary: 'Technical prerequisites and consensus thresholds for generative search engines.',
      wordCount: 92,
      addedAt: 1726000200000,
      selected: true,
      keyEntities: ['Multi-Source Consensus', 'Consensus Bias', 'TTFB', 'Semantic HTML5'],
    },
  ],
  messages: [
    {
      id: 'msg-demo-1',
      role: 'user',
      content: 'What is our main strategic advantage over ApexRank, and what should we ship first?',
      timestamp: 1726000300000,
    },
    {
      id: 'msg-demo-2',
      role: 'assistant',
      content: `Based on your analyzed sources, your main strategic advantage over ApexRank is that ApexRank suffers from an incomplete entity graph and an overly dense 14th-grade reading level, leading to a weak 28% AI citation rate [2]. 

To capitalize on this, you should ship two moves immediately:
1. **Direct Answer Structuring**: Format your core service pages with 40–60 word definitive answers directly under H2 headers [1].
2. **Proprietary Benchmark Data**: Like SearchPilot (who achieves a 65% citation rate [2]), publish first-party empirical statistics to trigger multi-source consensus in AI Overviews [1], [3].`,
      timestamp: 1726000310000,
      citations: [
        {
          sourceId: 'src-2',
          sourceTitle: 'Competitor Intelligence: ApexRank & SearchPilot Audit',
          citationNumber: 2,
          quote: 'ApexRank.io: AI Overviews Citation Rate: 28% ... Missing sameAs links to Wikidata ... Average reading level grade 14',
        },
        {
          sourceId: 'src-1',
          sourceTitle: 'Luminara AEO Playbook & Entity Guidelines',
          citationNumber: 1,
          quote: 'Content structured with concise 40-60 word definitive answers directly under H2 headers wins 73% more AI Overviews citations',
        },
        {
          sourceId: 'src-3',
          sourceTitle: 'Google AI Overviews & Perplexity Algorithm Shifts',
          citationNumber: 3,
          quote: 'Queries triggering AI Overviews synthesize answers from an average of 3.4 distinct sources.',
        },
      ],
    },
  ],
  audioOverview: {
    id: 'audio-demo-1',
    title: 'Executive Deep Dive: Dominating Competitor AI Citations',
    createdAt: 1726000400000,
    summary: 'Alex and Sam discuss how to exploit ApexRank\'s schema gaps and adopt SearchPilot\'s empirical data engine to win AI Overviews citations.',
    script: [
      {
        speaker: 'Alex',
        text: "Welcome back. Today we're diving into an eye-opening dossier on Answer Engine Optimization and competitor visibility.",
        durationEstimateMs: 6500,
      },
      {
        speaker: 'Sam',
        text: "Right! And what jumped out at me immediately is the contrast between SearchPilot and ApexRank. SearchPilot is pulling in a 65% citation rate, while ApexRank is languishing down at 28%.",
        durationEstimateMs: 8200,
      },
      {
        speaker: 'Alex',
        text: "Exactly. And the dossier breaks down why: ApexRank is writing at a 14th-grade reading level with broken Schema entity nodes. LLMs literally can't parse who they are or verify their claims.",
        durationEstimateMs: 9000,
      },
      {
        speaker: 'Sam',
        text: "Whereas SearchPilot publishes original A/B testing data. In the world of AI Overviews, generative models crave consensus and first-party numbers.",
        durationEstimateMs: 7800,
      },
      {
        speaker: 'Alex',
        text: "The immediate action here is clear: 40-to-60 word direct answers under your H2s, plus robust Organization JSON-LD linked to Wikidata. That's your unfair advantage.",
        durationEstimateMs: 8500,
      },
    ],
  },
  artifacts: [
    {
      id: 'art-demo-1',
      type: 'briefing_doc',
      title: 'Executive Briefing: AEO Competitor Landscape',
      createdAt: 1726000500000,
      content: `# Executive Briefing: AEO Competitor Landscape

## Key Strategic Takeaways
- **The Opportunity**: ApexRank is vulnerable due to neglected Schema.org entity architecture and overly complex prose.
- **The Blueprint**: SearchPilot proves that publishing proprietary benchmark statistics wins citations across ChatGPT and Google AI Overviews.
- **Immediate Action**: Implement concise 40-60 word direct answers below H2 headings and complete the brand's Wikidata sameAs entity graph.`,
    },
  ],
  notes: [
    {
      id: 'note-demo-1',
      title: 'Action Item: Entity Schema Expansion',
      content: 'Add sameAs links for Wikidata, LinkedIn, and Crunchbase into our root Organization JSON-LD before the end of the sprint.',
      createdAt: 1726000600000,
      updatedAt: 1726000600000,
      pinned: true,
      tags: ['Schema', 'Priority 1'],
    },
  ],
};

export class NotebookService {
  private static instance: NotebookService;

  private constructor() {}

  public static getInstance(): NotebookService {
    if (!NotebookService.instance) {
      NotebookService.instance = new NotebookService();
    }
    return NotebookService.instance;
  }

  // -------------------------------------------------------------------------
  // Notebook Persistence & CRUD
  // -------------------------------------------------------------------------

  public listNotebooks(): Notebook[] {
    if (typeof window === 'undefined') return [DEMO_NOTEBOOK];
    try {
      const raw = localStorage.getItem(NOTEBOOKS_STORAGE_KEY) || localStorage.getItem(LEGACY_NOTEBOOKS_KEY);
      if (!raw) {
        // Initialize with default demo notebook
        this.saveNotebooks([DEMO_NOTEBOOK]);
        return [DEMO_NOTEBOOK];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEMO_NOTEBOOK];
    } catch {
      return [DEMO_NOTEBOOK];
    }
  }

  public getNotebook(id: string): Notebook | null {
    const notebooks = this.listNotebooks();
    return notebooks.find(n => n.id === id) || null;
  }

  public getActiveNotebookId(): string {
    if (typeof window === 'undefined') return DEMO_NOTEBOOK.id;
    try {
      const saved = localStorage.getItem(ACTIVE_NOTEBOOK_KEY) || localStorage.getItem(LEGACY_ACTIVE_KEY);
      if (saved) return saved;
    } catch {}
    const notebooks = this.listNotebooks();
    return notebooks[0]?.id || DEMO_NOTEBOOK.id;
  }

  public setActiveNotebookId(id: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(ACTIVE_NOTEBOOK_KEY, id);
    } catch {}
  }

  public createNotebook(title: string, description?: string): Notebook {
    const newNotebook: Notebook = {
      id: `nb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim() || 'Untitled Notebook',
      description: description?.trim() || '',
      sources: [],
      messages: [],
      artifacts: [],
      notes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const notebooks = this.listNotebooks();
    this.saveNotebooks([newNotebook, ...notebooks]);
    this.setActiveNotebookId(newNotebook.id);
    return newNotebook;
  }

  public updateNotebook(id: string, patch: Partial<Notebook>): Notebook | null {
    const notebooks = this.listNotebooks();
    const index = notebooks.findIndex(n => n.id === id);
    if (index === -1) return null;

    const updated: Notebook = {
      ...notebooks[index],
      ...patch,
      updatedAt: Date.now(),
    };

    notebooks[index] = updated;
    this.saveNotebooks(notebooks);
    return updated;
  }

  public deleteNotebook(id: string): boolean {
    const notebooks = this.listNotebooks();
    const filtered = notebooks.filter(n => n.id !== id);
    if (filtered.length === notebooks.length) return false;

    // Keep at least one notebook
    if (filtered.length === 0) {
      filtered.push(DEMO_NOTEBOOK);
    }

    this.saveNotebooks(filtered);
    if (this.getActiveNotebookId() === id) {
      this.setActiveNotebookId(filtered[0].id);
    }
    return true;
  }

  private saveNotebooks(notebooks: Notebook[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(NOTEBOOKS_STORAGE_KEY, JSON.stringify(notebooks));
      noteWorkspaceDirty();
    } catch (e) {
      console.warn('[NotebookService] Failed to save notebooks', e);
    }
  }

  // -------------------------------------------------------------------------
  // Source Ingestion
  // -------------------------------------------------------------------------

  public async addUrlSource(notebookId: string, rawUrl: string): Promise<NotebookSource | null> {
    const cleanUrl = rawUrl.trim().startsWith('http') ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    let title = cleanUrl;
    let content = '';
    let summary = '';

    try {
      const scraper = UnifiedScraperService.getInstance();
      const scrapeResult = await scraper.scrapeAndDistill(cleanUrl);
      if (scrapeResult.success && scrapeResult.markdown) {
        title = scrapeResult.title || cleanUrl;
        content = scrapeResult.markdown;
        summary = scrapeResult.description || content.slice(0, 200) + '...';
      } else {
        throw new Error(scrapeResult.error || 'Scraper did not return content');
      }
    } catch {
      // Fallback: create placeholder source noting the URL
      title = cleanUrl.replace(/^https?:\/\//i, '').split('/')[0];
      content = `# Source: ${cleanUrl}\n\nURL ingested for grounded intelligence. (Live content extraction limited; basic domain notes recorded).`;
      summary = `Source from ${title}`;
    }

    const source: NotebookSource = {
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.slice(0, 100),
      type: 'url',
      url: cleanUrl,
      content,
      summary,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      addedAt: Date.now(),
      selected: true,
      keyEntities: this.extractKeywords(content),
    };

    this.appendSourceToNotebook(notebookId, source);
    return source;
  }

  public addTextSource(notebookId: string, title: string, text: string): NotebookSource {
    const trimmedTitle = title.trim() || 'Pasted Notes';
    const trimmedContent = text.trim();
    const source: NotebookSource = {
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: trimmedTitle.slice(0, 100),
      type: 'text',
      content: trimmedContent,
      summary: trimmedContent.slice(0, 200) + (trimmedContent.length > 200 ? '...' : ''),
      wordCount: trimmedContent.split(/\s+/).filter(Boolean).length,
      addedAt: Date.now(),
      selected: true,
      keyEntities: this.extractKeywords(trimmedContent),
    };

    this.appendSourceToNotebook(notebookId, source);
    return source;
  }

  public addAuditSource(notebookId: string, domain: string, auditMarkdown: string): NotebookSource {
    const title = `Audit Report: ${domain}`;
    const source: NotebookSource = {
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      type: 'audit',
      content: auditMarkdown,
      summary: `SEO, AEO, and GEO diagnostic brief for ${domain}.`,
      wordCount: auditMarkdown.split(/\s+/).filter(Boolean).length,
      addedAt: Date.now(),
      selected: true,
      keyEntities: this.extractKeywords(auditMarkdown),
    };

    this.appendSourceToNotebook(notebookId, source);
    return source;
  }

  public addDnaSource(notebookId: string, dna: BusinessDNA): NotebookSource {
    const content = `# Business Profile: ${dna.name}
- Industry: ${dna.industry || 'Unspecified'}
- Unique Selling Proposition: ${dna.usp || 'None specified'}
- Target Audience: ${dna.targetAudience || 'General'}
- Key Competitors: ${(dna.competitors || []).join(', ') || 'None specified'}
- Brand Mission: ${dna.mission || 'None specified'}
- Context: ${dna.rawContext || ''}`;

    const source: NotebookSource = {
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `Business DNA: ${dna.name}`,
      type: 'dna',
      content,
      summary: `Strategic business profile and competitor benchmarks for ${dna.name}.`,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      addedAt: Date.now(),
      selected: true,
      keyEntities: [dna.name, dna.industry || '', ...(dna.competitors || [])].filter(Boolean) as string[],
    };

    this.appendSourceToNotebook(notebookId, source);
    return source;
  }

  public async addFileSource(notebookId: string, file: File): Promise<NotebookSource> {
    const text = await file.text();
    const source: NotebookSource = {
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: file.name,
      type: 'file',
      content: text,
      summary: `Uploaded document: ${file.name} (${Math.round(file.size / 1024)} KB)`,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      addedAt: Date.now(),
      selected: true,
      keyEntities: this.extractKeywords(text),
    };

    this.appendSourceToNotebook(notebookId, source);
    return source;
  }

  public toggleSourceSelection(notebookId: string, sourceId: string): void {
    const nb = this.getNotebook(notebookId);
    if (!nb) return;
    const sources = nb.sources.map(s => s.id === sourceId ? { ...s, selected: !s.selected } : s);
    this.updateNotebook(notebookId, { sources });
  }

  public toggleAllSources(notebookId: string, selected: boolean): void {
    const nb = this.getNotebook(notebookId);
    if (!nb) return;
    const sources = nb.sources.map(s => ({ ...s, selected }));
    this.updateNotebook(notebookId, { sources });
  }

  public removeSource(notebookId: string, sourceId: string): void {
    const nb = this.getNotebook(notebookId);
    if (!nb) return;
    const sources = nb.sources.filter(s => s.id !== sourceId);
    this.updateNotebook(notebookId, { sources });
  }

  private appendSourceToNotebook(notebookId: string, source: NotebookSource): void {
    const nb = this.getNotebook(notebookId);
    if (!nb) return;
    this.updateNotebook(notebookId, { sources: [source, ...nb.sources] });
  }

  // -------------------------------------------------------------------------
  // Grounded RAG Chat with Citation Extraction
  // -------------------------------------------------------------------------

  public async queryNotebook(
    notebookId: string,
    query: string,
    _mode: OracleMode = OracleMode.FLASH
  ): Promise<NotebookMessage> {
    const nb = this.getNotebook(notebookId);
    if (!nb) throw new Error('Notebook not found');

    const activeSources = nb.sources.filter(s => s.selected);
    if (activeSources.length === 0) {
      const fallbackMsg: NotebookMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'No sources are currently selected in this notebook. Please select or add at least one source on the left to ground my answer.',
        timestamp: Date.now(),
      };
      this.appendMessageToNotebook(notebookId, {
        id: `user-${Date.now()}`,
        role: 'user',
        content: query,
        timestamp: Date.now(),
      });
      this.appendMessageToNotebook(notebookId, fallbackMsg);
      return fallbackMsg;
    }

    // Build Grounding Context
    const formattedCorpus = activeSources.map((s, idx) => {
      return `--- [SOURCE ${idx + 1}: ${s.title}] (ID: ${s.id}) ---\n${s.content.slice(0, 4000)}\n`;
    }).join('\n\n');

    const systemPrompt = `You are a strict, grounded research intelligence engine (Luminara Grounded Intelligence standard).
You answer questions ONLY using facts provided in the following SOURCES.

Grounding Rules:
1. Ground every claim directly in the provided sources. Do not invent or assume facts not in the sources.
2. If the answer cannot be found in the sources, clearly state: "The provided sources do not contain this information."
3. Cite sources inline using bracketed numbers like [1], [2] immediately following the cited statement.
4. Output your response in natural, authoritative Markdown.
5. At the very end of your response, add a section exactly formatted as:
<!-- CITATIONS -->
[1]: "Exact quote or excerpt from Source 1 supporting this statement"
[2]: "Exact quote or excerpt from Source 2 supporting this statement"
<!-- END_CITATIONS -->

SOURCES:
${formattedCorpus}
`;

    const userMessage: NotebookMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };
    this.appendMessageToNotebook(notebookId, userMessage);

    let rawOutput = '';
    try {
      const response = await aiProviderService.generateWithFallback(query, {
        systemPrompt,
        temperature: 0.3,
        maxTokens: 2048,
      });
      rawOutput = response.text || '';
    } catch (err: any) {
      console.error('[NotebookService] LLM query failed', err);
      rawOutput = `I encountered an issue connecting to the AI language model (${err?.message || 'Check your API keys in Settings'}). However, your ${activeSources.length} sources are securely stored and indexed.`;
    }

    // Parse inline citations and quotes
    const { cleanContent, citations } = this.parseCitations(rawOutput, activeSources);

    const assistantMessage: NotebookMessage = {
      id: `asst-${Date.now()}`,
      role: 'assistant',
      content: cleanContent,
      timestamp: Date.now(),
      citations,
    };

    this.appendMessageToNotebook(notebookId, assistantMessage);
    return assistantMessage;
  }

  public parseCitations(raw: string, sources: NotebookSource[]): { cleanContent: string; citations: NotebookCitation[] } {
    const citationRegex = /<!-- CITATIONS -->([\s\S]*?)<!-- END_CITATIONS -->/i;
    const match = raw.match(citationRegex);
    const citations: NotebookCitation[] = [];
    let cleanContent = raw.replace(citationRegex, '').trim();

    if (match && match[1]) {
      const lines = match[1].split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const lineMatch = line.match(/^\[(\d+)\]:\s*["“]?([\s\S]+?)["”]?$/);
        if (lineMatch) {
          const num = parseInt(lineMatch[1], 10);
          const quote = lineMatch[2].trim();
          const targetSource = sources[num - 1] || sources[0];
          citations.push({
            sourceId: targetSource.id,
            sourceTitle: targetSource.title,
            citationNumber: num,
            quote,
          });
        }
      }
    } else {
      // Fallback citation extraction from inline [N]
      const inlineMatches = cleanContent.matchAll(/\[(\d+)\]/g);
      const seen = new Set<number>();
      for (const m of inlineMatches) {
        const num = parseInt(m[1], 10);
        if (!seen.has(num) && sources[num - 1]) {
          seen.add(num);
          const src = sources[num - 1];
          citations.push({
            sourceId: src.id,
            sourceTitle: src.title,
            citationNumber: num,
            quote: src.summary || src.content.slice(0, 150) + '...',
          });
        }
      }
    }

    return { cleanContent, citations };
  }

  private appendMessageToNotebook(notebookId: string, msg: NotebookMessage): void {
    const nb = this.getNotebook(notebookId);
    if (!nb) return;
    this.updateNotebook(notebookId, { messages: [...nb.messages, msg] });
  }

  // -------------------------------------------------------------------------
  // Studio Artifact Generators
  // -------------------------------------------------------------------------

  public async generateArtifact(notebookId: string, type: StudioArtifactType): Promise<StudioArtifact> {
    const nb = this.getNotebook(notebookId);
    if (!nb) throw new Error('Notebook not found');

    const activeSources = nb.sources.filter(s => s.selected);
    if (activeSources.length === 0) {
      throw new Error('Please select at least one source in the notebook before generating an artifact.');
    }

    const corpusText = activeSources.map((s, i) => `[Source ${i + 1}: ${s.title}]\n${s.content.slice(0, 3000)}`).join('\n\n');

    let prompt = '';
    let title = '';

    switch (type) {
      case 'briefing_doc':
        title = `Executive Briefing: ${nb.title}`;
        prompt = `Generate a high-level, executive-ready Briefing Document synthesizing the key findings, critical insights, opportunities, and strategic risks contained in the provided sources. Format with clear Markdown headings, bullet points, and an 'Actionable Takeaways' section.`;
        break;
      case 'study_guide':
        title = `Study Guide & Playbook: ${nb.title}`;
        prompt = `Generate a comprehensive Study Guide and Playbook based on the sources. Include: 1) Executive Summary, 2) Key Terms & Concepts, 3) Critical Syntheses, 4) Practice/Self-Assessment Questions with Answers, 5) Recommended Next Steps.`;
        break;
      case 'faq':
        title = `Strategic FAQ: ${nb.title}`;
        prompt = `Generate 6 to 10 insightful, frequently asked questions and high-impact answers strictly grounded in the provided sources. Group into thematic categories if helpful.`;
        break;
      case 'timeline':
        title = `Strategic Execution Roadmap: ${nb.title}`;
        prompt = `Generate a phased chronological execution timeline / roadmap based on the milestones, initiatives, and steps derived from the sources. Structure into Phase 1 (Immediate), Phase 2 (Mid-term), and Phase 3 (Compounding Scale).`;
        break;
      case 'comparison_matrix':
        title = `Comparison & Competitive Matrix: ${nb.title}`;
        prompt = `Generate a side-by-side Markdown comparison matrix / table comparing the key entities, competitors, or concepts described across the sources. Include columns for Entity/Subject, Visibility/Capability, Key Strengths, Vulnerabilities, and Strategic Score.`;
        break;
    }

    const systemPrompt = `You are the Luminara Intelligence Studio synthesizer.
Synthesize the provided sources into a world-class documentation artifact.
Strictly ground all points in the sources.

SOURCES:
${corpusText}
`;

    let generatedContent = '';
    try {
      const res = await aiProviderService.generateWithFallback(prompt, {
        systemPrompt,
        temperature: 0.4,
        maxTokens: 3000,
      });
      generatedContent = res.text || '';
    } catch (err: any) {
      generatedContent = `# ${title}\n\nCould not generate artifact automatically (${err?.message || 'Check API keys'}). Sources are loaded.`;
    }

    const artifact: StudioArtifact = {
      id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      content: generatedContent,
      createdAt: Date.now(),
    };

    const artifacts = [artifact, ...nb.artifacts.filter(a => a.type !== type)];
    this.updateNotebook(notebookId, { artifacts });
    return artifact;
  }

  // -------------------------------------------------------------------------
  // Notes & Scratchpad
  // -------------------------------------------------------------------------

  public addNote(notebookId: string, title: string, content: string, tags?: string[]): NotebookNote {
    const nb = this.getNotebook(notebookId);
    if (!nb) throw new Error('Notebook not found');

    const note: NotebookNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim() || 'Untitled Note',
      content: content.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags,
    };

    const notes = [note, ...nb.notes];
    this.updateNotebook(notebookId, { notes });
    return note;
  }

  public updateNote(notebookId: string, noteId: string, patch: Partial<NotebookNote>): void {
    const nb = this.getNotebook(notebookId);
    if (!nb) return;
    const notes = nb.notes.map(n => n.id === noteId ? { ...n, ...patch, updatedAt: Date.now() } : n);
    this.updateNotebook(notebookId, { notes });
  }

  public deleteNote(notebookId: string, noteId: string): void {
    const nb = this.getNotebook(notebookId);
    if (!nb) return;
    const notes = nb.notes.filter(n => n.id !== noteId);
    this.updateNotebook(notebookId, { notes });
  }

  public exportNotebookMarkdown(notebookId: string): string {
    const nb = this.getNotebook(notebookId);
    if (!nb) return '';

    const lines: string[] = [
      `# ${nb.title}`,
      nb.description ? `*${nb.description}*\n` : '',
      `## Sources (${nb.sources.length})`,
      ...nb.sources.map(s => `- **${s.title}** (${s.type}): ${s.wordCount} words`),
      '',
      `## Saved Notes (${nb.notes.length})`,
      ...nb.notes.map(n => `### ${n.title}\n\n${n.content}\n`),
      '',
      `## Generated Studio Artifacts (${nb.artifacts.length})`,
      ...nb.artifacts.map(a => `### ${a.title}\n\n${a.content}\n`),
      '',
      `## Grounded Q&A Transcript (${nb.messages.length} messages)`,
      ...nb.messages.map(m => `**${m.role === 'user' ? 'User' : 'Luminara'}**: ${m.content}\n`),
    ];

    return lines.join('\n');
  }

  private extractKeywords(text: string): string[] {
    const words = text
      .replace(/[#*`_~[\]()<>]/g, ' ')
      .split(/\s+/)
      .map(w => w.replace(/[^a-zA-Z0-9-]/g, ''))
      .filter(w => w.length > 4 && !['about', 'their', 'which', 'there', 'would', 'could', 'should', 'these'].includes(w.toLowerCase()));
    const counts = new Map<string, number>();
    for (const w of words) {
      const lower = w.toLowerCase();
      counts.set(lower, (counts.get(lower) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
  }
}

export const notebookService = NotebookService.getInstance();
