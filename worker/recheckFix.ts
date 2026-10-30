/**
 * Re-reads one check on the homepage. Spends one hosted check, and gives it back when nothing was measured.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { json } from './workerUtils';
import { checkHostedQuota, QUOTA_CAPACITY_ERROR, refundMeteredQuota } from './quotaMiddleware';
import { resolvesToPublicAddress, safePublicUrl, type DohFetch } from './security';
import { readCapped } from './domainVerification';
import { readRecheck } from '../services/upgrade/recheckReading';
import { auditHostname } from './auditScoutRun';

const MAX_BYTES = 64_000;
const FETCH_MS = 5_000;

export async function recheckOneFix(
  env: Env,
  user: HostedIdentity,
  body: { domain?: unknown; checkId?: unknown; expect?: string | unknown; targetUrl?: unknown },
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const domain = auditHostname(typeof body.domain === 'string' ? body.domain : '');
  const checkId = typeof body.checkId === 'string' ? body.checkId : '';
  const expect = typeof body.expect === 'string' ? body.expect.trim().slice(0, 80) : '';
  const rawTargetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
  if (!domain) return json({ ok: false, error: 'A public site is required.', code: 'BAD_REQUEST' }, 400);

  const quota = await checkHostedQuota(env, user);
  if (!quota.ok) {
    const capacity = quota.error === QUOTA_CAPACITY_ERROR;
    return json(
      { ok: false, error: quota.error, code: capacity ? 'HOSTED_CAPACITY' : 'PAYWALL_EXCEEDED', measured: false, passed: null, detail: 'Not measured.' },
      capacity ? 503 : 402,
    );
  }

  const pageUrl =
    checkId === 'brand_mention'
      ? rawTargetUrl
        ? safePublicUrl(rawTargetUrl)
        : null
      : safePublicUrl(`https://${domain}/`);
  const publicHost = pageUrl ? await resolvesToPublicAddress(pageUrl.hostname, fetcher as DohFetch) : false;
  let html = '';
  let status = 0;
  if (pageUrl && publicHost) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_MS);
    try {
      const res = await fetcher(pageUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: { accept: 'text/html' },
      });
      status = res.status;
      if (res.ok && status < 300) html = await readCapped(res, MAX_BYTES);
    } catch {
      html = '';
    } finally {
      clearTimeout(timer);
    }
  }

  const reading = readRecheck(html, pageUrl?.toString() || `https://${domain}/`, status, checkId, expect);
  if (!reading.measured) await refundMeteredQuota(env, quota);
  return json({ ok: true, ...reading });
}
