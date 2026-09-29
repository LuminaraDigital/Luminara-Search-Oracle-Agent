/**
 * Luminara Compounding AEO Corpus & OracleMind Training Dataset Service
 * Turns every audit into training fuel for private, on-device AEO Small Language Models.
 */

export interface AeoPatternRecord {
  id: string;
  timestamp: number;
  domain: string;
  vertical: string;
  query: string;
  intent: 'informational' | 'commercial' | 'comparative';
  winningSchemaType: string;
  entityNodes: string[];
  citationRate: number;
  schemaSnippet: string;
  plainEnglishBrief: string;
  ymylTier?: string;
  securityTrust?: number;
  integrityScore?: number;
  schemaSafety?: number;
  citeWorthiness?: number;
  /** Default true; false when security measurement was CORS-limited only. */
  trainEligible?: boolean;
}

export interface AeoCorpusTrustInput {
  ymylTier?: string;
  securityTrust?: number;
  integrityScore?: number;
  schemaSafety?: number;
  citeWorthiness?: number;
  measurementConfidence?: 'full' | 'cors_limited' | 'failed';
}

export interface AlpacaTrainingSample {
  instruction: string;
  input: string;
  output: string;
}

export interface ShareGptTrainingSample {
  conversations: Array<{
    from: 'system' | 'human' | 'gpt';
    value: string;
  }>;
}

/** OpenAI-compatible tool-call message turn (standardize Hermes/xLAM/OpenManus-style data). */
export interface OpenAiToolMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenAiToolTrajectory {
  messages: OpenAiToolMessage[];
  meta: {
    domain: string;
    query: string;
    vertical: string;
    source: 'luminara_aeo_corpus';
  };
}

const CORPUS_STORAGE_KEY = 'luminara_aeo_corpus_records';

export class AeoCorpusService {
  private static instance: AeoCorpusService;

  private constructor() {}

  public static getInstance(): AeoCorpusService {
    if (!AeoCorpusService.instance) {
      AeoCorpusService.instance = new AeoCorpusService();
    }
    return AeoCorpusService.instance;
  }

  public getCorpusRecords(): AeoPatternRecord[] {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(CORPUS_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  public saveRecord(record: AeoPatternRecord): void {
    if (typeof window === 'undefined') return;
    try {
      const records = this.getCorpusRecords();
      // Deduplicate by domain + query
      const filtered = records.filter(r => !(r.domain === record.domain && r.query === record.query));
      localStorage.setItem(CORPUS_STORAGE_KEY, JSON.stringify([record, ...filtered.slice(0, 500)]));
    } catch (e) {
      console.warn('Failed to save AEO corpus record', e);
    }
  }

  /**
   * Ingests a completed audit report into the compounding corpus
   */
  public ingestAudit(
    domain: string,
    reportText: string,
    citationRate: number = 75,
    schemaJson?: string,
    trust?: AeoCorpusTrustInput
  ): AeoPatternRecord[] {
    const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0];
    const extractedRecords: AeoPatternRecord[] = [];

    // Detect industry/vertical heuristics
    let vertical = 'General Commercial';
    const textLower = reportText.toLowerCase();
    if (textLower.includes('dental') || textLower.includes('clinic') || textLower.includes('health')) vertical = 'Healthcare & Dental';
    else if (textLower.includes('software') || textLower.includes('saas') || textLower.includes('cloud')) vertical = 'SaaS & Technology';
    else if (textLower.includes('law') || textLower.includes('attorney') || textLower.includes('legal')) vertical = 'Legal & Advisory';
    else if (textLower.includes('store') || textLower.includes('shop') || textLower.includes('ecommerce')) vertical = 'E-Commerce & Retail';
    else if (textLower.includes('finance') || textLower.includes('mortgage') || textLower.includes('bank')) vertical = 'Financial Services';

    // Extract schema type from code block
    const schemaMatch = reportText.match(/```(?:json)?\s*(\{[\s\S]*?"@type"[\s\S]*?\})\s*```/);
    const resolvedSchema = schemaJson || (schemaMatch ? schemaMatch[1] : '{\n  "@type": "Organization"\n}');

    let schemaType = 'Organization';
    const typeMatch = resolvedSchema.match(/"@type"\s*:\s*"([^"]+)"/);
    if (typeMatch) schemaType = typeMatch[1];

    // Extract entity keywords
    const entityNodes = [cleanDomain.split('.')[0], vertical.split(' ')[0], schemaType];

    const trainEligible = trust?.measurementConfidence === 'cors_limited' ? false : true;

    // Seed 3 standard intent patterns for this vertical
    const intents: Array<{ intent: 'informational' | 'commercial' | 'comparative'; query: string }> = [
      { intent: 'informational', query: `how does ${cleanDomain} compare in ${vertical}` },
      { intent: 'commercial', query: `best ${vertical} providers for ${cleanDomain}` },
      { intent: 'comparative', query: `${cleanDomain} vs leading alternatives` },
    ];

    intents.forEach((item, idx) => {
      const record: AeoPatternRecord = {
        id: `corp-${Date.now()}-${idx}`,
        timestamp: Date.now(),
        domain: cleanDomain,
        vertical,
        query: item.query,
        intent: item.intent,
        winningSchemaType: schemaType,
        entityNodes,
        citationRate: Math.max(30, citationRate - idx * 10),
        schemaSnippet: resolvedSchema.slice(0, 800),
        plainEnglishBrief: `Optimized Schema.org @graph for ${cleanDomain} targeting ${vertical} search consensus.`,
        trainEligible,
      };

      if (trust?.ymylTier !== undefined) record.ymylTier = trust.ymylTier;
      if (trust?.securityTrust !== undefined) record.securityTrust = trust.securityTrust;
      if (trust?.integrityScore !== undefined) record.integrityScore = trust.integrityScore;
      if (trust?.schemaSafety !== undefined) record.schemaSafety = trust.schemaSafety;
      if (trust?.citeWorthiness !== undefined) record.citeWorthiness = trust.citeWorthiness;

      this.saveRecord(record);
      extractedRecords.push(record);
    });

    return extractedRecords;
  }

