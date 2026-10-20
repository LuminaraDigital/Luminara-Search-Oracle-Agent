const MULTI_SUFFIXES = [
  'com.au', 'net.au', 'org.au', 'edu.au',
  'co.uk', 'org.uk', 'ac.uk',
  'co.nz', 'com.br', 'co.jp', 'com.sg', 'com.mx', 'co.za', 'com.tr',
];

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

/** Strip www and the public suffix, then title-case the registrable label. */
export function hostBrandLabel(input: string): string {
  const host = hostOnly(input);
  const suffix = MULTI_SUFFIXES.find((item) => host.endsWith(`.${item}`));
  const stem = suffix ? host.slice(0, -(suffix.length + 1)) : host.split('.').slice(0, -1).join('.');
  const label = (stem || host).split('.').filter(Boolean).pop() || '';
  if (!label || label === 'www') return 'Your business';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** A short scraped name. A raw host, a URL, or "Www" is not a name. */
export function cleanScrapedName(value: string | null | undefined): string {
  const raw = (value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const head = raw.split(/\s+[|:]\s+|\s+-\s+|\s+\u2013\s+|\s+\u2014\s+/)[0]?.trim() || raw;
  if (!head || head.length > 48) return '';
  if (/^(www|home|welcome|index|untitled)(\.|$)/i.test(head)) return '';
  if (/^https?:/i.test(head)) return '';
  if (head.includes('.') && !head.includes(' ')) return '';
  return head;
}

export function rememberScrapedBrand(host: string, value: string | null | undefined): void {
  rememberedHost = hostOnly(host);
  rememberedName = cleanScrapedName(value);
}

export function clearRememberedBrand(): void {
  rememberedHost = '';
  rememberedName = '';
}

/** Scraped name for this host, otherwise the title-cased registrable label. */
export function brandNameFor(host: string, explicit?: string | null): string {
  const given = cleanScrapedName(explicit);
  if (given) return given;
  if (rememberedName && hostOnly(host) === rememberedHost) return rememberedName;
  return hostBrandLabel(host);
}
