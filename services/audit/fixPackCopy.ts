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

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
}

/**
 * Prepare-mode comparison page outline (/compare/<brand>-vs-<competitor>).
 * Pre-fills only facts from the audited domain and leaves competitor cells as explicit
 * verification placeholders so no rival claim or price is ever invented.
 */
export function comparisonOutlineDraft(
  host: string,
  siteNameOrEvidence?: string | FixPackEvidence | null,
  rivalName?: string | null,
): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const clean = cleanHost(host);
  const brand = brandNameFor(host, evidence.siteName) || '<Your business name>';
  const rival = oneLine(rivalName) || '<Competitor>';
  const description = oneLine(evidence.description) || '<One-sentence summary of what you do>';
  const slug = `/compare/${slugPart(brand)}-vs-${slugPart(rival)}`;
  const faqSchema = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: `What is the main difference between ${brand} and ${rival}?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: `${rival} focuses on <verify their primary focus from their public site>. ${brand} focuses on ${description}`,
          },
        },
        {
          '@type': 'Question',
          name: `How does pricing compare between ${brand} and ${rival}?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Check both providers for current pricing. <Where you publish pricing, or 'Contact us for a quote'>.",
          },
        },
      ],
    },
    null,
    2,
  ).replace(/</g, '\\u003c');

  return [
    `<!-- Suggested URL path: ${slug} -->`,
    `<!-- Prepare mode: replace every <...> placeholder with facts verified on each vendor's public site. -->`,
    `# ${brand} vs ${rival}`,
    '',
    '## Short answer',
    `Choose ${rival} if you need <verify their strongest use case from their public site>. Choose ${brand} if you want ${description}`,
    '',
    '## Side by side',
    `| Dimension | ${rival} | ${brand} |`,
    '| --- | --- | --- |',
    `| Built for | <Verify target audience on ${rival} site> | <Your ideal customer profile> |`,
    `| Core offer | <Verify core offer on ${rival} site> | ${description} |`,
    `| Pricing model | <Verify pricing model without guessing numbers> | <Your pricing model> |`,
    `| Official site | <https://...> | https://${clean} |`,
    '',
    `## When to choose ${rival}`,
    `- <Verified strength 1 from ${rival}'s public documentation or pricing page>`,
    `- <Verified strength 2>`,
    '',
    `## When to choose ${brand}`,
    '- <Your primary differentiator backed by live evidence on your site>',
    `- Direct details at https://${clean}`,
    '',
    '## Common questions',
    `### What is the main difference between ${brand} and ${rival}?`,
    `${rival} focuses on <verify their primary focus from their public site>. ${brand} focuses on ${description}`,
    '',
    `### How does pricing compare between ${brand} and ${rival}?`,
    "Check both providers for current pricing. <Where you publish pricing, or 'Contact us for a quote'>.",
    '',
    '## FAQPage JSON-LD',
    '<!-- Do not publish until every \\u003c...> placeholder below is replaced with verified facts -->',
    '```html',
    '<script type="application/ld+json">',
    faqSchema,
    '</script>',
    '```',
    '',
  ].join('\n');
}
