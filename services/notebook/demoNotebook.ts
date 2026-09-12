import { Notebook } from '../../types';

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
