import { brandNameFor } from './brandName';

function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'example.com';
}

/** llms.txt draft. Only the name and the site URL are filled in. */
export function llmsTxtDraft(host: string, siteName?: string | null): string {
  const brand = brandNameFor(host, siteName);
  const clean = cleanHost(host);
  return `# ${brand}
> ${brand}. [Describe what this business does. Fill this in.]

## Pages
- Official website: https://${clean}
- Contact: [Add the contact page. Fill this in.]

## Facts
- [Add a fact copied from the site. Fill this in.]
`;
}

/** Organization JSON-LD. Description is a placeholder the user must replace. */
export function organizationJsonLd(host: string, siteName?: string | null): string {
  const brand = brandNameFor(host, siteName);
  const clean = cleanHost(host);
  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: brand,
      url: `https://${clean}`,
      description: '[Describe this business. Fill this in.]',
    },
    null,
    2,
  );
}
