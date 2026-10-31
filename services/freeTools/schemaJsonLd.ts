/**
 * Free schema generator: RealEstateAgent or LocalBusiness plus an optional FAQPage, as JSON-LD.
 * Only fields the user typed are written. No ratings: self-written review stars are not shown
 * by Google for a business's own site, and we never fill in a value the user did not give.
 */
import { buildFaqPageJsonLd, type MarketingFaqItem } from '../marketing/marketingFaqContent';
import { toHttpUrl } from './httpUrl';

export type BusinessType = 'RealEstateAgent' | 'LocalBusiness';

export interface SchemaOptions {
  type: BusinessType;
  name: string;
  url: string;
  description: string;
  telephone: string;
  email: string;
  street: string;
  locality: string;
  region: string;
  postcode: string;
  country: string;
  /** Suburbs or cities served, one per entry. */
  areaServed: string[];
  /** Profile URLs such as Google Business Profile, LinkedIn, or a portal listing. */
  sameAs: string[];
  faq: MarketingFaqItem[];
}

/** Drop empty strings so the output holds only what the user typed. */
function compact(node: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).some((key) => key !== '@type');
      return true;
    }),
  );
}

export function buildSchemaGraph(options: SchemaOptions): Record<string, unknown> {
  const url = toHttpUrl(options.url);
  const base = url ? url.replace(/#.*$/, '') : '';
  const business = compact({
    '@type': options.type,
    '@id': `${base}#business`,
    name: options.name.trim(),
    url: url ?? undefined,
    description: options.description.trim(),
    telephone: options.telephone.trim(),
    email: options.email.trim(),
    address: compact({
      '@type': 'PostalAddress',
      streetAddress: options.street.trim(),
      addressLocality: options.locality.trim(),
      addressRegion: options.region.trim(),
      postalCode: options.postcode.trim(),
      addressCountry: options.country.trim(),
    }),
    areaServed: options.areaServed
      .map((place) => place.trim())
      .filter(Boolean)
      .map((place) => ({ '@type': 'Place', name: place })),
    sameAs: options.sameAs.map(toHttpUrl).filter((link): link is string => link !== null),
  });

  const faq = options.faq
    .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
    .filter((item) => item.question && item.answer);
  const graph: Record<string, unknown>[] = [business];
  if (faq.length) graph.push(buildFaqPageJsonLd(faq, `${base}#faq`));
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** A script tag ready to paste. `<` is escaped so text can never close the tag early. */
export function schemaScriptTag(graph: Record<string, unknown>): string {
  const json = JSON.stringify(graph, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