  private formatTrustBlock(r: AeoPatternRecord): string {
    const parts: string[] = [];
    if (r.citeWorthiness !== undefined) parts.push(`Cite-Worthiness: ${r.citeWorthiness}`);
    if (r.securityTrust !== undefined) parts.push(`Security Trust: ${r.securityTrust}`);
    if (r.integrityScore !== undefined) parts.push(`Integrity: ${r.integrityScore}`);
    if (r.schemaSafety !== undefined) parts.push(`Schema Safety: ${r.schemaSafety}`);
    if (r.ymylTier !== undefined) parts.push(`YMYL Tier: ${r.ymylTier}`);
    return parts.length ? parts.join('\n') : '';
  }

  private trainRecords(): AeoPatternRecord[] {
    return this.getCorpusRecords().filter((r) => r.trainEligible !== false);
  }

  /**
   * Generates a ready-to-train Alpaca-format dataset for fine-tuning OracleMind
   */
  public exportAlpacaDataset(): AlpacaTrainingSample[] {
    const records = this.trainRecords();
    return records.map(r => {
      const trust = this.formatTrustBlock(r);
      const input = [
        `Domain: ${r.domain}`,
        `Vertical: ${r.vertical}`,
        `Query Intent: ${r.intent}`,
        `Target Query: "${r.query}"`,
        trust ? `\nTrust Metrics:\n${trust}` : '',
      ].filter(Boolean).join('\n');

      return {
        instruction: `You are OracleMind, an expert AEO and Schema.org reasoning engine. Generate an authoritative Schema.org @graph and entity remediation for the target query.`,
        input,
        output: `To dominate generative citations for "${r.query}", deploy the following structured ${r.winningSchemaType} entity graph:\n\n\`\`\`json\n${r.schemaSnippet}\n\`\`\`\n\nStrategic Justification:\n${r.plainEnglishBrief}`,
      };
    });
  }

