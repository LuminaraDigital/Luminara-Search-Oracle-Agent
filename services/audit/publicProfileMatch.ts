/**
 * Compare the agency name, phone, address, and service area on a page with its own JSON-LD.
 * A fetched page is Measured whether the markup matches or not. A page we did not read is Not measured.
 * The Google Business Profile API is never called.
 */

export type ProfileSignal = 'match' | 'mismatch' | 'missing' | 'not_measured';

export type PublicProfileCheck = {
  id: 'name' | 'phone' | 'address' | 'service_area' | 'real_estate_agent' | 'gbp_api';
  label: string;
  status: 'measured' | 'not_measured';
  signal: ProfileSignal;
  detail: string;
};

export type PublicProfileReport = {
  checks: PublicProfileCheck[];
  nextFix: string | null;
  signals: {
    hasRealEstateAgent: boolean | null;
    name: ProfileSignal;
    phone: ProfileSignal;
    address: ProfileSignal;
    serviceArea: ProfileSignal;
  };
};

export type PublicProfileInput = {
  /** False when the page was not fetched. Every comparison is then Not measured. */
  pageRead: boolean;
  /**
   * True when `visibleText` is the page we fetched, not a short excerpt.
   * A short excerpt that lacks a value is Not measured, so a snippet cannot invent a mismatch.
   */
  textComplete: boolean;
  title?: string | null;
  visibleText?: string | null;
  /** JSON-LD script bodies. Invalid JSON is ignored. */
  jsonLd?: readonly string[];
};

const TEXT_ENOUGH = 400;

const GBP_DETAIL =
  'Not measured. This check does not call the Google Business Profile API. That API needs Google approval before it can confirm the live profile. This check only compares the site with its own structured data.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, max = 80): string {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function typeNames(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const part = item.trim().split('/').pop() || '';
    if (part) names.push(part);
  }
  return names;
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

