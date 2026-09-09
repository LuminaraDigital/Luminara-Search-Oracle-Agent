import { GoogleGenAI, Type } from "@google/genai";
import { OracleMode, ToolExecution, BusinessDNA, ReportFocus, OrganizerFormat, OrganizerSchema, ChatTurn } from "../types";
import { SYSTEM_INSTRUCTIONS } from "../constants";
import { vfsRetrievalService } from "./vfs/vfsRetrievalService";
import { vfsMemoryService } from "./vfs/vfsMemoryService";
import { configService } from "./configService";
import { aiProviderService, safeJsonParse } from "./aiProviderService";
import { tavilyService } from "./search/tavilyService";
import { localSerpService } from "./search/localSerpService";
import { firecrawlService } from "./scraping/firecrawlService";
import { unifiedScraperService } from "./scraping/unifiedScraper";
import { geminiProxyHttpOptions } from "./apiClient";
import { wrapUntrustedContent } from "../utils/untrustedContent";

export interface StreamChunk {
  text?: string;
  groundingUrls?: Array<{ uri: string; title: string }>;
  /** Real tool activity (e.g. a completed SERP search) so the UI can show honest progress. */
  toolExecution?: ToolExecution;
}

export interface StreamQueryOptions {
  history?: ChatTurn[];
  /** Skip the live SERP lookup (e.g. for "simplify this" follow-ups that need no fresh evidence). */
  skipSearch?: boolean;
}

import { empiricalCitationService, type EmpiricalCitationSummary } from './audit/empiricalCitationService';
import { cmsDeploymentService, type RemediationPayload } from './deployment/cmsDeploymentService';
import { aeoCorpusService } from './corpus/aeoCorpusService';
import { publicApisEnrichmentService, type EnrichedEntityIntelligence } from './enrichment/publicApisEnrichmentService';
import { writingQualityService, type WritingQualityReport } from './audit/writingQualityService';
import { trafficInsightsService, type TrafficImpact } from './analytics/trafficInsightsService';
import { citationIntegrityService, type CitationIntegrityResult } from './audit/citationIntegrityService';
import { aeoTrustPackService, type TrustPackSummary } from './audit/aeoTrustPackService';
import { schemaSafetyGate } from './deployment/schemaSafetyGate';
import { shareOfVoiceService, type ShareOfVoiceSummary } from './visibility/shareOfVoiceService';
import { sourceCitationGraphService, type SourceCitationGraph } from './visibility/sourceCitationGraphService';
import { enterpriseTrustPackService, type EnterpriseTrustPack } from './trust/enterpriseTrustPackService';
import { visibilityHistoryService } from './visibility/visibilityHistoryService';

export interface AuditReportResult {
  text: string;
  sources: Array<{ uri: string; title: string }>;
  empiricalSummary?: EmpiricalCitationSummary;
  remediationPayload?: RemediationPayload;
  unifiedDiff?: string;
  plainEnglishBrief?: string;
  enrichedEntity?: EnrichedEntityIntelligence;
  /** "Writing check" of the scraped page (grammar/style + readability). Absent when the page had too little text. */
  writingQuality?: WritingQualityReport;
  /** "Results tracking": measured traffic and AI/search referrals; check `status` before rendering numbers. */
  trafficImpact?: TrafficImpact;
  citationIntegrity?: CitationIntegrityResult;
  /** Alias for citationIntegrity (UI wiring). */
  integrity?: CitationIntegrityResult;
  trustPack?: TrustPackSummary;
  shareOfVoice?: ShareOfVoiceSummary;
  sourceGraph?: SourceCitationGraph;
  enterpriseTrust?: EnterpriseTrustPack;
}

import { shouldSearch, toSearchQuery } from './search/searchIntent';
import { planSearch } from './search/searchPlanner';
import { selectAuditPlaybooks, selectChatPlaybooks, playbookContext, inferLenses, type AuditLens } from './skills/seoPlaybooks';
import { toChatHistory } from './chat/messages';
export { shouldSearch, toChatHistory };

const toGeminiContents = (prompt: string, history?: ChatTurn[]) => [
  ...(history ?? []).slice(-20).map(t => ({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text: t.content }] })),
  { role: 'user', parts: [{ text: prompt }] },
];

/**
 * Runs the planned searches in parallel, keeps only well-scored, de-duplicated results and
 * formats them as evidence the model is told to use *only when relevant*.
 */
