const GENERIC_PREFIX = /^(www|home|welcome|index|untitled|official site|official website)$/i;

let rememberedHost = '';
let rememberedName = '';

function hostOnly(input: string): string {
  let host = input.trim().toLowerCase().replace(/^https?:\/\//, '');
  host = host.split('/')[0]?.split('?')[0]?.split('#')[0] || '';
  const colon = host.indexOf(':');
  if (colon > 0) host = host.slice(0, colon);
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

/** A name copied from the page. A host, a URL, or a generic word is not a name. Casing stays as scraped. */
export function cleanScrapedName(value: string | null | undefined): string {
  const raw = (value || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length > 80) return '';
  if (GENERIC_PREFIX.test(raw)) return '';
  if (/^https?:/i.test(raw)) return '';
  if (raw.includes('.') && !raw.includes(' ')) return '';
  return raw;
}

/** Title or site-name prefix. A generic prefix such as Home is not a brand, and the tail is not used. */
function named(value: string | null | undefined): string | null {
  const raw = (value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const head = raw.split(/\s+[|:]\s+|\s+-\s+|\s+\u2013\s+|\s+\u2014\s+/)[0]?.trim() || '';
  if (head !== raw && !cleanScrapedName(head)) return null;
  return cleanScrapedName(head) || null;
}

export type BrandSources = {
  siteName?: string | null;
  organizationName?: string | null;
  title?: string | null;
};

/** og:site_name, then the Organization name, then the title prefix. Never a title-cased domain. */
export function brandFromEvidence(sources: BrandSources): string | null {
  return named(sources.siteName) || named(sources.organizationName) || named(sources.title);
}

/** Title-cased domain stem. raywhite.com.au becomes Raywhite. ray-white.com becomes Ray White. */
export function readableStem(host: string): string {
  const stem = hostOnly(host).split('.')[0] || 'site';
  const words = stem.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return 'Site';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function nameParts(value: string | null | undefined): string[] {
  const raw = (value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  return raw
    .split(/\s+[|:]\s+|\s+-\s+|\s+\u2013\s+|\s+\u2014\s+/)
    .map((part) => cleanScrapedName(part))
    .filter((part) => part.length > 0);
}

/** Names already on the page or in search titles. A host is not a name. At most six. */
export function brandCandidates(sources: BrandSources & { searchTitles?: readonly string[] | null }): string[] {
  const values = [sources.siteName, sources.organizationName, sources.title, ...(sources.searchTitles || [])];
  const found: string[] = [];
  for (const value of values) {
    for (const part of nameParts(value)) {
      if (found.some((item) => item.toLowerCase() === part.toLowerCase())) continue;
      found.push(part);
      if (found.length >= 6) return found;
    }
  }
  return found;
}

const ENTITY_TYPE = /organization|corporation|localbusiness|realestateagent/;

/** Name on an Organization, Corporation, LocalBusiness, or RealEstateAgent block. */
export function organizationNameFromJson(schemas: Array<{ type: string; rawJson: string }>): string | null {
  for (const schema of schemas) {
    if (!ENTITY_TYPE.test(schema.type.toLowerCase())) continue;
    try {
      const raw = JSON.parse(schema.rawJson) as { name?: unknown };
      const name = cleanScrapedName(typeof raw.name === 'string' ? raw.name : '');
      if (name) return name;
    } catch {
      continue;
    }
  }
  return null;
}

export function rememberScrapedBrand(host: string, value: string | null | undefined): void {
  rememberedHost = hostOnly(host);
  rememberedName = cleanScrapedName(value);
}

export function clearRememberedBrand(): void {
  rememberedHost = '';
  rememberedName = '';
}

/** Scraped name for this host. Null when the page did not give one. */
export function brandNameFor(host: string, explicit?: string | null): string | null {
  const given = named(explicit);
  if (given) return given;
  if (rememberedName && hostOnly(host) === rememberedHost) return rememberedName;
  return null;
}
