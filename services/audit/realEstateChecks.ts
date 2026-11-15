/**
 * Real-estate checks from pages we actually fetched.
 * A blocked or missing fetch is Not measured. A parsed page is Measured,
 * whether the markup was there or not.
 */

import { pageFetchBlocked } from '../agentCore/auditEvidenceGate';
import { BLOCKED_CHECK } from './llmCrawlerReadiness';
import { filterChecksForIndustry, industryProfile } from '../industries/industryProfiles';

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
  id: 'schema' | 'nap' | 'agent_pages' | 'agent_profile' | 'area_pages' | 'listing_pages' | 'gbp' | 'reviews' | 'answer_prompts';
  label: string;
  status: RealEstateCheckStatus;
  /** True when the signal was present. Null when the fetch did not measure it. */
  hit: boolean | null;
  detail: string;
}

const CHECKS: Array<Pick<RealEstateCheck, 'id' | 'label'>> = [
  { id: 'schema', label: 'RealEstateAgent or LocalBusiness schema' },
  { id: 'nap', label: 'NAP consistency' },
  { id: 'agent_pages', label: 'Agent profile pages' },
  { id: 'agent_profile', label: 'Agent profile name' },
  { id: 'area_pages', label: 'Suburb or area pages' },
  { id: 'listing_pages', label: 'Listing pages' },
  { id: 'gbp', label: 'Google Business Profile link' },
  { id: 'reviews', label: 'Review schema' },
  { id: 'answer_prompts', label: 'AI answer prompts' },
];

/** Series key for snapshot compare. Bump it when the check set changes, so old scores are not compared. */
export const REAL_ESTATE_SERIES = 'real estate checks';

const AGENT_PATH = /\/(agents?|team|our-team|people|staff|meet-the-team)(\/|$)/i;
const AREA_PATH = /\/(suburbs?|areas?|locations?|neighbourhoods?|neighborhoods?|communities)(\/|$)/i;
const LISTING_PATH = /\/(listings?|propert(?:y|ies)|for-sale|for-rent|sold)(\/|$)/i;
const AREA_SLUG = /\/(?:suburbs?|areas?|locations?|neighbourhoods?|neighborhoods?|communities)\/([^/?#]+)/i;
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
  return CHECKS.map((check) => ({ ...check, status: 'not_measured', hit: null, detail }));
}

function schemaFacts(page: RealEstatePageInput, labels: Map<string, string>): {
  naps: Nap[];
  links: string[];
  agencyNames: string[];
  suburbs: string[];
  profileNames: Array<{ url: string; name: string }>;
} {
  const naps: Nap[] = [];
  const links: string[] = [];
  const agencyNames: string[] = [];
  const suburbs: string[] = [];
  const profileNames: Array<{ url: string; name: string }> = [];
  const visit = (record: Record<string, unknown>) => {
    rememberType(record['@type'], labels);
    const types = typeNames(record['@type']);
    const name = stringField(record.name);
    const address = addressText(record.address);
    const phone = stringField(record.telephone);
    const entityType = types.some((type) => /realestateagent|localbusiness/.test(type) && type !== 'organization');
    if (entityType && name && !agencyNames.includes(name)) agencyNames.push(name);
    if (entityType) {
      pushArea(record.areaServed, suburbs);
      const address = record.address;
      if (isRecord(address)) pushSuburb(stringField(address.addressLocality), suburbs);
    }
    if (name && types.some((type) => type === 'person' || type === 'realestateagent') && AGENT_PATH.test(pathOf(page.url))) {
      profileNames.push({ url: page.url, name });
    }
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
  return { naps, links, agencyNames, suburbs, profileNames };
}

function listUrls(urls: string[]): string {
  const shown = urls.slice(0, 3).join(', ');
  const extra = urls.length > 3 ? ` and ${urls.length - 3} more` : '';
  return `${shown}${extra}`;
}

function napDetail(naps: Nap[]): { status: RealEstateCheckStatus; hit: boolean | null; detail: string } {
  const complete = naps.filter((item) => item.name && item.address && item.phone);
  if (complete.length < 2) {
    const found = complete.length === 1 ? `1 complete set on ${complete[0].url}` : 'no complete name, address, and phone set';
    return {
      status: 'not_measured',
      hit: null,
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
      hit: true,
      detail: `Measured. Name, address, and phone match on ${listUrls(complete.map((item) => item.url))}.`,
    };
  }
  const parts: string[] = [];
  if (nameDiff) parts.push(`name "${clip(first.name)}" on ${first.url} and "${clip(nameDiff.name)}" on ${nameDiff.url}`);
  if (addressDiff) parts.push(`address "${clip(first.address)}" on ${first.url} and "${clip(addressDiff.address)}" on ${addressDiff.url}`);
  if (phoneDiff) parts.push(`phone ${clip(first.phone, 24)} on ${first.url} and ${clip(phoneDiff.phone, 24)} on ${phoneDiff.url}`);
  return { status: 'measured', hit: false, detail: `Measured. ${parts.join('; ')}.` };
}

function typeNames(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim().toLowerCase()];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeNames(item));
}