async function gatherSearchEvidence(prompt: string, dna: BusinessDNA | null | undefined, maxResults = 6): Promise<{
  contextText: string;
  sources: Array<{ uri: string; title: string }>;
  queries: string[];
  rationale: string;
}> {
  const plan = planSearch(prompt, dna);
  if (!plan) return { contextText: '', sources: [], queries: [], rationale: '' };

  const tavilyKey = configService.getTavilyKey();
  const localSerpEnabled = configService.isLocalSerpEnabled();
  if (!tavilyKey && !localSerpEnabled) return { contextText: '', sources: [], queries: [], rationale: '' };

  const seen = new Set<string>();
  const merged: Array<{ title: string; url: string; content: string; score?: number }> = [];
  let answers: string[] = [];
  let sourceLabel = 'Tavily Search';

  if (tavilyKey) {
    const responses = await Promise.all(
      plan.queries.map(q =>
        tavilyService.search(q, { maxResults: 4, includeAnswer: true }).catch(() => ({
          query: q,
          results: [] as any[],
          answer: undefined as string | undefined,
        }))
      )
    );
    for (const r of responses) {
      for (const item of r.results) {
        if (seen.has(item.url)) continue;
        if (typeof item.score === 'number' && item.score < 0.25) continue;
        seen.add(item.url);
        merged.push(item);
      }
    }
    answers = responses.map(r => r.answer).filter(Boolean) as string[];
  }

  // Additive zero-key / quota fallback: Query local SERP scraper if Tavily returned no results
  if (merged.length === 0 && localSerpEnabled) {
    const serpResponses = await Promise.all(
      plan.queries.map(q => localSerpService.search(q, { num: 4 }).catch(() => null))
    );
    for (const sr of serpResponses) {
      if (!sr || !sr.results || !sr.results.length) continue;
      sourceLabel = `Google Search via Sidecar (${sr.tier || 'Fast'})`;
      if (sr.featuredSnippet?.snippet) {
        answers.push(sr.featuredSnippet.snippet);
      } else if (sr.aiOverview?.text) {
        answers.push(sr.aiOverview.text);
      }
      for (const item of sr.results) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        merged.push({
          title: item.title,
          url: item.url,
          content: item.snippet,
          score: 0.9,
        });
      }
    }
  }

  if (merged.length === 0) return { contextText: '', sources: [], queries: [], rationale: '' };

  const top = merged.slice(0, maxResults);
  const lines: string[] = [
    `[LIVE EVIDENCE GATHERED VIA ${sourceLabel.toUpperCase()}]`,
    `Search Intent Rationale: ${plan.rationale}`,
    `Active Queries Executed: ${plan.queries.map(q => `"${q}"`).join(', ')}`,
    answers.length > 0 ? `Featured Engine Summary: ${answers[0]}` : '',
    '--------------------------------------------------',
    ...top.map((r, i) => `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\nExcerpt: ${r.content}\n`),
    '--------------------------------------------------',
    'GROUNDING RULES:',
    '- Quote or cite these sources when directly answering questions of current fact.',
    '- If the search results contradict previous assumptions, prioritize the live evidence.',
    '- If the evidence does not contain the answer, say so honestly rather than inventing facts.',
    '--------------------------------------------------',
  ];
  return {
    contextText: lines.join('\n'),
    sources: top.map(r => ({ uri: r.url, title: r.title })),
    queries: plan.queries,
    rationale: plan.rationale,
  };
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'No native LLM responded. Check your NVIDIA NIM, Groq, or Ollama connection in Settings.') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export const getApiKey = (): string => {
  return configService.getGeminiKey();
};

export class GeminiService {
  private getAI(): GoogleGenAI {
    const key = getApiKey();
    if (key === 'proxy') {
      // Worker injects the real key; the SDK still needs a non-empty apiKey to build requests.
      return new GoogleGenAI({ apiKey: 'proxy', httpOptions: geminiProxyHttpOptions() });
    }
    return new GoogleGenAI({ apiKey: key });
  }

  private getDNAContext(dna?: BusinessDNA | null): string {
    if (!dna) return "";
    return `
[STRATEGIC BUSINESS DNA LINKED]
Business Name: ${dna.name}
Mission: ${dna.mission}
Unique Selling Proposition (USP): ${dna.usp}
Target Audience: ${dna.targetAudience}
Primary Competitors: ${dna.competitors.join(", ")}
Identified Strategic Gaps: ${dna.perceivedGaps.join(", ")}
Context Synthesis: ${dna.rawContext}
--------------------------------------------------
Integrate this Strategic DNA into your analysis. Prioritize bridging identified gaps and maximizing USP authority.
`;
  }

