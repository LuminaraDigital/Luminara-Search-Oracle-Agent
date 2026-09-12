import { AGENT_CONDUCT_RUNTIME } from './services/skills/agentConduct';

export const SYSTEM_INSTRUCTIONS = `
Role: You are Oracle Agent for Luminara Suite. You help founders see whether AI answers and Google mention their brand, then choose one fix worth shipping this week.

Emotional direction: Fog clearing at first light. Calm, clear, decisive. No theatre. No "neural core", holography, or fake document IDs.

Core rules:
1. Cite-or-silence: Ground every ranking, citation, or competitor claim in SERP / crawl evidence supplied in the prompt. If evidence is missing, write "not verified". Never invent ranks or scores.
2. Plain English is the default: Write at about an 8th-grade reading level. Short sentences. Explain schema, AI Overview, or citation in a few plain words the first time. Lead with what to do and why it matters to revenue.
3. One next move: Every audit must open with a single highest-priority ship action the founder can finish this week.
4. Economic sovereignty: Help founders win without a $10k/month agency retainer.
5. Business DNA: When Strategic Business DNA is provided, reinforce the USP and close gaps vs named competitors. When DNA is missing, label the run as a Quick Scout and keep recommendations general.

Protocols:
- Crawl and diagnose technical SEO, Core Web Vitals, and indexation as plain tasks with Impact Scores (1-100).
- AEO / AI visibility: ChatGPT, Gemini, Perplexity, AI Overviews. Propose answer-ready copy and JSON-LD when evidence supports it.
- ROI: Never invent percentages. Label estimates "(estimate)" and state the assumption.

Strict template (REQUIRED for audits):
# Luminara: Will AI mention [Business or Domain]?
**Date:** [Current Date] · **Mode:** [Full audit | Quick scout]

## 1. One move this week
[One concrete action. Why it helps you get cited. How to tell it worked.]

## 2. Plain verdict
[3 short sentences on what is working, what is missing, and the revenue risk.]

## 3. Fix list
| Task | Plain issue | Impact (1-100) | Priority |
|------|-------------|----------------|----------|
| [Task] | [Simple explanation] | [Score] | [High/Med/Low] |

## 4. Visibility radar
| Query | Intent | Brand cited | Competitors | Organic rank | AI Overview | Visibility (0-100) |
|-------|--------|-------------|-------------|--------------|-------------|--------------------|
| [Query] | [Intent] | [Yes/No/not verified] | [Names] | [Rank or not verified] | [Active/None/not verified] | [Score or not verified] |

## 5. Competitor map
| Brand | How AI talks about them | Pages that win citations | Trust signals |
|-------|-------------------------|--------------------------|---------------|
| [Yours] | ... | ... | Low/Med/High |
| [Rival] | ... | ... | Low/Med/High |

## 6. Budget notes (estimates only)
- Waste risk: [estimate + assumption]
- Lift if you ship the one move: [estimate + assumption]

## 7. Sources
[Only real URLs from grounding. If none, write: No live sources. Treat scores as not verified.]

---
*Luminara · fog clearing complete · ship the one move*

${AGENT_CONDUCT_RUNTIME}
`;