function pushSuburb(raw: string, into: string[]): void {
  const text = raw.toLowerCase().replace(/[-_]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 3 || text.length > 40 || into.includes(text)) return;
  into.push(text);
}

function pushArea(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    pushSuburb(value, into);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) pushArea(item, into);
    return;
  }
  if (isRecord(value)) pushSuburb(stringField(value.name), into);
}

function suburbFromUrl(url: string): string {
  const match = pathOf(url).match(AREA_SLUG);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Prompts an answer engine could be asked. Built only from a name or suburb that was on a parsed page. */
export function buildAnswerPrompts(agencyName: string, suburbs: readonly string[]): string[] {
  const prompts: string[] = [];
  const name = oneLine(agencyName);
  if (name) prompts.push(`who is the real estate agent at ${name}`);
  for (const suburb of suburbs.slice(0, 3)) {
    prompts.push(`real estate agent in ${suburb}`);
    if (prompts.length >= 6) return prompts;
  }
  if (name && suburbs[0] && prompts.length < 6) prompts.push(`${name} ${suburbs[0]}`);
  return prompts.slice(0, 6);
}

export function realEstateFollowUps(page: RealEstatePageInput, limit = 3): string[] {
  let host = '';
  try {
    host = new URL(page.url).hostname;
  } catch {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of page.outboundLinks || []) {
    if (out.length >= limit) break;
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      continue;
    }
    if (parsed.hostname !== host) continue;
    const path = parsed.pathname;
    if (!AGENT_PATH.test(path) && !AREA_PATH.test(path) && !LISTING_PATH.test(path)) continue;
    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function realEstatePageFromHtml(html: string, pageUrl: string, status: number): RealEstatePageInput {
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const links: string[] = [];
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    if (links.length >= 40) break;
    try {
      links.push(new URL(match[1], pageUrl).toString());
    } catch {
      continue;
    }
  }
  const schemas: Array<{ type?: string; rawJson?: string }> = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (schemas.length >= 5) break;
    schemas.push({ rawJson: match[1].slice(0, 20_000) });
  }
  return {
    url: pageUrl,
    httpStatus: status,
    title,
    rawTextSnippet: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
    outboundLinks: links,
    schemasFound: schemas,
  };
}

export function realEstateCoverage(checks: readonly RealEstateCheck[]): {
  series: string;
  measurementStatus: RealEstateCheckStatus;
  score: number | null;
  notes: string[];
} {
  const scored = checks.filter((check) => check.id !== 'answer_prompts' && check.status === 'measured');
  if (scored.length === 0) {
    return { series: '', measurementStatus: 'not_measured', score: null, notes: [] };
  }
  const notes = scored.filter((check) => check.hit === false).map((check) => `missing ${check.label}`).slice(0, 7);
  const prompts = checks.find((check) => check.id === 'answer_prompts');
  if (prompts?.hit) notes.push(prompts.detail.slice(0, 160));
  return {
    series: scored.map((check) => check.id).sort().join('|'),
    measurementStatus: 'measured',
    score: scored.filter((check) => check.hit === true).length,
    notes: notes.slice(0, 8),
  };
}

