/**
 * Markdown twins of the public pages, for agents that prefer text/markdown.
 * There is no /features page, so there is no /features.md.
 */
import { CHECKOUT_TERM_LINE, listPriceSummary, freePlanLines, planBullets, pricingTiers, planTitle } from '../../components/paywall/planCopy';
import { PAID_PLAN_PRICES } from '../../components/paywall/planPrices';
import { LEGAL_ENTITY_LINE } from '../legal/consumerTerms';
import { PLAN_ENTITLEMENTS } from '../plans/planEntitlements';
import { MCP_PUBLIC_URL } from '../mcp/publicServer';
import { LIVE_ANSWER_CHECKS } from './engineCoverage';
import { MARKETING_FAQ } from './marketingFaqContent';
import { HOME_HERO, PRICING_HERO } from './marketingHeroCopy';
import {
  MCP_BODY,
  MCP_DOCS_PATH,
  MCP_HEADING,
  PRACTITIONER,
  PROOF_BODY,
  PROOF_HEADING,
  STACK_HEADING,
  STACK_INTRO,
  STACK_ROWS,
  TRUST_ITEMS,
} from './marketingPositioning';

export interface AgentMarkdownPage {
  path: '/index.md' | '/pricing.md' | '/mcp.md';
  /** HTML pages that should advertise this file. */
  htmlPaths: readonly string[];
  body: string;
}

function faqMarkdown(): string {
  return MARKETING_FAQ.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n');
}

const MARKETING_ORIGIN = 'https://www.luminarasuite.com';

function trustMarkdown(): string {
  return TRUST_ITEMS.map((item) => `- ${item.title}: ${item.body}`).join('\n');
}

const HOME_MARKDOWN = `# ${HOME_HERO.titleLead} ${HOME_HERO.titleEm}

${HOME_HERO.lede}

## ${PROOF_HEADING}

${PROOF_BODY}

${LIVE_ANSWER_CHECKS}

## ${STACK_HEADING}

${STACK_INTRO}

| Job | By hand | One Suite plan |
| --- | --- | --- |
${STACK_ROWS.map((row) => `| ${row.label} | ${row.them} | ${row.us} |`).join('\n')}

## ${PRACTITIONER.eyebrow}

### ${PRACTITIONER.name}

${PRACTITIONER.role}.

${PRACTITIONER.body}

## ${MCP_HEADING}

${MCP_BODY}

Setup: ${MARKETING_ORIGIN}${MCP_DOCS_PATH}

Endpoint: ${MCP_PUBLIC_URL}

## Common questions

${faqMarkdown()}

## Before you pay

${trustMarkdown()}

- Home: ${MARKETING_ORIGIN}/
- Pricing: ${MARKETING_ORIGIN}/pricing
- Methodology: ${MARKETING_ORIGIN}/methodology
- Privacy: ${MARKETING_ORIGIN}/privacy
`;

const PRICING_MARKDOWN = `# ${PRICING_HERO.titleLead} ${PRICING_HERO.titleEm}

${PRICING_HERO.lede}

${CHECKOUT_TERM_LINE} ${listPriceSummary()}

## Free

${freePlanLines().map((line) => `- ${line.text}`).join('\n')}

## Paid passes

${pricingTiers.map((tier) => {
  const price = PAID_PLAN_PRICES[tier.id];
  const lines = planBullets(tier.id).filter((line) => line.included).map((line) => `- ${line.text}`).join('\n');
  return `### ${planTitle(tier.id)}: ${price.audLabel} for 30 days, or ${price.starsLabel}\n\n${tier.blurb}\n\n${lines}`;
}).join('\n\n')}

Agency live answers: ${LIVE_ANSWER_CHECKS}

## Before you pay

${trustMarkdown()}

Operator: ${LEGAL_ENTITY_LINE}.

- Pricing page: ${MARKETING_ORIGIN}/pricing
- MCP docs: ${MARKETING_ORIGIN}${MCP_DOCS_PATH}
`;

const MCP_MARKDOWN = `# Luminara MCP

${MCP_BODY}

- Docs: ${MARKETING_ORIGIN}${MCP_DOCS_PATH}
- Endpoint: ${MCP_PUBLIC_URL}
- Free: ${PLAN_ENTITLEMENTS.free.mcpDailyCallLimit} calls a day
- Starter: ${PLAN_ENTITLEMENTS.starter.mcpDailyCallLimit} calls a day
- Growth and Agency: no daily MCP cap
- The daily count is per account. A new token does not reset it.
- Paid research needs Agency or your own DataForSEO login

Send one tools/call per request. A JSON-RPC batch with more than one tools/call is refused.

\`\`\`json
{
  "mcpServers": {
    "luminara": {
      "url": "${MCP_PUBLIC_URL}",
      "headers": {
        "Authorization": "Bearer lm_live_YOUR_KEY"
      }
    }
  }
}
\`\`\`
`;

export const AGENT_MARKDOWN_PAGES: readonly AgentMarkdownPage[] = [
  { path: '/index.md', htmlPaths: ['/'], body: HOME_MARKDOWN },
  { path: '/pricing.md', htmlPaths: ['/pricing'], body: PRICING_MARKDOWN },
  { path: '/mcp.md', htmlPaths: ['/docs/mcp.html'], body: MCP_MARKDOWN },
];

export function markdownForPath(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return AGENT_MARKDOWN_PAGES.find((page) => page.path === path)?.body ?? null;
}

export function markdownAlternatePath(htmlPath: string): string | null {
  return AGENT_MARKDOWN_PAGES.find((page) => page.htmlPaths.includes(htmlPath))?.path ?? null;
}
