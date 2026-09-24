/**
 * Isomorphic key helpers for browser configService and Worker-side agents.
 * No window/localStorage dependency so Worker code can inject credential bags.
 */

export type RuntimeKeyBag = Record<string, string | undefined | null>;

/** Storage / bag keys for DataForSEO Basic auth (login + password). */
export const DATAFORSEO_LOGIN_KEY = 'luminara_dataforseo_login';
export const DATAFORSEO_PASSWORD_KEY = 'luminara_dataforseo_password';
/** Optional combined form `login:password` (relay x-provider-key). */
export const DATAFORSEO_COMBINED_KEY = 'luminara_dataforseo_key';

export function trimKey(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readBagKey(bag: RuntimeKeyBag, key: string): string {
  return trimKey(bag[key]);
}

/**
 * Resolve DataForSEO credentials as `login:password` for Basic auth / x-provider-key.
 * Prefers separate login+password; falls back to combined key.
 */
export function resolveDataForSeoCredential(bag: RuntimeKeyBag): string {
  const login = readBagKey(bag, DATAFORSEO_LOGIN_KEY);
  const password = readBagKey(bag, DATAFORSEO_PASSWORD_KEY);
  if (login && password) return `${login}:${password}`;
  return readBagKey(bag, DATAFORSEO_COMBINED_KEY);
}

export function hasDataForSeoCredentials(bag: RuntimeKeyBag): boolean {
  const cred = resolveDataForSeoCredential(bag);
  const colon = cred.indexOf(':');
  return colon > 0 && colon < cred.length - 1;
}

export function parseDataForSeoLoginPassword(raw: string): { login: string; password: string } | null {
  const cred = trimKey(raw);
  const colon = cred.indexOf(':');
  if (colon <= 0 || colon >= cred.length - 1) return null;
  return { login: cred.slice(0, colon), password: cred.slice(colon + 1) };
}

/** RFC 7617 user-pass token for Authorization: Basic … */
export function encodeHttpBasicAuth(login: string, password: string): string {
  const raw = `${login}:${password}`;
  if (typeof btoa === 'function') {
    return btoa(raw);
  }
  // Node / Vitest without btoa
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Buf = (globalThis as any).Buffer;
  if (Buf) return Buf.from(raw, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  throw new Error('No base64 encoder available');
}

export function dataForSeoBasicAuthHeader(credential: string): string | null {
  const parsed = parseDataForSeoLoginPassword(credential);
  if (!parsed) return null;
  return `Basic ${encodeHttpBasicAuth(parsed.login, parsed.password)}`;
}

/** True when Worker env has hosted DataForSEO secrets. */
export function envHasDataForSeo(env: {
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
}): boolean {
  return Boolean(trimKey(env.DATAFORSEO_LOGIN) && trimKey(env.DATAFORSEO_PASSWORD));
}