export const GLOSSARY: Record<string, string> = {
  'SEO': 'Search Engine Optimization: The practice of increasing organic traffic to your website through search engine rankings.',
  'AEO': 'Answer Engine Optimization: Optimizing content to be chosen as direct answers by AI engines (Gemini, ChatGPT, Perplexity, Siri).',
  'GEO': 'Generative Engine Optimization: Techniques designed to maximize visibility and citations inside generative AI summaries and LLM syntheses.',
  'CTR': 'Click-Through Rate: The ratio of users who click on a link compared to the total users who viewed the page or impression.',
  'SCHEMA': 'Schema Markup: Structured vocabulary (JSON-LD) placed on a website to help search and AI engines understand entity relationships.',
  'BACKLINKS': 'Inbound links from external domains that search engines treat as citations of authority and trust.',
  'DOMAIN AUTHORITY': 'A search ranking metric that models the relative ranking power of an entire website domain.',
  'FEATURED SNIPPET': 'Highlighted search result appearing in a dedicated box at position zero on Google SERPs.',
  'JSON-LD': 'JavaScript Object Notation for Linked Data: The gold standard format for encoding Schema.org structured data.',
  'ORGANIC TRAFFIC': 'Unpaid visitors originating directly from search engine queries rather than paid advertising.',
  'META TITLES': 'HTML title elements signaling core topic relevancy to search engines and displayed in SERP link headers.',
  'RICH RESULTS': 'Enhanced search results featuring stars, FAQs, recipes, pricing, or sitelinks generated from structured data.',
  'KNOWLEDGE PANEL': 'Information cards appearing in Google search summarizing verified facts about organizations, people, or entities.',
  'CANONICAL TAG': 'An HTML tag declaring the master authoritative URL for duplicate or syndicated content.',
  'ALT TEXT': 'Descriptive alternative text for images utilized by screen readers and image-indexing AI crawlers.',
  'CORE WEB VITALS': 'Google standardized metrics measuring real-world user experience: loading performance (LCP), interactivity (INP), and visual stability (CLS).',
  'SLM': 'Small Language Model: A compact (20M-3B parameter) transformer engineered for low-latency edge inferencing, privacy preservation, and domain-specialized reasoning.',
  'GQA': 'Grouped Query Attention: An optimized attention architecture where multiple query heads share key-value heads, drastically reducing KV-cache memory bandwidth.',
  'ROPE': 'Rotary Position Embedding: Relative position encoding using complex coordinate rotation, enabling extended context reasoning without learned position parameters.',
  'SWIGLU': 'Swish-Gated Linear Unit: A state-of-the-art non-linear activation function combining gated feed-forward projections with SiLU activation.',
  'MOE': 'Mixture of Experts: Sparse neural architecture dynamically routing token embeddings to specialized expert sub-networks with zero extra FLOP overhead.',
  'LORA': 'Low-Rank Adaptation: Parameter-efficient fine-tuning (PEFT) that freezes base weights and trains low-rank decomposition matrices for rapid domain customization.',
  'DPO': 'Direct Preference Optimization: An alignment algorithm directly optimizing policy weights on chosen vs. rejected outputs without needing a separate reward model.',
  'GRPO': 'Group Relative Policy Optimization: DeepSeek-R1 style reinforcement learning calculating relative advantages across group rollouts and verifiable domain rewards.',
  'DISTILLATION': 'Knowledge Distillation: Transferring reasoning capacity from an advanced teacher model (e.g., Gemini 3 Pro) into a lightweight student SLM via softened logits.'
};

export { ICONS } from './components/ui/icons';


export const TIMESFM_DEFAULT_COVARIATES = [
  {
    id: 'agency_reallocation',
    name: 'Retainer Reallocation Alpha',
    type: 'multiplier' as const,
    value: 1.25,
    active: false,
    description: 'Direct capital shift from monthly agency retainers into high-velocity programmatic content and entity authority (+25% compound lift).'
  },
  {
    id: 'google_core_shock',
    name: 'Google Core Update Turbulence',
    type: 'shock' as const,
    value: -0.18,
    active: false,
    description: 'Simulate search engine volatility (-18% temporary SERP re-ranking compression before quality recovery).'
  },
  {
    id: 'aeo_schema_saturation',
    name: 'AEO Entity Knowledge Graph Saturation',
    type: 'multiplier' as const,
    value: 1.38,
    active: true,
    description: 'Full JSON-LD structured schema deployment driving LLM quotation in Gemini, ChatGPT, and Perplexity (+38% citation expansion).'
  }
];

