/**
 * Pure best-of-n selection and the in-Worker JSON-LD candidate check.
 * No fetch and no provider keys, so the eval harness can load this file alone.
 */
import { validateSchemaJsonLd } from '../services/deployment/schemaSafetyGate';

export const HA_CAPS = {
  maxN: 3,
  maxCallsPerRun: 6,
  maxTokensPerCall: 2048,
  perCallTimeoutMs: 20_000,
  overallDeadlineMs: 45_000,
} as const;

export class HighAccuracyError extends Error {
  constructor(readonly code: string, readonly upstreamCode?: string | null) {
    super(code);
    this.name = 'HighAccuracyError';
  }
}

export class CallLedger {
  calls = 0;
  failed = 0;
  usageMissing = 0;
  promptTokens = 0;
  completionTokens = 0;

  constructor(readonly maxCalls: number = HA_CAPS.maxCallsPerRun) {}

  reserve(): void {
    if (this.calls >= this.maxCalls) throw new HighAccuracyError('call_cap');
    this.calls++;
  }

  record(usage?: { prompt_tokens?: number; completion_tokens?: number }): void {
    if (!usage || (usage.prompt_tokens === undefined && usage.completion_tokens === undefined)) {
      this.usageMissing++;
      return;
    }
    this.promptTokens += nonNeg(usage.prompt_tokens);
    this.completionTokens += nonNeg(usage.completion_tokens);
  }

  summary() {
    return {
      calls: this.calls,
      failed: this.failed,
      usageMissing: this.usageMissing,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
    };
  }
}

function nonNeg(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export interface CallResult { text: string; ms: number }

export type Validation<T> = { ok: true; value: T } | { ok: false; reasons: string[] };

function isFail<T>(v: Validation<T>): v is { ok: false; reasons: string[] } {
  return v.ok === false;
}

export interface BestOfNResult<T> {
  value: T | null;
  winnerIndex: number | null;
  attempts: { index: number; ok: boolean; reasons: string[] }[];
}

/** Escalate runs candidate 0 first and generates the rest only if it fails. The lowest passing index wins. */
export async function bestOfN<T>(opts: {
  n: number;
  generate: (index: number) => Promise<CallResult>;
  validate: (text: string) => Validation<T>;
  strategy?: 'escalate' | 'parallel';
}): Promise<BestOfNResult<T>> {
  const n = Math.max(1, Math.min(Math.floor(opts.n), HA_CAPS.maxN));
  const results = new Map<number, Validation<T>>();

  const runBatch = async (indices: number[]) => {
    const settled = await Promise.allSettled(indices.map((i) => opts.generate(i)));
    settled.forEach((s, k) => {
      const index = indices[k];
      if (s.status === 'fulfilled') {
        results.set(index, opts.validate(s.value.text));
        return;
      }
      const reason = s.reason instanceof HighAccuracyError ? s.reason.code : 'error';
      results.set(index, { ok: false, reasons: [reason] });
    });
  };

  const all = Array.from({ length: n }, (_, i) => i);
  if ((opts.strategy ?? 'escalate') === 'escalate') {
    await runBatch([0]);
    const first = results.get(0);
    if (first && !first.ok && n > 1) await runBatch(all.slice(1));
  } else {
    await runBatch(all);
  }

  const attempts = [...results.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, v]) => ({ index, ok: v.ok, reasons: isFail(v) ? v.reasons : [] }));
  const win = attempts.find((a) => a.ok);
  const winVal = win ? results.get(win.index) : undefined;
  return {
    value: winVal && !isFail(winVal) ? winVal.value : null,
    winnerIndex: win?.index ?? null,
    attempts,
  };
}

/**
 * Required properties, checked against Google Search Central on 20 Oct 2026.
 * Each inner array is "at least one of these keys".
 *
 * Google requires: Product name plus review|aggregateRating|offers (product snippets);
 * LocalBusiness name and address (subtypes included); Event name, startDate, location
 * (and location.name plus location.address); BreadcrumbList itemListElement;
 * ListItem name and position (item may be omitted on the last crumb).
 * Organization and Article have no Google-required properties. Organization still
 * requires name and url here so a candidate is tied to the audited site.
 * Article (and NewsArticle, BlogPosting) add nothing beyond the safety gate.
 * FAQPage still requires mainEntity. The safety gate only warns that it no longer
 * earns a rich result, so a well-formed FAQPage can still win.
 */
const REQUIRED_PROPS: Record<string, string[][]> = {
  Organization: [['name'], ['url']],
  LocalBusiness: [['name'], ['address']],
  Product: [['name'], ['offers', 'review', 'aggregateRating']],
  BreadcrumbList: [['itemListElement']],
  Event: [['name'], ['startDate'], ['location']],
  FAQPage: [['mainEntity']],
  ListItem: [['name'], ['position']],
};