  /**
   * Generates a ShareGPT multi-turn dataset for LoRA fine-tuning
   */
  public exportShareGptDataset(): ShareGptTrainingSample[] {
    const records = this.trainRecords();
    return records.map(r => {
      const trust = this.formatTrustBlock(r);
      const gptValue = [
        `Here is the authoritative AEO entity schema to achieve consensus citation:`,
        ``,
        `\`\`\`json`,
        r.schemaSnippet,
        `\`\`\``,
        ``,
        `Entity Nodes: ${r.entityNodes.join(', ')}`,
        `Target Citation Rate: ${r.citationRate}%`,
        trust ? `\n${trust}` : '',
      ].filter((line) => line !== undefined).join('\n');

      return {
        conversations: [
          {
            from: 'system',
            value: 'You are OracleMind SLM, specialized in zero-latency private SERP reasoning, AEO schema construction, and competitive citation disambiguation.',
          },
          {
            from: 'human',
            value: `Analyze search visibility and generate the optimal AEO schema markup for domain "${r.domain}" in the ${r.vertical} sector for the query "${r.query}".`,
          },
          {
            from: 'gpt',
            value: gptValue,
          },
        ],
      };
    });
  }

  /**
   * OpenAI-style tool trajectories for external SFT (Hermes / xLAM / agent mixtures).
   * Encodes APS discipline: get_project_context before paid research; never invent metrics.
   */
  public exportOpenAiToolTrajectories(): OpenAiToolTrajectory[] {
    const records = this.trainRecords();
    return records.map((r, index) => {
      const callIdCtx = `call_ctx_${index}`;
      const callIdVis = `call_vis_${index}`;
      const trust = this.formatTrustBlock(r);
      const toolResult = {
        domain: r.domain,
        vertical: r.vertical,
        query: r.query,
        winning_schema_type: r.winningSchemaType,
        entity_nodes: r.entityNodes,
        citation_rate: r.citationRate,
        schema_snippet: r.schemaSnippet,
        trust: trust || null,
        status: 'measured',
      };
      const finalContent = [
        `Verdict: Prefer ${r.winningSchemaType} schema for "${r.query}" on ${r.domain}.`,
        `Action: Deploy the @graph below, then re-measure visibility within 30 days.`,
        '',
        '```json',
        r.schemaSnippet,
        '```',
        '',
        r.plainEnglishBrief,
        trust ? `\n${trust}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        meta: {
          domain: r.domain,
          query: r.query,
          vertical: r.vertical,
          source: 'luminara_aeo_corpus',
        },
        messages: [
          {
            role: 'system',
            content:
              'You are Luminara Oracle. Call get_project_context before paid research tools. Never invent SEO metrics; use not_measured when evidence is missing. Return verdict + one action + report link when chatting.',
          },
          {
            role: 'user',
            content: `Improve AI citation readiness for ${r.domain} (${r.vertical}) on query "${r.query}".`,
          },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: callIdCtx,
                type: 'function',
                function: {
                  name: 'get_project_context',
                  arguments: JSON.stringify({ domain: r.domain }),
                },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_project_context',
            tool_call_id: callIdCtx,
            content: JSON.stringify({
              domain: r.domain,
              vertical: r.vertical,
              research_log_within_30_days: false,
            }),
          },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: callIdVis,
                type: 'function',
                function: {
                  name: 'get_visibility_snapshot',
                  arguments: JSON.stringify({ domain: r.domain, query: r.query }),
                },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_visibility_snapshot',
            tool_call_id: callIdVis,
            content: JSON.stringify(toolResult),
          },
          {
            role: 'assistant',
            content: finalContent,
          },
        ],
      };
    });
  }

  public getCorpusStats(): { totalRecords: number; verticals: Record<string, number>; avgCitationRate: number } {
    const records = this.getCorpusRecords();
    const verticals: Record<string, number> = {};
    let totalRate = 0;

    records.forEach(r => {
      verticals[r.vertical] = (verticals[r.vertical] || 0) + 1;
      totalRate += r.citationRate;
    });

    return {
      totalRecords: records.length,
      verticals,
      avgCitationRate: records.length ? Math.round(totalRate / records.length) : 0,
    };
  }

  public exportShareGPTDataset(): ShareGptTrainingSample[] {
    return this.exportShareGptDataset();
  }

  public getStats(): { totalRecords: number; verticals: Record<string, number>; avgCitationRate: number } {
    return this.getCorpusStats();
  }
}

export const aeoCorpusService = AeoCorpusService.getInstance();