  /**
   * Conversational streaming for Oracle Agent (Flash or Deep Think)
   * With automatic fallback to Groq / NVIDIA NIM and live Tavily SERP grounding
   */
  async *streamQuery(prompt: string, mode: OracleMode, dna?: BusinessDNA | null, opts: StreamQueryOptions = {}): AsyncGenerator<StreamChunk, void, unknown> {
    const geminiKey = getApiKey();
    const dnaContext = this.getDNAContext(dna);
    const history = opts.history ?? [];

    let vfsContext = '';
    try {
      const drrResult = vfsRetrievalService.retrieve(prompt, { tokenBudget: 1500 });
      if (drrResult.matchedItems.length > 0) {
        vfsContext = `\n[VIKING CONTEXT VFS RECURSIVE RETRIEVAL | ${drrResult.tokensUsed} TOKENS | ${drrResult.tokenSavingsPct}% SAVINGS]\n${drrResult.assembledContext}\n`;
      }
    } catch (e) {
      console.warn('VFS context retrieval fallback', e);
    }

    // Live Tavily SERP grounding
    let tavilyContext = '';
    let tavilySources: Array<{ uri: string; title: string }> = [];
    try {
      if (!opts.skipSearch) {
        const evidence = await gatherSearchEvidence(prompt, dna);
        if (evidence.contextText) {
          tavilyContext = `\n${evidence.contextText}\n`;
          tavilySources = evidence.sources;
          yield {
            toolExecution: {
              tool: 'live_search',
              args: { queries: evidence.queries, focus: evidence.rationale },
              output: `Checked live search results (${evidence.queries.length} ${evidence.queries.length === 1 ? 'query' : 'queries'}, ${tavilySources.length} sources)`,
            },
          };
        }
      }
    } catch (e) {
      console.warn('Search grounding fallback', e);
    }

    const chatPlaybooks = opts.skipSearch ? '' : playbookContext(selectChatPlaybooks(prompt), 9000);
    const grounded = tavilyContext ? wrapUntrustedContent('LIVE_SEARCH', tavilyContext) : '';
    const fullPrompt = `${dnaContext ? dnaContext + '\n\n' : ''}${chatPlaybooks ? chatPlaybooks + '\n\n' : ''}${vfsContext ? vfsContext + '\n\n' : ''}${grounded ? grounded + '\n\n' : ''}USER DIRECTIVE:\n${prompt}`;

    // 1. Primary Native LLM Focus: Groq LPU / NVIDIA NIM / Ollama Local & Cloud
    // With automatic native engine discovery, searching, and instant auto-failover
    try {
      const bestNative = await aiProviderService.getBestAvailableProvider();
      if (bestNative) {
        let isFirst = true;
        for await (const chunk of aiProviderService.streamWithFailover(fullPrompt, {
          systemPrompt: SYSTEM_INSTRUCTIONS,
          temperature: mode === OracleMode.DEEP_THINK ? 0.4 : 0.7,
          history,
        })) {
          if (isFirst && tavilySources.length > 0) {
            yield { ...chunk, groundingUrls: tavilySources };
            isFirst = false;
          } else {
            yield chunk;
          }
        }
        return;
      }
    } catch (nativeErr) {
      console.warn("Native Trinity Streaming failed, falling back to secondary providers...", nativeErr);
    }

    // 2. Secondary Fallback: Gemini (only if native engines unavailable or exhausted)
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const model = mode === OracleMode.DEEP_THINK ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
        const config: any = {
          systemInstruction: SYSTEM_INSTRUCTIONS,
          tools: [{ googleSearch: {} }],
        };

        if (mode === OracleMode.DEEP_THINK) {
          config.thinkingConfig = { thinkingBudget: 32768 };
        }

        const result = await ai.models.generateContentStream({
          model,
          contents: toGeminiContents(fullPrompt, history),
          config,
        });

        for await (const chunk of result) {
          const responseChunk: StreamChunk = {};
          if (chunk.text) {
            responseChunk.text = chunk.text;
          }

          const candidate = chunk.candidates?.[0];
          const groundingChunks = candidate?.groundingMetadata?.groundingChunks;
          if (groundingChunks) {
            const urls: Array<{ uri: string; title: string }> = [];
            groundingChunks.forEach((c: any) => {
              if (c.web) {
                urls.push({ uri: c.web.uri, title: c.web.title || c.web.uri });
              }
            });
            if (urls.length > 0) {
              responseChunk.groundingUrls = urls;
            }
          } else if (tavilySources.length > 0) {
            responseChunk.groundingUrls = tavilySources;
          }

          yield responseChunk;
        }
        return;
      } catch (geminiError) {
        console.warn("Gemini Streaming Error:", geminiError);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * Deep heuristic audit simulation with Code Execution, Tavily Search, and Multi-LLM fallback
   */
  async queryWithSearch(prompt: string, dna?: BusinessDNA | null, opts: StreamQueryOptions = {}): Promise<{
    text: string;
    urls: Array<{ uri: string; title: string }>;
    toolExecutions: ToolExecution[];
  }> {
    const toolExecutions: ToolExecution[] = [];
    const dnaContext = this.getDNAContext(dna);
    const history = opts.history ?? [];

    let vfsContext = '';
    try {
      const drrResult = vfsRetrievalService.retrieve(prompt, { tokenBudget: 2000 });
      if (drrResult.matchedItems.length > 0) {
        vfsContext = `\n[VIKING CONTEXT VFS RECURSIVE RETRIEVAL | ${drrResult.tokensUsed} TOKENS | ${drrResult.tokenSavingsPct}% SAVINGS]\n${drrResult.assembledContext}\n`;
      }
    } catch (e) {
      console.warn('VFS context retrieval fallback', e);
    }

    let searchContext = '';
    let foundUrls: Array<{ uri: string; title: string }> = [];

    // Execute live Tavily Search
    if (!opts.skipSearch) {
      try {
        const evidence = await gatherSearchEvidence(prompt, dna);
        if (evidence.contextText) {
          toolExecutions.push({
            tool: 'live_search',
            args: { queries: evidence.queries, focus: evidence.rationale },
            output: `Checked live search results (${evidence.sources.length} sources)`,
          });
          foundUrls = evidence.sources;
          searchContext = `\n${evidence.contextText}\n`;
        }
      } catch (e) {
        console.warn('Search grounding error', e);
      }
    }

    const fullPrompt = `${dnaContext ? dnaContext + '\n\n' : ''}${vfsContext ? vfsContext + '\n\n' : ''}${searchContext ? searchContext + '\n\n' : ''}USER DIRECTIVE:\n${prompt}`;

    // 1. Primary Native LLM Focus: Groq LPU / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(fullPrompt, {
          systemPrompt: SYSTEM_INSTRUCTIONS,
          temperature: 0.5,
          history,
        });

