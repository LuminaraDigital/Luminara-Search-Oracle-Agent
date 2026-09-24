/**
 * Authenticated PageSpeed Insights proxy (BYOK header or hosted PAGESPEED_API_KEY).
 * Hosted key use is metered like other hosted providers.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { json } from './workerUtils';
import { clientIp } from './security';
import { fetchPagespeedInsights } from '../services/technical/pageSpeedService';
import { checkHostedQuota } from './quotaMiddleware';

export async function handlePagespeedRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    strategy?: 'mobile' | 'desktop';
  };
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) {
    return json({ ok: false, error: 'url required', code: 'BAD_REQUEST' }, 400);
  }

  const byok = request.headers.get('x-pagespeed-key')?.trim() || null;
  const usingHosted = !byok;
  const apiKey = byok || env.PAGESPEED_API_KEY || null;
  if (!apiKey) {
    return json(
      {
        ok: false,
        error: 'PageSpeed API key missing. Add a Google PSI key in Settings, or ask an operator to set PAGESPEED_API_KEY.',
        code: 'PSI_KEY_MISSING',
      },
      400,
    );
  }

  if (usingHosted) {
    const quota = await checkHostedQuota(env, user, { clientIp: clientIp(request) });
    if (!quota.ok) {
      return json(
        {
          ok: false,
          error: quota.error || 'Hosted PageSpeed quota exceeded',
          code: 'QUOTA_EXCEEDED',
          limit: quota.limit,
          remaining: quota.remaining,
        },
        429,
      );
    }
  }

  const metrics = await fetchPagespeedInsights({
    url,
    apiKey,
    strategy: body.strategy === 'desktop' ? 'desktop' : 'mobile',
  });

  return json({
    ok: metrics.measurementStatus === 'measured',
    metrics,
  });
}