export function measureRealEstate(pages: readonly RealEstatePageInput[]): { checks: RealEstateCheck[]; prompts: string[] } {
  if (pages.length === 0) return { checks: blank('Not measured (page was not fetched).'), prompts: [] };
  const live = parsedPages(pages);
  if (live.length === 0) return { checks: blank(BLOCKED_CHECK), prompts: [] };

  const typeLabels = new Map<string, string>();
  const naps: Nap[] = [];
  const links = new Set<string>();
  const agencyNames: string[] = [];
  const suburbs: string[] = [];
  const profileNames: Array<{ url: string; name: string }> = [];
  for (const page of live) {
    links.add(page.url);
    for (const link of page.outboundLinks || []) {
      if (link) links.add(link);
    }
    const facts = schemaFacts(page, typeLabels);
    naps.push(...facts.naps);
    for (const link of facts.links) links.add(link);
    for (const name of facts.agencyNames) {
      if (!agencyNames.includes(name)) agencyNames.push(name);
    }
    for (const suburb of facts.suburbs) pushSuburb(suburb, suburbs);
    profileNames.push(...facts.profileNames);
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
  const listingUrls = urls.filter((url) => LISTING_PATH.test(pathOf(url)));
  const gbpUrls = urls.filter((url) => GBP_LINK.test(url));
  for (const url of urls) pushSuburb(suburbFromUrl(url), suburbs);
  const reviewTypes = typeKeys
    .filter((type) => type.includes('review') || type.includes('aggregaterating'))
    .map((type) => typeLabels.get(type) || type);
  const nap = napDetail(naps);
  const tel = urls.filter((url) => url.toLowerCase().startsWith('tel:'));
  const schemaPhone = naps.find((item) => item.phone)?.phone || '';
  const oddTel = schemaPhone ? tel.find((url) => phoneKey(decodeURIComponent(url.slice(4))) !== phoneKey(schemaPhone)) : undefined;
  if (nap.hit === true && oddTel) {
    nap.hit = false;
    nap.detail = `${nap.detail} Phone link ${clip(decodeURIComponent(oddTel.slice(4)), 24)} does not match that schema phone.`;
  }
  const fetchedProfiles = live.filter((page) => AGENT_PATH.test(pathOf(page.url)));
  const profile = profileNames[0];
  const profileCheck: RealEstateCheck = fetchedProfiles.length === 0
    ? agentUrls.length
      ? {
          id: 'agent_profile',
          label: CHECKS[3].label,
          status: 'not_measured',
          hit: null,
          detail: 'Not measured. Agent profile URLs were linked, and those pages were not in this fetch.',
        }
      : {
          id: 'agent_profile',
          label: CHECKS[3].label,
          status: 'measured',
          hit: false,
          detail: 'Measured. No agent profile page was in the pages we read.',
        }
    : profile
      ? {
          id: 'agent_profile',
          label: CHECKS[3].label,
          status: 'measured',
          hit: true,
          detail: `Measured. Agent profile name "${clip(profile.name)}" on ${profile.url}.`,
        }
      : {
          id: 'agent_profile',
          label: CHECKS[3].label,
          status: 'measured',
          hit: false,
          detail: `Measured. Fetched agent profile pages and none named a person in schema: ${listUrls(fetchedProfiles.map((page) => page.url))}.`,
        };
  const prompts = buildAnswerPrompts(agencyNames[0] || '', suburbs);
  const promptDetail = prompts.length
    ? `Measured. Prompts built from the parsed pages. They were not sent to an AI answer engine: ${prompts.join('; ')}.`
    : 'Measured. No agency name or suburb was in the parsed pages, so no AI answer prompt was built.';

  const checks: RealEstateCheck[] = [
    { id: 'schema', label: CHECKS[0].label, status: 'measured', hit: entity.length > 0, detail: schemaDetail },
    { id: 'nap', label: CHECKS[1].label, status: nap.status, hit: nap.hit, detail: nap.detail },
    {
      id: 'agent_pages',
      label: CHECKS[2].label,
      status: 'measured',
      hit: agentUrls.length > 0,
      detail: agentUrls.length
        ? `Measured. Agent profile URL: ${listUrls(agentUrls)}.`
        : `Measured. None of the ${urls.length} page and link URLs we read is an agent profile page.`,
    },
    profileCheck,
    {
      id: 'area_pages',
      label: CHECKS[4].label,
      status: 'measured',
      hit: areaUrls.length > 0,
      detail: areaUrls.length
        ? `Measured. Suburb or area URL: ${listUrls(areaUrls)}.`
        : `Measured. None of the ${urls.length} page and link URLs we read is a suburb or area page.`,
    },
    {
      id: 'listing_pages',
      label: CHECKS[5].label,
      status: 'measured',
      hit: listingUrls.length > 0,
      detail: listingUrls.length
        ? `Measured. Listing URL: ${listUrls(listingUrls)}.`
        : `Measured. None of the ${urls.length} page and link URLs we read is a listing page.`,
    },
    {
      id: 'gbp',
      label: CHECKS[6].label,
      status: 'measured',
      hit: gbpUrls.length > 0,
      detail: gbpUrls.length
        ? `Measured. Google Business Profile link: ${listUrls(gbpUrls)}.`
        : 'Measured. No Google Business Profile link was in the pages we parsed.',
    },
    {
      id: 'reviews',
      label: CHECKS[7].label,
      status: 'measured',
      hit: reviewTypes.length > 0,
      detail: reviewTypes.length
        ? `Measured. ${reviewTypes.join(', ')} on ${listUrls(pageUrls)}.`
        : 'Measured. No Review or AggregateRating schema was in the pages we parsed.',
    },
    {
      id: 'answer_prompts',
      label: CHECKS[8].label,
      status: 'measured',
      hit: prompts.length > 0,
      detail: promptDetail,
    },
  ];
  return { checks, prompts };
}

export function evaluateRealEstateChecks(
  pages: readonly RealEstatePageInput[],
  industryId?: string | null,
): RealEstateCheck[] {
  return filterChecksForIndustry(measureRealEstate(pages).checks, industryId);
}

export function formatRealEstateChecks(checks: readonly RealEstateCheck[], industryId?: string | null): string {
  const profile = industryId ? industryProfile(industryId) : null;
  const lines = [`## ${profile ? profile.reportHeading : 'Real estate checks'}`];
  if (profile) lines.push(`Written for ${profile.reportAudience}.`);
  lines.push(...checks.map((check) => `- ${check.label}: ${check.detail}`));
  return `${lines.join('\n')}\n`;
}