export const TIMESFM_BENCHMARKS = [
  {
    id: 'organic_search',
    name: 'Daily Organic Traffic (90 Days)',
    frequency: 'daily' as const,
    unit: 'Clicks / Day',
    description: 'Authentic 90-day search engine traffic exhibiting weekend seasonality dips, midweek peaks, and organic trend trajectory.',
    defaultHorizon: 30,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneDay = 86400000;
      let base = 4200;
      for (let i = 89; i >= 0; i--) {
        const time = now - i * oneDay;
        const d = new Date(time);
        const dayOfWeek = d.getDay(); // 0 is Sun, 6 is Sat
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const weekendFactor = isWeekend ? 0.72 : 1.08;
        
        // Slight monthly cycle
        const monthCycle = Math.sin((i / 30) * Math.PI * 2) * 280;
        
        // Google update shock around day 45
        let shock = 0;
        if (i >= 40 && i <= 50) {
          shock = -550;
        } else if (i < 40) {
          shock = 400 * (1 - i / 40); // recovery and lift
        }
        
        // Drift upwards
        const trend = (89 - i) * 14;
        const noise = (Math.sin(i * 3.7) + Math.cos(i * 1.9)) * 110;
        
        const value = Math.max(1200, Math.round(base + trend + monthCycle + shock + noise) * weekendFactor);
        data.push({
          timestamp: time,
          dateStr: d.toISOString().split('T')[0],
          value: Math.round(value)
        });
      }
      return data;
    }
  },
  {
    id: 'aeo_citations',
    name: 'AI Overview & AEO Citation Frequency (26 Weeks)',
    frequency: 'weekly' as const,
    unit: 'Weekly Citations',
    description: 'Weekly frequency of verified brand citations across Perplexity, Gemini AI Overviews, and ChatGPT Search.',
    defaultHorizon: 12,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneWeek = 86400000 * 7;
      let base = 180;
      for (let i = 25; i >= 0; i--) {
        const time = now - i * oneWeek;
        const d = new Date(time);
        const growth = Math.pow(1.045, 25 - i) * base;
        const cycle = Math.sin(i * 0.8) * 35;
        const noise = (Math.sin(i * 2.3) * 20);
        const value = Math.max(80, Math.round(growth + cycle + noise));
        data.push({
          timestamp: time,
          dateStr: d.toISOString().split('T')[0],
          value
        });
      }
      return data;
    }
  },
  {
    id: 'cac_trajectory',
    name: 'Blended Customer Acquisition Cost (18 Months)',
    frequency: 'monthly' as const,
    unit: 'CAC ($)',
    description: 'Monthly blended CAC tracking efficiency gains as organic sovereign AEO presence displaces paid search dependence.',
    defaultHorizon: 6,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneMonth = 86400000 * 30.4;
      let startCAC = 290;
      for (let i = 17; i >= 0; i--) {
        const time = now - i * oneMonth;
        const d = new Date(time);
        // Exponential decay towards asymptotic floor of $85
        const t = (17 - i) / 17;
        const decay = 290 - 180 * Math.pow(t, 0.7);
        const noise = (Math.cos(i * 1.5) * 12);
        const value = Math.max(70, Math.round(decay + noise));
        data.push({
          timestamp: time,
          dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          value
        });
      }
      return data;
    }
  },
  {
    id: 'mrr_sovereign',
    name: 'Sovereign Recurring Revenue Runway (18 Months)',
    frequency: 'monthly' as const,
    unit: 'MRR ($)',
    description: 'Monthly Recurring Revenue expansion modeling zero-retainer agency elimination and automated organic customer pipeline.',
    defaultHorizon: 12,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneMonth = 86400000 * 30.4;
      let mrr = 28000;
      for (let i = 17; i >= 0; i--) {
        const time = now - i * oneMonth;
        const d = new Date(time);
        const compound = 28000 * Math.pow(1.06, 17 - i);
        const noise = (Math.sin(i * 2.1) * 1200);
        const value = Math.round(compound + noise);
        data.push({
          timestamp: time,
          dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          value
        });
      }
      return data;
    }
  }
];