const LOCAL_BUSINESS_TYPES = new Set([
  'Restaurant', 'FoodEstablishment', 'Bakery', 'BarOrPub', 'CafeOrCoffeeShop', 'FastFoodRestaurant',
  'IceCreamShop', 'Brewery', 'Winery', 'Distillery', 'Store', 'ClothingStore', 'ShoeStore',
  'GroceryStore', 'ConvenienceStore', 'DepartmentStore', 'ElectronicsStore', 'FurnitureStore',
  'HardwareStore', 'JewelryStore', 'SportingGoodsStore', 'PetStore', 'BookStore', 'ShoppingCenter',
  'Dentist', 'Physician', 'MedicalClinic', 'Pharmacy', 'VeterinaryCare', 'Optician', 'Hospital',
  'Hotel', 'LodgingBusiness', 'BedAndBreakfast', 'Hostel', 'Motel', 'Resort', 'Campground',
  'AutomotiveBusiness', 'AutoRepair', 'GasStation', 'HomeAndConstructionBusiness', 'Electrician',
  'Plumber', 'Locksmith', 'LegalService', 'Attorney', 'AccountingService', 'RealEstateAgent',
  'TravelAgency', 'InsuranceAgency', 'DaySpa', 'BeautySalon', 'HairSalon', 'NailSalon', 'HealthClub',
  'ExerciseGym', 'SportsActivityLocation', 'GolfCourse', 'StadiumOrArena', 'EntertainmentBusiness',
  'MovieTheater', 'AmusementPark', 'Library', 'FireStation', 'PoliceStation', 'PostOffice',
  'DryCleaningOrLaundry', 'ChildCare',
]);

const PLACEHOLDER_RE = /example\.(com|org|net)|lorem ipsum|\bYOUR[_ ]|\bTODO\b|XXX-?XXX/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function present(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

function rulesFor(type: string): string[][] {
  return REQUIRED_PROPS[type] ?? (LOCAL_BUSINESS_TYPES.has(type) ? REQUIRED_PROPS.LocalBusiness : []);
}

function nodesOf(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (!isRecord(n)) return;
    if (n['@type']) out.push(n);
    Object.values(n).forEach((v) => {
      if (typeof v === 'object' && v) walk(v);
    });
  };
  walk(root);
  return out;
}

function normHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

export function hostsMatch(urlHost: string, siteHost: string): boolean {
  const a = normHost(urlHost);
  const b = normHost(siteHost);
  return a === b || a.endsWith(`.${b}`);
}

function httpHost(raw: string, siteHost: string): string | null {
  try {
    const url = new URL(raw, `https://${siteHost}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function groundUrl(raw: string, siteHost: string, reasons: string[]): void {
  const host = httpHost(raw, siteHost);
  if (!host) {
    reasons.push('BAD_URL');
    return;
  }
  if (!hostsMatch(host, siteHost)) reasons.push('OFF_SITE_URL');
}

const HTTP_URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/** Drop on-site URLs before the placeholder scan so `acme.example.com` is not read as `example.com`. */
function withoutOnSiteUrls(text: string, siteHost: string): string {
  return text.replace(HTTP_URL_RE, (raw) => {
    const host = httpHost(raw.replace(/[),.;]+$/, ''), siteHost);
    return host && hostsMatch(host, siteHost) ? ' ' : raw;
  });
}

function placeholderHit(root: unknown, siteHost: string): boolean {
  const strings: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') {
      strings.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (isRecord(n)) Object.values(n).forEach(walk);
  };
  walk(root);
  return strings.some((text) => PLACEHOLDER_RE.test(withoutOnSiteUrls(text, siteHost)));
}

export function validateJsonLdCandidate(
  text: string,
  ctx: { siteHost: string; expectedType?: string },
): Validation<string> {
  const gate = validateSchemaJsonLd(text);
  if (!gate.okToDeploy || !gate.canonicalJson) {
    return { ok: false, reasons: gate.issues.filter((i) => i.severity === 'critical').map((i) => i.code) };
  }
  const reasons: string[] = [];
  if (gate.issues.some((i) => i.code === 'MISSING_CONTEXT')) reasons.push('MISSING_CONTEXT');
  let root: unknown;
  try {
    root = JSON.parse(gate.canonicalJson);
  } catch {
    return { ok: false, reasons: ['INVALID_JSON'] };
  }
  if (ctx.expectedType && !gate.parsedTypes.includes(ctx.expectedType)) reasons.push('WRONG_TYPE');
  if (placeholderHit(root, ctx.siteHost)) reasons.push('PLACEHOLDER');

  for (const node of nodesOf(root)) {
    const types = ([] as unknown[]).concat(node['@type']).filter((t): t is string => typeof t === 'string');
    for (const t of types) {
      for (const group of rulesFor(t)) {
        if (!group.some((p) => present(node[p]))) reasons.push(`MISSING_${t}_${group.join('|')}`);
      }
      if (t === 'Event' && present(node.location)) {
        const loc = node.location;
        if (!isRecord(loc) || !present(loc.name)) reasons.push('MISSING_Event_location.name');
        if (!isRecord(loc) || !present(loc.address)) reasons.push('MISSING_Event_location.address');
      }
      if (t === 'ListItem') {
        if (typeof node.item === 'string') groundUrl(node.item, ctx.siteHost, reasons);
        else if (isRecord(node.item) && typeof node.item['@id'] === 'string') groundUrl(node.item['@id'], ctx.siteHost, reasons);
      }
    }
    if (typeof node.url === 'string') groundUrl(node.url, ctx.siteHost, reasons);
  }
  return reasons.length ? { ok: false, reasons: [...new Set(reasons)] } : { ok: true, value: gate.canonicalJson };
}