function areaNames(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = oneLine(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(areaNames);
  if (isRecord(value)) return areaNames(value.name);
  return [];
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

type EntityFacts = {
  types: string[];
  name: string;
  phone: string;
  address: string;
  areas: string[];
};

function readEntities(blocks: readonly string[]): EntityFacts[] {
  const found: EntityFacts[] = [];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    walk(parsed, (record) => {
      const types = typeNames(record['@type']);
      if (!types.length) return;
      found.push({
        types,
        name: stringField(record.name),
        phone: stringField(record.telephone),
        address: addressText(record.address),
        areas: areaNames(record.areaServed),
      });
    });
  }
  return found;
}

function isAgencyType(entity: EntityFacts): boolean {
  return entity.types.some((type) => {
    const name = type.toLowerCase();
    return name === 'realestateagent' || name === 'localbusiness' || name === 'professionalservice';
  });
}

function rankEntity(entity: EntityFacts): number {
  const types = entity.types.map((type) => type.toLowerCase());
  if (types.includes('realestateagent')) return 0;
  if (types.includes('localbusiness')) return 1;
  return 2;
}

function chooseEntity(entities: EntityFacts[]): EntityFacts | null {
  const ranked = entities.filter(isAgencyType);
  if (!ranked.length) return null;
  return [...ranked].sort((a, b) => rankEntity(a) - rankEntity(b))[0] ?? null;
}

function phoneKey(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length > 9) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function haystack(input: PublicProfileInput): string {
  return `${input.title || ''} ${input.visibleText || ''}`;
}

function pageDigits(input: PublicProfileInput): string {
  return haystack(input).replace(/\D/g, '');
}

function comparable(input: PublicProfileInput): boolean {
  return input.textComplete || haystack(input).trim().length >= TEXT_ENOUGH;
}

function measured(id: PublicProfileCheck['id'], label: string, signal: ProfileSignal, detail: string): PublicProfileCheck {
  return { id, label, status: 'measured', signal, detail: `Measured. ${detail}` };
}

function notMeasured(id: PublicProfileCheck['id'], label: string, detail: string): PublicProfileCheck {
  return { id, label, status: 'not_measured', signal: 'not_measured', detail: `Not measured. ${detail}` };
}

function compareName(input: PublicProfileInput, name: string): PublicProfileCheck {
  const label = 'Agency name';
  if (!name) return notMeasured('name', label, 'Structured data has no name to compare.');
  if (fold(name).length < 3) return notMeasured('name', label, 'The structured-data name is too short to compare.');
  if (fold(haystack(input)).includes(fold(name))) {
    return measured('name', label, 'match', `The name "${clip(name)}" appears on the page.`);
  }
  if (!comparable(input)) {
    return notMeasured('name', label, 'The page text we stored is too short to compare with the structured-data name.');
  }
  return measured('name', label, 'mismatch', `The name "${clip(name)}" is in structured data and does not appear on the page text we read.`);
}

function comparePhone(input: PublicProfileInput, phone: string): PublicProfileCheck {
  const label = 'Phone';
  const key = phoneKey(phone);
  if (!phone || key.length < 8) return notMeasured('phone', label, 'Structured data has no phone to compare.');
  if (pageDigits(input).includes(key)) {
    return measured('phone', label, 'match', `The phone ${clip(phone, 24)} appears on the page.`);
  }
  if (!comparable(input)) {
    return notMeasured('phone', label, 'The page text we stored is too short to compare with the structured-data phone.');
  }
  return measured('phone', label, 'mismatch', `Structured data lists ${clip(phone, 24)}, and that number does not appear on the page text we read.`);
}

function compareAddress(input: PublicProfileInput, address: string): PublicProfileCheck {
  const label = 'Address';
  if (!address) return notMeasured('address', label, 'Structured data has no street or suburb to compare.');
  const folded = fold(haystack(input));
  const addressFold = fold(address);
  const number = (address.match(/\d{1,6}/) || [])[0] || '';
  const word = addressFold.split(' ').find((part) => part.length >= 5 && !/^\d+$/.test(part)) || '';
  const fullHit = addressFold.length >= 8 && folded.includes(addressFold);
  const partsHit = Boolean(number && word && folded.includes(number) && folded.includes(word));
  if (fullHit || partsHit) {
    return measured('address', label, 'match', `The address "${clip(address)}" appears on the page.`);
  }
  if (!number || !word) {
    return notMeasured('address', label, 'The structured-data address is too short to compare.');
  }
  if (!comparable(input)) {
    return notMeasured('address', label, 'The page text we stored is too short to compare with the structured-data address.');
  }
  return measured('address', label, 'mismatch', `Structured data lists "${clip(address)}", and that address does not appear on the page text we read.`);
}

function compareAreas(input: PublicProfileInput, areas: string[]): PublicProfileCheck {
  const label = 'Service area';
  const names = areas.map(oneLine).filter((name) => fold(name).length >= 3);
  if (!names.length) return notMeasured('service_area', label, 'Structured data has no service area to compare.');
  const folded = fold(haystack(input));
  const missing = names.filter((name) => !folded.includes(fold(name)));
  if (!missing.length) {
    return measured('service_area', label, 'match', `The service area ${names.slice(0, 4).map((name) => `"${clip(name, 40)}"`).join(', ')} appears on the page.`);
  }
  if (!comparable(input)) {
    return notMeasured('service_area', label, 'The page text we stored is too short to compare with the structured-data service area.');
  }
  return measured(
    'service_area',
    label,
    'mismatch',
    `Structured data lists ${missing.slice(0, 3).map((name) => `"${clip(name, 40)}"`).join(', ')}, and that text does not appear on the page we read.`,
  );
}

function schemaCheck(hasAgencyType: boolean, anyRealEstate: boolean): PublicProfileCheck {
  const label = 'RealEstateAgent schema';
  if (anyRealEstate) return measured('real_estate_agent', label, 'match', 'RealEstateAgent schema is on the page.');
  if (hasAgencyType) {
    return measured('real_estate_agent', label, 'missing', 'Local business structured data is on the page, and RealEstateAgent is not.');
  }
  return measured('real_estate_agent', label, 'missing', 'No RealEstateAgent schema was in the JSON-LD we read.');
}

function nextFix(checks: PublicProfileCheck[]): string | null {
  const byId = (id: PublicProfileCheck['id']) => checks.find((check) => check.id === id);
  const schema = byId('real_estate_agent');
  if (schema?.signal === 'missing') {
    return 'Add RealEstateAgent JSON-LD with your agency name, phone, and suburbs, then paste it on the homepage. This check does not publish it.';
  }
  const phone = byId('phone');
  if (phone?.signal === 'mismatch') return 'Use the same phone on the page and in the RealEstateAgent structured data.';
  const name = byId('name');
  if (name?.signal === 'mismatch') return 'Use the same agency name on the page and in the RealEstateAgent structured data.';
  const address = byId('address');
  if (address?.signal === 'mismatch') return 'Use the same address on the page and in the RealEstateAgent structured data.';
  const area = byId('service_area');
  if (area?.signal === 'mismatch') return 'Name the same suburbs on the page and in areaServed.';
  return null;
}

function unreadReport(): PublicProfileReport {
  const detail = 'The page was not read, so it was not compared with structured data.';
  const checks: PublicProfileCheck[] = [
    notMeasured('name', 'Agency name', detail),
    notMeasured('phone', 'Phone', detail),
    notMeasured('address', 'Address', detail),
    notMeasured('service_area', 'Service area', detail),
    notMeasured('real_estate_agent', 'RealEstateAgent schema', detail),
    notMeasured('gbp_api', 'Google Business Profile', GBP_DETAIL.replace(/^Not measured\. /, '')),
  ];
  return {
    checks,
    nextFix: null,
    signals: {
      hasRealEstateAgent: null,
      name: 'not_measured',
      phone: 'not_measured',
      address: 'not_measured',
      serviceArea: 'not_measured',
    },
  };
}

export function reportPublicProfile(input: PublicProfileInput): PublicProfileReport {
  if (!input.pageRead) return unreadReport();
  const entities = readEntities(input.jsonLd || []);
  const anyRealEstate = entities.some((entity) => entity.types.some((type) => type.toLowerCase() === 'realestateagent'));
  const entity = chooseEntity(entities);
  const schema = schemaCheck(entities.some(isAgencyType), anyRealEstate);
  const name = entity ? compareName(input, entity.name) : notMeasured('name', 'Agency name', 'No LocalBusiness or RealEstateAgent structured data to compare.');
  const phone = entity ? comparePhone(input, entity.phone) : notMeasured('phone', 'Phone', 'No LocalBusiness or RealEstateAgent structured data to compare.');
  const address = entity ? compareAddress(input, entity.address) : notMeasured('address', 'Address', 'No LocalBusiness or RealEstateAgent structured data to compare.');
  const serviceArea = entity ? compareAreas(input, entity.areas) : notMeasured('service_area', 'Service area', 'No LocalBusiness or RealEstateAgent structured data to compare.');
  const gbp: PublicProfileCheck = {
    id: 'gbp_api',
    label: 'Google Business Profile',
    status: 'not_measured',
    signal: 'not_measured',
    detail: GBP_DETAIL,
  };
  const checks = [schema, name, phone, address, serviceArea, gbp];
  return {
    checks,
    nextFix: nextFix(checks),
    signals: {
      hasRealEstateAgent: anyRealEstate,
      name: name.signal,
      phone: phone.signal,
      address: address.signal,
      serviceArea: serviceArea.signal,
    },
  };
}

/** Visible text for a fetched homepage. Script, style, and comments are dropped. Linear in the capped input. */
export function htmlToVisibleText(html: string): { text: string; tels: string[] } {
  const capped = html.slice(0, 256_000);
  const tels: string[] = [];
  const telRe = /href\s*=\s*["']tel:([^"']+)["']/gi;
  for (let match = telRe.exec(capped); match; match = telRe.exec(capped)) {
    const value = oneLine(match[1] || '');
    if (value) tels.push(value);
  }
  let stripped = cutBlocks(capped, 'script');
  stripped = cutBlocks(stripped, 'style');
  stripped = cutBlocks(stripped, 'noscript');
  stripped = cutComments(stripped);
  const text = decodeBasic(stripped.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 12_000);
  return { text, tels };
}

function cutBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let at = 0;
  let out = '';
  for (;;) {
    const start = lower.indexOf(open, at);
    if (start < 0) return out + html.slice(at);
    out += html.slice(at, start);
    const end = lower.indexOf(close, start + open.length);
    if (end < 0) return out;
    const after = lower.indexOf('>', end + close.length);
    at = after < 0 ? html.length : after + 1;
  }
}

