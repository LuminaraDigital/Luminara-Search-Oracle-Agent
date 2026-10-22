/**
 * Real-estate checks from pages we actually fetched.
 * A blocked or missing fetch is Not measured. A parsed page is Measured,
 * whether the markup was there or not.
 */

import { pageFetchBlocked } from '../agentCore/auditEvidenceGate';
import { BLOCKED_CHECK } from './llmCrawlerReadiness';

export type RealEstateCheckStatus = 'measured' | 'not_measured';

export interface RealEstatePageInput {
  url: string;
  httpStatus?: number;
  title?: string;
  rawTextSnippet?: string;
  schemasFound?: ReadonlyArray<{ type?: string; rawJson?: string }>;
  outboundLinks?: readonly string[];
}

export interface RealEstateCheck {
  id: 'schema' | 'nap' | 'agent_pages' | 'area_pages' | 'gbp' | 'reviews';
  label: string;
  status: RealEstateCheckStatus;
  detail: string;
}

const CHECKS: Array<Pick<RealEstateCheck, 'id' | 'label'>> = [
  { id: 'schema', label: 'RealEstateAgent or LocalBusiness schema' },
  { id: 'nap', label: 'NAP consistency' },
  { id: 'agent_pages', label: 'Agent profile pages' },
  { id: 'area_pages', label: 'Suburb or area pages' },
  { id: 'gbp', label: 'Google Business Profile link' },
  { id: 'reviews', label: 'Review schema' },
];

const AGENT_PATH = /\/(agents?|team|our-team|people|staff|meet-the-team)(\/|$)/i;
const AREA_PATH = /\/(suburbs?|areas?|locations?|neighbourhoods?|neighborhoods?|communities)(\/|$)/i;
const GBP_LINK = /(?:google\.[a-z.]+\/maps|maps\.google\.|g\.page\/|business\.google\.|goo\.gl\/maps)/i;
const ENTITY = /realestateagent|localbusiness|organization/;

interface Nap {
  url: string;
  name: string;
  address: string;
  phone: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? oneLine(value) : '';
}

function addressText(value: unknown): string {
  const direct = stringField(value);
  if (direct) return direct;
  if (!isRecord(value)) return '';
  return [value.streetAddress, value.addressLocality, value.addressRegion, value.postalCode]
    .map(stringField)
    .filter(Boolean)
    .join(', ');
}

function rememberType(value: unknown, labels: Map<string, string>): void {
  if (typeof value === 'string' && value.trim()) {
    const label = value.trim();
    const key = label.toLowerCase();
    if (!labels.has(key)) labels.set(key, label);
  } else if (Array.isArray(value)) {
    for (const item of value) rememberType(item, labels);
  }
}

function walk(node: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!isRecord(node)) return;
  visit(node);
  if (node['@graph']) walk(node['@graph'], visit);
}

function clip(value: string, max = 80): string {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function phoneKey(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length > 9) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function sameText(left: string, right: string): boolean {
  return left.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === right.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pathOf(value: string): string {
  try {
    return new URL(value, 'https://example.test').pathname;
  } catch {
    return value;
  }
}

function parsedPages(pages: readonly RealEstatePageInput[]): RealEstatePageInput[] {
  return pages.filter((page) => page.url && !pageFetchBlocked({
    httpStatus: page.httpStatus,
    title: page.title || '',
    rawTextSnippet: page.rawTextSnippet || '',
  }));
}

function blank(detail: string): RealEstateCheck[] {
  return CHECKS.map((check) => ({ ...check, status: 'not_measured', detail }));
}

function schemaFacts(page: RealEstatePageInput, labels: Map<string, string>): { naps: Nap[]; links: string[] } {
  const naps: Nap[] = [];
  const links: string[] = [];
  const visit = (record: Record<string, unknown>) => {
    rememberType(record['@type'], labels);
    const name = stringField(record.name);
    const address = addressText(record.address);
    const phone = stringField(record.telephone);
    if (name || address || phone) naps.push({ url: page.url, name, address, phone });
    for (const key of ['sameAs', 'hasMap', 'url'] as const) {
      const value = record[key];
      if (typeof value === 'string' && /^https?:/i.test(value)) links.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && /^https?:/i.test(item)) links.push(item);
        }
      }
    }
  };
  if (page.schemasFound) {
    for (const schema of page.schemasFound) {
      if (schema.type) rememberType(schema.type, labels);
      if (!schema.rawJson) continue;
      try {
        const parsed: unknown = JSON.parse(schema.rawJson);
        walk(parsed, visit);
      } catch {
        continue;
      }
    }
  }
  return { naps, links };
}

function listUrls(urls: string[]): string {
  const shown = urls.slice(0, 3).join(', ');
  const extra = urls.length > 3 ? ` and ${urls.length - 3} more` : '';
  return `${shown}${extra}`;
}

