/**
 * Citation Driver Service (Track KP-1).
 * Extracts causal drivers behind AI citations or omissions from empirical evidence snippets.
 * Patterns inspired by Kaito Sentiment & Mindshare Driver Analytics.
 */

export type CitationDriverType =
  | 'pricing_transparency'
  | 'schema_clarity'
  | 'documentation_freshness'
  | 'third_party_consensus'
  | 'security_compliance'
  | 'feature_parity'
  | 'unknown';

export interface CitationDriver {
  type: CitationDriverType;
  label: string;
  impact: 'positive' | 'negative' | 'neutral';
  evidenceSnippet: string;
  actionHint: string;
  recommendedActionId?: string;
}

export interface CitationDriverAnalysis {
  brandCited: boolean;
  domain: string;
  drivers: CitationDriver[];
  primaryDriver: CitationDriver;
}

interface KeywordRule {
  type: CitationDriverType;
  keywords: string[];
  positiveLabel: string;
  negativeLabel: string;
  positiveAction: string;
  negativeAction: string;
  actionId: string;
}

const RULES: KeywordRule[] = [
  {
    type: 'pricing_transparency',
    keywords: ['pricing', 'price', 'cost', 'tier', 'per month', 'free tier', 'plan', 'affordable'],
    positiveLabel: 'Transparent pricing & packaging cited',
    negativeLabel: 'Omitted due to unclear or missing public pricing',
    positiveAction: 'Keep pricing tables updated with clear comparison metrics.',
    negativeAction: 'Publish a public pricing table with clear tier comparisons.',
    actionId: 'publish-pricing-table',
  },
  {
    type: 'schema_clarity',
    keywords: ['schema', 'json-ld', 'structured data', 'entity', 'organization', 'metadata'],
    positiveLabel: 'Strong entity resolution and structured schema signals',
    negativeLabel: 'Lacks structured schema or clear entity disambiguation',
    positiveAction: 'Maintain clean Schema.org Organization markup.',
    negativeAction: 'Deploy verified Schema.org Organization JSON-LD markup.',
    actionId: 'deploy-schema',
  },
  {
    type: 'documentation_freshness',
    keywords: ['documentation', 'docs', 'guide', 'tutorial', 'api reference', 'freshness', 'changelog', 'sdk'],
    positiveLabel: 'Authoritative and recently updated technical documentation',
    negativeLabel: 'Outdated or thin technical documentation cited as a barrier',
    positiveAction: 'Regularly update API docs and changelog timestamps.',
    negativeAction: 'Refresh developer documentation and quickstart guides.',
    actionId: 'refresh-docs',
  },
  {
    type: 'third_party_consensus',
    keywords: ['review', 'reviews', 'reddit', 'consensus', 'g2', 'community', 'sentiment', 'reputation', 'forum'],
    positiveLabel: 'High positive community consensus and third-party reviews',
    negativeLabel: 'Sparse third-party validation or community presence compared to rivals',
    positiveAction: 'Amplify positive community case studies and testimonials.',
    negativeAction: 'Build verifiable presence on high-authority discussion hubs.',
    actionId: 'citation-gap',
  },
  {
    type: 'security_compliance',
    keywords: ['security', 'compliance', 'soc2', 'hipaa', 'gdpr', 'open source', 'privacy', 'local-first'],
    positiveLabel: 'Explicit trust, compliance, and privacy verification cited',
    negativeLabel: 'Unaddressed security, compliance, or data sovereignty questions',
    positiveAction: 'Highlight compliance badges and security audits.',
    negativeAction: 'Publish a dedicated trust and compliance overview.',
    actionId: 'deploy-trust-center',
  },
  {
    type: 'feature_parity',
    keywords: ['feature', 'features', 'integration', 'integrations', 'api', 'performance', 'latency', 'benchmark'],
    positiveLabel: 'Clear feature parity or superior benchmark performance cited',
    negativeLabel: 'Lacks specific integrations or benchmarks cited for rival options',
    positiveAction: 'Publish empirical benchmark results and integration catalogs.',
    negativeAction: 'Create side-by-side feature comparison matrix against rivals.',
    actionId: 'rewrite-answer',
  },
];

/**
 * Extracts citation drivers from text snippets and citation status.
 */
export function extractCitationDrivers(input: {
  domain: string;
  brandCited: boolean;
  snippet: string;
  competitorsCited?: string[];
}): CitationDriverAnalysis {
  const text = (input.snippet || '').toLowerCase();
  const drivers: CitationDriver[] = [];

  for (const rule of RULES) {
    const matchedKeyword = rule.keywords.find((kw) => text.includes(kw));
    if (matchedKeyword) {
      const idx = text.indexOf(matchedKeyword);
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + matchedKeyword.length + 60);
      const snippetContext = input.snippet.slice(start, end).trim();

      drivers.push({
        type: rule.type,
        label: input.brandCited ? rule.positiveLabel : rule.negativeLabel,
        impact: input.brandCited ? 'positive' : 'negative',
        evidenceSnippet: snippetContext || input.snippet.slice(0, 100),
        actionHint: input.brandCited ? rule.positiveAction : rule.negativeAction,
        recommendedActionId: rule.actionId,
      });
    }
  }

  if (drivers.length === 0) {
    const fallback: CitationDriver = {
      type: 'unknown',
      label: input.brandCited
        ? 'Cited as recognized domain authority'
        : 'Omitted in favor of established category incumbents',
      impact: input.brandCited ? 'positive' : 'neutral',
      evidenceSnippet: input.snippet.slice(0, 100) || 'No explicit driver statement logged',
      actionHint: input.brandCited
        ? 'Maintain domain authority and brand consistency.'
        : 'Add plain-English FAQ and schema to address direct search queries.',
      recommendedActionId: input.brandCited ? undefined : 'rewrite-answer',
    };
    return {
      brandCited: input.brandCited,
      domain: input.domain,
      drivers: [fallback],
      primaryDriver: fallback,
    };
  }

  return {
    brandCited: input.brandCited,
    domain: input.domain,
    drivers,
    primaryDriver: drivers[0],
  };
}