        return {
          text: result.text,
          urls: foundUrls,
          toolExecutions,
        };
      }
    } catch (e) {
      console.warn('Native Trinity queryWithSearch failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const response = await ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: toGeminiContents(fullPrompt, history),
          config: {
            systemInstruction: SYSTEM_INSTRUCTIONS,
            tools: [{ googleSearch: {} }, { codeExecution: {} }],
          }
        });

        const text = response.text || "";
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (groundingChunks) {
          groundingChunks.forEach((chunk: any) => {
            if (chunk.web) {
              foundUrls.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri });
            }
          });
        }

        // Gemini code execution surfaces as executableCode / codeExecutionResult parts, not function calls.
        const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
        let pendingCode: string | null = null;
        for (const part of parts) {
          if (part.executableCode?.code) pendingCode = part.executableCode.code;
          if (part.codeExecutionResult && pendingCode) {
            toolExecutions.push({
              tool: 'python_interpreter',
              code: pendingCode,
              output: String(part.codeExecutionResult.output ?? ''),
            });
            pendingCode = null;
          }
        }

        return { text, urls: foundUrls, toolExecutions };
      } catch (geminiErr) {
        console.warn('Gemini queryWithSearch error:', geminiErr);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * Generates a structured Markdown audit report with live Firecrawl scraping and Tavily SERP search
   */
  async generateAuditReport(
    websiteUrl: string,
    focus: ReportFocus = 'SEO',
    dna?: BusinessDNA | null,
    lenses: AuditLens[] = []
  ): Promise<AuditReportResult> {
    const dnaContext = this.getDNAContext(dna);
    const allLenses = [...new Set([...lenses, ...inferLenses(dna)])];
    const methodology = playbookContext(selectAuditPlaybooks(focus, allLenses), 26000);
    const displayUrl = websiteUrl.replace(/^https?:\/\//i, '');
    let mainTopic = '';
    let reportTitle = '';
    let focusIntro = '';
    let competitiveMetrics = '';

    switch (focus) {
      case 'AEO':
        mainTopic = 'Answer Engine Optimization (AEO)';
        reportTitle = `AEO Performance Brief - ${displayUrl}`;
        focusIntro = `Specialized analysis of the brand's visibility in AI Overviews, rich snippets, and conversational assistants (ChatGPT, Gemini, Perplexity).`;
        competitiveMetrics = `'Featured Snippet Presence', 'Schema Markup Usage', 'LLM Citation Probability'`;
        break;
      case 'GEO':
        mainTopic = 'Generative Engine Optimization (GEO)';
        reportTitle = `GEO Performance Brief - ${displayUrl}`;
        focusIntro = `Specialized analysis of the brand's content suitability for generative engine citations and LLM synthesis.`;
        competitiveMetrics = `'Content Uniqueness Score', 'Entity Authority', 'Suitability for AI Summaries'`;
        break;
      case 'SEO':
      default:
        mainTopic = 'Search Engine Optimization (SEO)';
        reportTitle = `SEO Performance Brief - ${displayUrl}`;
        focusIntro = `Specialized audit of organic rankings, technical Core Web Vitals, and competitive search footprint.`;
        competitiveMetrics = `'Estimated Organic Traffic', 'Domain Authority', 'Total Backlinks'`;
        break;
    }

    // 1. Live site scraping via Unified Scraper (Patchright Stealth -> Firecrawl -> Jina Fallback)
    let scrapedContent = '';
    let scrapedText = '';
    try {
      const scrapeRes = await unifiedScraperService.scrapeAndDistill(websiteUrl, { maxChars: 8000 });
      if (scrapeRes.success && scrapeRes.formattedEvidence) {
        scrapedContent = `\n${scrapeRes.formattedEvidence}\n`;
        scrapedText = scrapeRes.distilled?.distilledText || '';
      }
    } catch (e) {
      console.warn('[Audit] Site scrape skipped', e);
    }

    // 1b. Writing check (page copy) + Results tracking (measured traffic) — best-effort, in parallel.
    let writingQuality: WritingQualityReport | undefined;
    let trafficImpact: TrafficImpact | undefined;
    let writingText = '';
    let trafficText = '';
    const hasEnoughCopy = (scrapedText.match(/[A-Za-z0-9À-ÿ'’-]+/g) || []).length >= 40;
    const [writingSettled, trafficSettled] = await Promise.allSettled([
      hasEnoughCopy ? writingQualityService.checkText(scrapedText) : Promise.resolve(undefined),
      trafficInsightsService.getImpact(displayUrl),
    ]);
    if (writingSettled.status === 'fulfilled') {
      writingQuality = writingSettled.value;
      if (writingQuality) writingText = `\n${writingQualityService.summaryForLlm(writingQuality)}\n`;
    } else {
      console.warn('[Audit] Writing check skipped', writingSettled.reason);
    }
    if (trafficSettled.status === 'fulfilled') {
      trafficImpact = trafficSettled.value;
      if (trafficImpact.status === 'ready') trafficText = `\n${trafficInsightsService.summaryForLlm(trafficImpact)}\n`;
    } else {
      console.warn('[Audit] Results tracking skipped', trafficSettled.reason);
    }

    // 2. Real SERP search via Tavily / Local SERP Sidecar
    let searchGrounding = '';
    const sources: Array<{ uri: string; title: string }> = [{ uri: websiteUrl, title: `${displayUrl} (Target Domain)` }];
    if (configService.getTavilyKey() || configService.isLocalSerpEnabled()) {
      try {
        const brand = dna?.name || displayUrl.split('.')[0];
        const evidence = await gatherSearchEvidence(`${brand} ${displayUrl} reviews competitors alternatives ${focus === 'SEO' ? 'ranking' : 'AI Overviews citation'}`, dna, 8);
        if (evidence.contextText) {
          searchGrounding = `\n${evidence.contextText}\n`;
          sources.push(...evidence.sources);
        }
      } catch (e) {
        console.warn('[Audit] SERP search skipped', e);
      }
    }

    // 3. Empirical Multi-LLM & Live SERP Citation Verification
    let empiricalSummary: EmpiricalCitationSummary | undefined;
    let empiricalText = '';
    try {
      empiricalSummary = await empiricalCitationService.probeDomainCitations(
        websiteUrl,
        dna?.name,
        dna?.competitors || []
      );
      if (empiricalSummary.evidenceList.length > 0) {
        empiricalText = `\n[VERIFIED EMPIRICAL CITATION AUDIT DATA]\nTarget Domain: ${empiricalSummary.targetDomain}\nEmpirical Citation Rate: ${empiricalSummary.citationRatePercent}%\nTop Cited Competitor: ${empiricalSummary.topCitedCompetitor || 'None identified'}\nEvidence Summary:\n` +
          empiricalSummary.evidenceList.map(e => `- Query "${e.query}" (${e.intent}): ${e.brandCited ? `CITING [Rank #${e.brandRank}]` : `NOT CITED (Competitors: ${e.competitorsCited.join(', ') || 'None'})`} -> Snippet: ${e.snippet}`).join('\n') + '\n';
      }
    } catch (e) {
      console.warn('[Audit] Empirical citation probe fallback', e);
    }

    // 4. Open Public APIs Enrichment (Wikidata, Internet Archive Wayback, Microlink, Security)
    let enrichedEntity: EnrichedEntityIntelligence | undefined;
    let enrichmentText = '';
    try {
      enrichedEntity = await publicApisEnrichmentService.enrichAudit(websiteUrl, dna?.name);
      const parts: string[] = ['\n[VERIFIED PUBLIC APIS & ENTITY INTELLIGENCE]'];
      if (enrichedEntity.wikidata) {
        parts.push(`Canonical Wikidata Entity: ${enrichedEntity.wikidata.id} (${enrichedEntity.wikidata.label}) - ${enrichedEntity.wikidata.description || 'Verified'}`);
        parts.push(`Wikipedia URI: ${enrichedEntity.wikidata.wikipediaUrl}`);
      }
      if (enrichedEntity.wayback.hasArchive) {
        parts.push(`Internet Archive Domain Longevity: Indexed since ${enrichedEntity.wayback.earliestDate} (${enrichedEntity.wayback.archivedYearsAgo} years archived)`);
      }
      const sec = enrichedEntity.security;
      parts.push(
        `Security Posture: HTTPS ${sec.httpsEnforced ? 'Enforced' : 'Missing'}, HSTS: ${sec.hstsEnabled ? 'Active' : 'Missing'}, CSP: ${sec.cspDetected ? 'Present' : 'Missing'}, security.txt: ${sec.securityTxtPresent ? 'Present' : 'Missing'}, TrustScore: ${sec.trustScore}/100, Measurement: ${sec.measurementConfidence}`
      );
      if (enrichedEntity.sameAsUrls.length > 0) {
        parts.push(`Authoritative sameAs Graph URIs: ${enrichedEntity.sameAsUrls.join(', ')}`);
      }
      enrichmentText = parts.join('\n') + '\n';
    } catch (e) {
      console.warn('[Audit] Public APIs enrichment fallback', e);
    }

    // 5. Citation integrity (deterministic; runs before LLM)
    let citationIntegrity: CitationIntegrityResult | undefined;
    let integrityText = '';
    try {
      if (empiricalSummary) {
        citationIntegrity = await citationIntegrityService.evaluate(empiricalSummary, {
          brandName: dna?.name || enrichedEntity?.brandName,
          domain: enrichedEntity?.domain || displayUrl,
          sameAsUrls: enrichedEntity?.sameAsUrls,
        });
        integrityText =
          `\n[AEO CITATION INTEGRITY]\nIntegrityScore: ${citationIntegrity.integrityScore}/100\n` +
          `DeadCitations: ${citationIntegrity.deadCitationCount}\nSpoofRisk: ${citationIntegrity.spoofRisk}\n` +
          `sameAsConflict: ${citationIntegrity.sameAsConflict}\n`;
      }
    } catch (e) {
      console.warn('[Audit] Citation integrity fallback', e);
    }

    // Preliminary trust pack (schema not measured yet; use 50 default in prompt cite-worthiness)
    let preliminaryTrustText = '';
    try {
      const prelim = aeoTrustPackService.build({
        security: enrichedEntity?.security,
        empirical: empiricalSummary,
        integrity: citationIntegrity,
        reportText: `${scrapedContent} ${dna?.industry || ''} ${dna?.name || ''}`,
        brandName: dna?.name,
        domain: displayUrl,
      });
      const schemaSafetyDefault = 50;
      const citePrelim = Math.round(
        0.3 * prelim.securityTrust +
          0.3 * prelim.citationIntegrity +
          0.2 * prelim.entityClarity +
          0.2 * schemaSafetyDefault
      );
      preliminaryTrustText =
        `\n[AEO TRUST PACK]\nciteWorthiness: ${citePrelim}/100 (preliminary; schemaSafety=${schemaSafetyDefault} not_measured)\n` +
        `ymylTier: ${prelim.ymylTier}\n` +
        `securityTrust: ${prelim.securityTrust}, citationIntegrity: ${prelim.citationIntegrity}, entityClarity: ${prelim.entityClarity}\n` +
        `Formula: ${prelim.formula}\nFindings:\n` +
        prelim.findings.slice(0, 5).map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`).join('\n') +
        '\n';
    } catch (e) {
      console.warn('[Audit] Preliminary trust pack fallback', e);
    }

    const prompt = `
${dnaContext}
${methodology}
${wrapUntrustedContent('SCRAPED_PAGE', scrapedContent)}
${wrapUntrustedContent('SEARCH_GROUNDING', searchGrounding)}
${wrapUntrustedContent('EMPIRICAL', empiricalText)}
${wrapUntrustedContent('ENRICHMENT', enrichmentText)}
${wrapUntrustedContent('CITATION_INTEGRITY', integrityText)}
${preliminaryTrustText}
${writingText}
${trafficText}
You are Oracle Agent, the search and AI-visibility analyst for Luminara Suite.
Generate an evidence-based audit in Markdown for: "${websiteUrl}".
Focus: ${mainTopic}.
${focusIntro}
Follow the methodology playbooks above: use their criteria and thresholds, respect every deprecation rule
(never recommend HowTo schema; FAQPage earns no Google rich result; use INP, never FID), and grade only what
the scraped page and search evidence support. Anything you could not observe is "not measured".
When Trust Pack findings are present, reflect Critical/High items in ## Key Findings and ## Recommendations.

Strict Formatting Guidelines:
1. Title: Must begin with: "# ${reportTitle}"
2. Introduction: An executive introductory paragraph immediately following the title.
3. Structure: Organize using these exact H2 headers:
   ## Executive Summary
   ## Key Findings
   ## AI & Search Visibility Radar
   ## Competitor Reality Map
   ## Recommendations
   ## ROI & Measurement Strategy
   ## Competitive Snapshot
   ## Next Steps
4. AI & Search Visibility Radar: Create a Markdown table with strictly these columns:
   | Query | Intent | Brand Cited (Yes/No) | Key Competitors | Est. Organic Rank | Rich Results | AI Overview Status | Visibility Score (0-100) |
   Include 3 high-intent queries (informational, commercial, comparative).
5. Competitor Reality Map: Create a Markdown table with strictly these columns:
   | Entity | AI Perception (Tone/Claims) | Top Cited Page Types | Content Advantage (vs You) | Trust Signal Strength (Low/Med/High) |
   Include the target brand and 3-4 actual competitors found via search.
6. Recommendations Table: Create a Markdown table with columns:
   | Action | Benefit | Priority | How we'd know it failed | Leading indicator |
   "How we'd know it failed" is a concrete check the owner can run; "Leading indicator" is a metric visible
   before rankings move (e.g. indexed pages, AI citations for 5 tracked questions, review velocity).
7. Competitive Snapshot Table: Include target brand and competitors comparing: ${competitiveMetrics}.
8. Code Block: Under "## Key Findings", include a practical JSON-LD or schema code block example.
9. Tone: direct, evidence-first, no hype. Label every estimate "(estimate)".
10. If measured traffic / AI-referral data is present above, cite it in "## ROI & Measurement Strategy" and
   "## Key Findings" as measured (not estimate). If writing-quality data is present, include at most two
   concrete wording fixes under "## Recommendations".
`;

    const buildReportResult = (text: string): AuditReportResult => {
      const schemaMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?"@type"[\s\S]*?\})\s*```/);
      let schemaJsonLd = schemaMatch ? schemaMatch[1].trim() : JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": dna?.name || displayUrl,
        "url": websiteUrl
      }, null, 2);

      // Augment schema with verified sameAs URIs (Wikidata / Wikipedia)
      if (enrichedEntity?.sameAsUrls && enrichedEntity.sameAsUrls.length > 0) {
        try {
          const parsed = JSON.parse(schemaJsonLd);
          if (!parsed.sameAs) {
            parsed.sameAs = enrichedEntity.sameAsUrls;
            schemaJsonLd = JSON.stringify(parsed, null, 2);
          }
        } catch {
          // keep original
        }
      }

      const schemaGate = schemaSafetyGate.validate(schemaJsonLd);
      const trustPack = aeoTrustPackService.build({
        security: enrichedEntity?.security,
        empirical: empiricalSummary,
        integrity: citationIntegrity,
        schemaSafety: schemaGate,
        reportText: text,
        brandName: dna?.name,
        domain: displayUrl,
      });

      const shareOfVoice = empiricalSummary
        ? shareOfVoiceService.build(empiricalSummary)
        : undefined;

      const sourceGraph = sourceCitationGraphService.build({
        domain: displayUrl,
        sources,
        empirical: empiricalSummary,
      });

      const enterpriseTrust = enterpriseTrustPackService.build({
        domain: displayUrl,
        trustPack,
        empirical: empiricalSummary,
        enriched: enrichedEntity,
        traffic: trafficImpact,
        sourceGraph,
        requireTgAuth: true,
      });

      try {
        visibilityHistoryService.record({
          domain: displayUrl,
          focus: String(focus),
          citationRatePercent: empiricalSummary?.citationRatePercent ?? 0,
          shareOfVoice,
          citeWorthiness: trustPack.citeWorthiness,
          topCompetitor: empiricalSummary?.topCitedCompetitor ?? null,
        });
      } catch (histErr) {
        console.warn('[VisibilityHistory] record error', histErr);
      }

      const remediationPayload: RemediationPayload = {
        domain: displayUrl,
        pageUrl: websiteUrl,
        title: reportTitle,
        schemaJsonLd,
      };

      const unifiedDiff = cmsDeploymentService.generateUnifiedDiff(
        '// [Existing target page lacks structured Schema.org entity disambiguation]',
        schemaJsonLd,
        'schema.jsonld'
      );

      try {
        aeoCorpusService.ingestAudit(
          displayUrl,
          text,
          empiricalSummary?.citationRatePercent ?? 65,
          schemaJsonLd,
          {
            ymylTier: trustPack.ymylTier,
            securityTrust: trustPack.securityTrust,
            integrityScore: trustPack.citationIntegrity,
            schemaSafety: trustPack.schemaSafety,
            citeWorthiness: trustPack.citeWorthiness,
            measurementConfidence: enrichedEntity?.security.measurementConfidence,
          }
        );
      } catch (corpusErr) {
        console.warn('[Corpus] Ingest error', corpusErr);
      }

      return {
        text,
        sources,
        empiricalSummary,
        remediationPayload,
        unifiedDiff,
        enrichedEntity,
        writingQuality,
        trafficImpact,
        citationIntegrity,
        integrity: citationIntegrity,
        trustPack,
        shareOfVoice,
        sourceGraph,
        enterpriseTrust,
      };
    };

    // 1. Primary Native LLM Focus: Groq LPU / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          systemPrompt: SYSTEM_INSTRUCTIONS,
          temperature: 0.3,
        });
        const text = result.text;
        try {
          vfsMemoryService.ingestAuditAsResource(text, websiteUrl);
        } catch (e) {
          console.warn('VFS audit ingestion fallback', e);
        }
        return buildReportResult(text);
      }
    } catch (e) {
      console.warn('Native Trinity generateAuditReport failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const response = await ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }]
          }
        });

        const text = response.text || "No report generated.";
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (groundingChunks) {
          groundingChunks.forEach((chunk: any) => {
            if (chunk.web) {
              sources.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri });
            }
          });
        }

        try {
          vfsMemoryService.ingestAuditAsResource(text, websiteUrl);
        } catch (e) {
          console.warn('VFS audit ingestion fallback', e);
        }

        return buildReportResult(text);
      } catch (error) {
        console.warn("Audit Generation Gemini error:", error);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * Scans a business URL or brand name and extracts Strategic Business DNA
   * With Firecrawl scraping and Multi-LLM JSON extraction
   */
  async extractBusinessDNA(input: string): Promise<BusinessDNA> {
    let scrapedInfo = '';
    if (input.includes('.')) {
      try {
        const targetUrl = input.includes('://') ? input : `https://${input}`;
        const scrapeRes = await unifiedScraperService.scrapeAndDistill(targetUrl, { maxChars: 6000 });
        if (scrapeRes.success && scrapeRes.formattedEvidence) {
          scrapedInfo = `\n${scrapeRes.formattedEvidence}\n`;
        }
      } catch (e) {
        console.warn('[DNA] Scrape skipped', e);
      }
    }

    const prompt = `Perform a deep strategic scan of the following business/URL: "${input}".
${scrapedInfo}
Extract the brand's 'Strategic DNA'. Return strictly a valid JSON object matching this exact schema:
{
  "name": "Brand Name",
  "mission": "Core Mission statement",
  "usp": "Unique Selling Proposition",
  "targetAudience": "Primary Target Audience",
  "competitors": ["Competitor1", "Competitor2", "Competitor3"],
  "perceivedGaps": ["Gap 1", "Gap 2", "Gap 3"],
  "rawContext": "A condensed 2-3 paragraph summary of the entire strategic profile."
}`;

    // 1. Primary Native LLM Focus: Groq / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          jsonMode: true,
          temperature: 0.2,
          systemPrompt: 'You are an expert Strategic Business DNA extractor. Always output valid JSON matching the requested schema.'
        });

        const parsed = safeJsonParse<any>(result.text, {});
        return {
          name: parsed.name || input,
          mission: parsed.mission || 'Strategic market leadership.',
          usp: parsed.usp || 'High-performance proprietary technology.',
          targetAudience: parsed.targetAudience || 'Enterprise and growth organizations.',
          competitors: Array.isArray(parsed.competitors) && parsed.competitors.length ? parsed.competitors : ['Competitor A', 'Competitor B'],
          perceivedGaps: Array.isArray(parsed.perceivedGaps) && parsed.perceivedGaps.length ? parsed.perceivedGaps : ['Brand awareness', 'AEO citation coverage'],
          rawContext: parsed.rawContext || result.text
        };
      }
    } catch (e) {
      console.warn('Native Trinity extractBusinessDNA failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const schema = {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            mission: { type: Type.STRING },
            usp: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            competitors: { type: Type.ARRAY, items: { type: Type.STRING } },
            perceivedGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
            rawContext: { type: Type.STRING, description: "A condensed summary of the strategic profile." }
          },
          required: ["name", "mission", "usp", "targetAudience", "competitors", "perceivedGaps", "rawContext"]
        };

        const response = await ai.models.generateContent({
          model: "gemini-3-pro-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: schema
          }
        });

        return JSON.parse(response.text || "{}") as BusinessDNA;
      } catch (e) {
        console.warn('Gemini extractBusinessDNA error:', e);
      }
    }

    throw new ProviderUnavailableError('Could not extract Business DNA: no language model responded. Add an API key in Settings.');
  }

  /**
   * Red Team Stress Test Protocol
   */
  async stressTest(description: string, dna?: BusinessDNA | null): Promise<string> {
    const dnaContext = this.getDNAContext(dna);
    const prompt = `${dnaContext}
Perform an adversarial 'Red Team' stress test on this business strategy/idea.
Ensure the analysis accounts for the company's existing USP and competitive gaps.

PROPOSED STRATEGY:
${description}

Format your response in two rigorous sections:
1. CRITICAL FLAWS & STRATEGIC VULNERABILITIES (Aggressive and objective)
2. COUNTERMEASURES & TACTICAL MITIGATIONS (High-impact recommendations)`;

    // 1. Primary Native LLM Focus: Groq / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          systemPrompt: SYSTEM_INSTRUCTIONS,
          temperature: 0.6,
        });
        return result.text || "No analysis generated.";
      }
    } catch (e) {
      console.warn('Native Trinity stressTest failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const response = await ai.models.generateContent({
          model: "gemini-3-pro-preview",
          contents: prompt,
          config: {
            thinkingConfig: { thinkingBudget: 32768 }
          }
        });
        return response.text || "No analysis generated.";
      } catch (e) {
        console.warn('Gemini stressTest error:', e);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * Context-Aware Business Data Analyst
   */
  async analyzeData(context: string, query: string, dna?: BusinessDNA | null): Promise<string> {
    const dnaContext = this.getDNAContext(dna);
    const prompt = `${dnaContext}
You are an executive Business Data Analyst for Luminara Search. Analyze the following data AND the Strategic DNA context to answer the user directive.

DATASET / CONTEXT:
${context}

USER QUERY:
${query}`;

    // 1. Primary Native LLM Focus: Groq / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          systemPrompt: SYSTEM_INSTRUCTIONS,
          temperature: 0.3,
        });
        return result.text || "No analysis generated.";
      }
    } catch (e) {
      console.warn('Native Trinity analyzeData failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const response = await ai.models.generateContent({
          model: "gemini-3-pro-preview",
          contents: prompt,
          config: {
            tools: [{ codeExecution: {} }]
          }
        });
        return response.text || "No analysis generated.";
      } catch (e) {
        console.warn('Gemini analyzeData error:', e);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * Strategic Thought Organizer
   */
  async organizeThoughts(thoughts: string, format: OrganizerFormat, dna?: BusinessDNA | null): Promise<OrganizerSchema> {
    const dnaContext = this.getDNAContext(dna);
    const formatPrompt = format === OrganizerFormat.BUSINESS_PLAN
      ? "Comprehensive Business Plan"
      : format === OrganizerFormat.MARKETING_BRIEF
      ? "Executive Marketing Brief"
      : "Project Timeline & Execution Roadmap";

    const prompt = `${dnaContext}
Transform these unstructured thoughts into a structured ${formatPrompt} specifically tailored for the brand profile.
Return strictly a valid JSON object matching:
{
  "sections": [
    { "title": "Section Title", "content": "Detailed markdown formatted content" }
  ]
}

THOUGHTS:
${thoughts}`;

    // 1. Primary Native LLM Focus: Groq / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          jsonMode: true,
          temperature: 0.3,
          systemPrompt: 'You are an executive strategic thought organizer. Output valid JSON with sections.'
        });
        const parsed = safeJsonParse<OrganizerSchema>(result.text, { sections: [] });
        return parsed && Array.isArray(parsed.sections) ? parsed : { sections: [] };
      }
    } catch (e) {
      console.warn('Native Trinity organizeThoughts failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const schema = {
          type: Type.OBJECT,
          properties: {
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING }
                },
                required: ["title", "content"]
              }
            }
          },
          required: ["sections"]
        };

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema
          }
        });

        return JSON.parse(response.text || '{"sections": []}') as OrganizerSchema;
      } catch (e) {
        console.warn('Gemini organizeThoughts error:', e);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * Market Research with Google Search & Tavily Grounding
   */
  async marketResearch(query: string, mode: 'web' | 'local', dna?: BusinessDNA | null, location?: { lat: number; lng: number }): Promise<{
    text: string;
    chunks: any[];
  }> {
    const dnaContext = this.getDNAContext(dna);

    let tavilyEvidence = '';
    let tavilyChunks: any[] = [];
    if (configService.getTavilyKey() || configService.isLocalSerpEnabled()) {
      try {
        const evidence = await gatherSearchEvidence(query, dna, 8);
        tavilyChunks = evidence.sources.map(src => ({ web: { uri: src.uri, title: src.title } }));
        tavilyEvidence = evidence.contextText ? `\n${evidence.contextText}\n` : '';
      } catch (e) {
        console.warn('Search research fallback', e);
      }
    }

    const prompt = `${dnaContext}\n${tavilyEvidence}\nPerform market research for the following query: ${query}`;

    // 1. Primary Native LLM Focus: Groq / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          systemPrompt: SYSTEM_INSTRUCTIONS,
          temperature: 0.5,
        });

        return {
          text: result.text,
          chunks: tavilyChunks,
        };
      }
    } catch (e) {
      console.warn('Native Trinity marketResearch failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const config: any = {};
        let model = 'gemini-3-flash-preview';

        if (mode === 'web') {
          config.tools = [{ googleSearch: {} }];
        } else {
          model = 'gemini-2.5-flash';
          config.tools = [{ googleMaps: {} }];
          if (location) {
            config.toolConfig = {
              retrievalConfig: {
                latLng: {
                  latitude: location.lat,
                  longitude: location.lng
                }
              }
            };
          }
        }

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config
        });

        return {
          text: response.text || "",
          chunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || tavilyChunks
        };
      } catch (e) {
        console.warn('Gemini marketResearch error:', e);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * Neural Foundation Briefing for TimesFM Forecast
   */
  async generateTimesFMExecutiveBriefing(
    seriesName: string,
    history: any[],
    forecast: any[],
    anomalies: any[],
    metrics: any,
    covariates: any[],
    dna?: BusinessDNA | null
  ): Promise<string> {
    const dnaContext = this.getDNAContext(dna);

    const firstPoint = history[0] || { dateStr: 'Start', value: 0 };
    const lastPoint = history[history.length - 1] || { dateStr: 'End', value: 0 };
    const finalForecast = forecast[forecast.length - 1] || { dateStr: 'Projection', p50: 0, p10: 0, p90: 0 };
    const activeCovariates = (covariates || []).filter((c: any) => c.active).map((c: any) => `${c.name} (${c.type}: ${c.value})`).join(', ');

    const prompt = `
${dnaContext}
You are the Lead Neural AI/ML & Quantitative Econometrician for Luminara Search.
You are interpreting a Time-Series Foundation Model (TimesFM) zero-shot patch forecast.

TIME SERIES METRICS:
- Series Name: ${seriesName}
- Historical Horizon: ${history.length} steps (${firstPoint.dateStr} to ${lastPoint.dateStr})
- Latest Baseline Value: ${lastPoint.value}
- Forecast Horizon: ${forecast.length} steps ahead (to ${finalForecast.dateStr})
- Median Projection (p50): ${finalForecast.p50}
- Pessimistic Lower Bound (p10): ${finalForecast.p10}
- Optimistic Upper Bound (p90): ${finalForecast.p90}
- Historical Fit MAPE: ${metrics?.mape || 'N/A'}%
- Directional Accuracy: ${metrics?.directionalAccuracy || 'N/A'}%
- Detected Historical Anomalies: ${anomalies?.length || 0}
- Active Exogenous Covariates: ${activeCovariates || 'None'}

Provide an executive strategic briefing for founders and C-suite leadership formatted in Markdown:
1. **Executive Trajectory & Foundation Outlook**: Clear, numbers-grounded assessment of growth or contraction.
2. **Quantile Risk & Upside Analysis**: Address the uncertainty spread between p10 and p90 and key macro/search drivers.
3. **Anomaly & Structural Vulnerability Audit**: Highlight any detected historical changepoints and how to protect against future SERP shocks.
4. **Autonomous Capital & Search Recommendations**: High-impact recommendations tied to the company's USP and eliminating redundant agency retainer waste.
`.trim();

    // 1. Primary Native LLM Focus: Groq / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          systemPrompt: 'You are the Lead Neural AI/ML & Quantitative Econometrician for Luminara Search.',
          temperature: 0.4,
        });
        return result.text || "TimesFM neural briefing generated.";
      }
    } catch (e) {
      console.warn('Native Trinity TimesFM briefing failed, falling back to secondary...', e);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt,
        });
        return response.text || "TimesFM neural briefing generated.";
      } catch (e) {
        console.warn('Gemini generateTimesFMExecutiveBriefing error:', e);
      }
    }

    throw new ProviderUnavailableError();
  }

  /**
   * General text generation helper for agent harness
   */
  async generateText(prompt: string, model: string = 'openai/gpt-oss-120b'): Promise<string> {
    // 1. Primary Native LLM Focus: Groq / NVIDIA NIM / Ollama with auto-failover
    try {
      const best = await aiProviderService.getBestAvailableProvider();
      if (best) {
        const result = await aiProviderService.generateWithFailover(prompt, {
          temperature: 0.5,
          model: model.includes('gemini') ? undefined : model,
        });
        return result.text;
      }
    } catch (nativeErr: any) {
      console.warn("Native Trinity generateText failed, falling back to secondary...", nativeErr);
    }

    // 2. Secondary Gemini fallback
    const geminiKey = getApiKey();
    if (geminiKey) {
      try {
        const ai = this.getAI();
        const response = await ai.models.generateContent({
          model: model.includes('gemini') ? model : 'gemini-3-flash-preview',
          contents: prompt,
        });
        return response.text || "";
      } catch (err: any) {
        console.warn("Gemini generateText error:", err);
      }
    }

    throw new ProviderUnavailableError();
  }
}

export const geminiService = new GeminiService();
export const oracleLlmService = geminiService;
export { GeminiService as OracleLlmService };