function cutComments(html: string): string {
  let at = 0;
  let out = '';
  for (;;) {
    const start = html.indexOf('<!--', at);
    if (start < 0) return out + html.slice(at);
    out += html.slice(at, start);
    const end = html.indexOf('-->', start + 2);
    if (end < 0) return out;
    at = end + 3;
  }
}

function decodeBasic(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function reportFromAuditPages(
  pages: readonly { title?: string; rawTextSnippet?: string; schemasFound?: readonly { rawJson?: string }[] }[],
): PublicProfileReport {
  if (!pages.length) return reportPublicProfile({ pageRead: false, textComplete: false });
  const jsonLd = pages.flatMap((page) => (page.schemasFound || []).map((schema) => schema.rawJson || '').filter(Boolean));
  const visibleText = pages.map((page) => page.rawTextSnippet || '').filter(Boolean).join('\n');
  return reportPublicProfile({
    pageRead: true,
    textComplete: false,
    title: pages[0]?.title || null,
    visibleText,
    jsonLd,
  });
}

export function formatPublicProfile(report: PublicProfileReport): string {
  const lines = ['## Public profile', ...report.checks.map((check) => `- ${check.label}: ${check.detail}`)];
  lines.push(`- Estimated: none. This read does not estimate rankings or AI citations.`);
  if (report.nextFix) lines.push(`One next fix: ${report.nextFix}`);
  return `${lines.join('\n')}\n`;
}
