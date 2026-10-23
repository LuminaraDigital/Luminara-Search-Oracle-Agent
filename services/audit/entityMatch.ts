/**
 * Same-entity check for Instant Audit.
 * A row counts only when the audited hostname or the full legal name is present.
 * A shared stem (Luminara candles, luminara.institute) is a different organization.
 */

export type AuditedEntity = {
  domain: string;
  brandName?: string | null;
};

export type MentionKind = 'same' | 'namesake' | 'other';

export type MentionRow = {
  url?: string | null;
  title?: string | null;
  text?: string | null;
};

export type WikidataSearchHit = {
  id: string;
  label: string;
  description?: string;
};

const MIN_STEM = 4;

export const NAMESAKE_OMISSION_NOTE =
  'Omitted search rows about a different organization that only shares the name. They are not this business. Do not cite them or recommend a citation on their domain.';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function auditedHost(input: string): string {
  let host = input.trim().toLowerCase().replace(/^https?:\/\//, '');
  host = host.split('/')[0]?.split('?')[0]?.split('#')[0] || '';
  const colon = host.indexOf(':');
  if (colon > 0) host = host.slice(0, colon);
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

function hostFromUrl(value?: string | null): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return auditedHost(new URL(withProto).hostname);
  } catch {
    return auditedHost(trimmed);
  }
}

export function sameSite(host: string, auditedDomain: string): boolean {
  const left = auditedHost(host);
  const right = auditedHost(auditedDomain);
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`);
}

/** Same name label, different registrable site. A subdomain of the audited host is the same site. */
export function isNamesakeHost(host: string, auditedDomain: string): boolean {
  const left = auditedHost(host);
  const right = auditedHost(auditedDomain);
  if (!left || !right || !left.includes('.') || sameSite(left, right)) return false;
  const stem = right.split('.')[0] || '';
  if (stem.length < MIN_STEM) return false;
  const labels = left.split('.');
  return labels.some((label, index) => label === stem && index < labels.length - 1);
}

function textHasHost(text: string, host: string): boolean {
  if (!host) return false;
  // A sentence period after the host still counts. A further label (example.com.evil) does not.
  return new RegExp(`(?:^|[^a-z0-9-])${escapeRegExp(host)}(?=$|[^a-z0-9.-]|\\.(?![a-z0-9]))`, 'i').test(text);
}

function distinctPhrase(brand: string, stem: string): string | null {
  const normalized = brand.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized || normalized === stem) return null;
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 1);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0] === stem ? null : tokens[0];
  return tokens.join(' ');
}

function phrasePresent(text: string, phrase: string): boolean {
  const words = phrase.split(' ').map(escapeRegExp);
  return new RegExp(`(?:^|\\W)${words.join('\\W+')}(?:$|\\W)`, 'i').test(text);
}

function stemWordPresent(text: string, stem: string): boolean {
  if (stem.length < MIN_STEM) return false;
  return new RegExp(`(?:^|\\W)${escapeRegExp(stem)}(?:$|\\W)`, 'i').test(text);
}

function namesakeHostInText(text: string, audited: string): boolean {
  const hosts = text.toLowerCase().match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g) || [];
  return hosts.some((host) => isNamesakeHost(host, audited));
}

export function classifyMention(entity: AuditedEntity, row: MentionRow): MentionKind {
  const audited = auditedHost(entity.domain);
  if (!audited || !audited.includes('.')) return 'other';
  const stem = audited.split('.')[0] || '';
  const urlHost = hostFromUrl(row.url);
  if (urlHost && sameSite(urlHost, audited)) return 'same';
  if (urlHost && isNamesakeHost(urlHost, audited)) return 'namesake';

  const blob = `${row.title || ''} ${row.text || ''}`;
  if (textHasHost(blob, audited) || textHasHost(row.url || '', audited)) return 'same';

  const phrase = distinctPhrase(entity.brandName || '', stem);
  const collided = namesakeHostInText(`${blob} ${row.url || ''}`, audited);
  if (phrase && phrasePresent(blob, phrase) && !collided) return 'same';
  if (collided) return 'namesake';
  if (stemWordPresent(blob, stem)) return 'namesake';
  return 'other';
}

export function withoutNamesakes<T extends { url?: string; title?: string; content?: string; snippet?: string }>(
  rows: readonly T[],
  entity: AuditedEntity,
): { kept: T[]; omitted: number } {
  const kept: T[] = [];
  let omitted = 0;
  for (const row of rows) {
    const kind = classifyMention(entity, {
      url: row.url,
      title: row.title,
      text: row.content || row.snippet || '',
    });
    if (kind === 'namesake') omitted += 1;
    else kept.push(row);
  }
  return { kept, omitted };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readWikidataSearch(value: unknown): WikidataSearchHit[] {
  if (!isRecord(value) || !Array.isArray(value.search)) return [];
  const hits: WikidataSearchHit[] = [];
  for (const item of value.search) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string') continue;
    hits.push({
      id: item.id,
      label: item.label,
      description: typeof item.description === 'string' ? item.description : undefined,
    });
  }
  return hits;
}

/** First Wikidata hit that is this business. No search[0] fallback. */
export function pickWikidataHit(
  hits: readonly WikidataSearchHit[],
  entity: AuditedEntity,
): WikidataSearchHit | null {
  for (const hit of hits) {
    if (classifyMention(entity, { title: hit.label, text: hit.description || '' }) === 'same') return hit;
  }
  return null;
}