function napDetail(naps: Nap[]): { status: RealEstateCheckStatus; detail: string } {
  const complete = naps.filter((item) => item.name && item.address && item.phone);
  if (complete.length < 2) {
    const found = complete.length === 1 ? `1 complete set on ${complete[0].url}` : 'no complete name, address, and phone set';
    return {
      status: 'not_measured',
      detail: `Not measured. Parsed pages had ${found}, so consistency was not compared.`,
    };
  }
  const first = complete[0];
  const nameDiff = complete.find((item) => !sameText(item.name, first.name));
  const addressDiff = complete.find((item) => !sameText(item.address, first.address));
  const phoneDiff = complete.find((item) => phoneKey(item.phone) !== phoneKey(first.phone));
  if (!nameDiff && !addressDiff && !phoneDiff) {
    return {
      status: 'measured',
      detail: `Measured. Name, address, and phone match on ${listUrls(complete.map((item) => item.url))}.`,
    };
  }
  const parts: string[] = [];
  if (nameDiff) parts.push(`name "${clip(first.name)}" on ${first.url} and "${clip(nameDiff.name)}" on ${nameDiff.url}`);
  if (addressDiff) parts.push(`address "${clip(first.address)}" on ${first.url} and "${clip(addressDiff.address)}" on ${addressDiff.url}`);
  if (phoneDiff) parts.push(`phone ${clip(first.phone, 24)} on ${first.url} and ${clip(phoneDiff.phone, 24)} on ${phoneDiff.url}`);
  return { status: 'measured', detail: `Measured. ${parts.join('; ')}.` };
}

export function evaluateRealEstateChecks(pages: readonly RealEstatePageInput[]): RealEstateCheck[] {
  if (pages.length === 0) return blank('Not measured (page was not fetched).');
  const live = parsedPages(pages);
  if (live.length === 0) return blank(BLOCKED_CHECK);

  const typeLabels = new Map<string, string>();
  const naps: Nap[] = [];
  const links = new Set<string>();
  for (const page of live) {
    links.add(page.url);
    for (const link of page.outboundLinks || []) {
      if (link) links.add(link);
    }
    const facts = schemaFacts(page, typeLabels);
    naps.push(...facts.naps);
    for (const link of facts.links) links.add(link);
  }
  const urls = [...links];
  const pageUrls = live.map((page) => page.url);
  const typeKeys = [...typeLabels.keys()];
  const entity = typeKeys.filter((type) => ENTITY.test(type) && type !== 'organization').map((type) => typeLabels.get(type) || type);
  const shownTypes = typeKeys.slice(0, 6).map((type) => typeLabels.get(type) || type);
  const schemaDetail = entity.length
    ? `Measured. ${entity.join(', ')} on ${listUrls(pageUrls)}.`
    : `Measured. Parsed schema on ${listUrls(pageUrls)}: ${shownTypes.length ? shownTypes.join(', ') : 'none'}. RealEstateAgent and LocalBusiness were not among them.`;

  const agentUrls = urls.filter((url) => AGENT_PATH.test(pathOf(url)));
  const areaUrls = urls.filter((url) => AREA_PATH.test(pathOf(url)));
  const gbpUrls = urls.filter((url) => GBP_LINK.test(url));
  const reviewTypes = typeKeys
    .filter((type) => type.includes('review') || type.includes('aggregaterating'))
    .map((type) => typeLabels.get(type) || type);
  const nap = napDetail(naps);

  return [
    { id: 'schema', label: CHECKS[0].label, status: 'measured', detail: schemaDetail },
    { id: 'nap', label: CHECKS[1].label, status: nap.status, detail: nap.detail },
    {
      id: 'agent_pages',
      label: CHECKS[2].label,
      status: 'measured',
      detail: agentUrls.length
        ? `Measured. Agent profile URL: ${listUrls(agentUrls)}.`
        : `Measured. None of the ${urls.length} page and link URLs we read is an agent profile page.`,
    },
    {
      id: 'area_pages',
      label: CHECKS[3].label,
      status: 'measured',
      detail: areaUrls.length
        ? `Measured. Suburb or area URL: ${listUrls(areaUrls)}.`
        : `Measured. None of the ${urls.length} page and link URLs we read is a suburb or area page.`,
    },
    {
      id: 'gbp',
      label: CHECKS[4].label,
      status: 'measured',
      detail: gbpUrls.length
        ? `Measured. Google Business Profile link: ${listUrls(gbpUrls)}.`
        : 'Measured. No Google Business Profile link was in the pages we parsed.',
    },
    {
      id: 'reviews',
      label: CHECKS[5].label,
      status: 'measured',
      detail: reviewTypes.length
        ? `Measured. ${reviewTypes.join(', ')} on ${listUrls(pageUrls)}.`
        : 'Measured. No Review or AggregateRating schema was in the pages we parsed.',
    },
  ];
}

export function formatRealEstateChecks(checks: readonly RealEstateCheck[]): string {
  const lines = ['## Real estate checks', ...checks.map((check) => `- ${check.label}: ${check.detail}`)];
  return `${lines.join('\n')}\n`;
}
