import { brandNameFor } from './brandName';

function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'example.com';
}

export type FixPackEvidence = {
  siteName?: string | null;
  description?: string | null;
  contactUrl?: string | null;
  facts?: string[];
};

function asEvidence(value?: string | FixPackEvidence | null): FixPackEvidence {
  if (!value) return {};
  if (typeof value === 'string') return { siteName: value };
  return value;
}

function oneLine(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

/** llms.txt draft. Filled lines are copied from the page. Missing lines are left out. */
export function llmsTxtDraft(host: string, siteNameOrEvidence?: string | FixPackEvidence | null): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const brand = brandNameFor(host, evidence.siteName);
  const clean = cleanHost(host);
  const description = oneLine(evidence.description);
  const facts = (evidence.facts || []).map(oneLine).filter(Boolean);
  const lines = [
    brand ? `# ${brand}` : '# <Your agency name>',
    ...(description ? [`> ${description}`] : []),
    '',
    '## Pages',
    `- Official website: https://${clean}`,
  ];
  const contact = oneLine(evidence.contactUrl);
  if (contact) lines.push(`- Contact: ${contact}`);
  if (facts.length) {
    lines.push('', '## Facts', ...facts.map((fact) => `- ${fact}`));
  }
  return `${lines.join('\n')}\n`;
}

export const LLMS_NAME_NOTE = 'Replace <Your agency name> with the name you use.';

/** Organization JSON-LD. Name and description are included only when the page had them. */
export function organizationJsonLd(host: string, siteNameOrEvidence?: string | FixPackEvidence | null): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const brand = brandNameFor(host, evidence.siteName);
  const clean = cleanHost(host);
  const description = oneLine(evidence.description);
  const body: Record<string, string> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    url: `https://${clean}`,
  };
  if (brand) body.name = brand;
  if (description) body.description = description;
  return JSON.stringify(body, null, 2);
}
