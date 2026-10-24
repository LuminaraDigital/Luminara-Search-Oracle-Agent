/**
 * Headers for Identity Toolkit REST calls that use the public web API key.
 * Sign-up, sign-in, password reset, and account delete must send the same set.
 * A key restricted by HTTP referrer rejects any call that omits Referer.
 */
import type { Env } from './env';

export function identityReferer(env: Pick<Env, 'WEBAPP_URL'>): string {
  const raw = String(env.WEBAPP_URL || '').trim();
  if (!raw) return 'https://luminarasuite.com/';
  try {
    return new URL(raw).href;
  } catch {
    return raw.endsWith('/') ? raw : `${raw}/`;
  }
}

export function identityToolkitHeaders(
  env: Pick<Env, 'WEBAPP_URL'>,
  appCheckToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    Referer: identityReferer(env),
  };
  const appCheck = String(appCheckToken || '').trim();
  if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;
  return headers;
}
