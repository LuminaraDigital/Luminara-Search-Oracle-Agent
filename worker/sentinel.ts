import type { Env } from './env';
import { MAX_SMALL_BODY_BYTES, readBody, safePublicHostname } from './security';
import { identify, json } from './workerUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { sendTelegramAlert, planCapsFor } from './telegramBot';

export interface SentinelTarget {
  id: string;
  /** HostedIdentity.id of the person who registered the target (Telegram "123" or Firebase "fb:uid"). */
  ownerId?: string;
  domain: string;
  brandName: string;
  tgChatId?: number | string;
  keywords: string[];
  lastScanAt?: number;
  lastCitationRate?: number;
  lastIntegrityScore?: number;
  lastSecurityTrust?: number;
  lastStatus?: 'healthy' | 'drift_detected' | 'remediated' | 'reaudit_due';
  driftAlertSentAt?: number;
  /** Scheduled re-audit cadence (Rakazo-style routine jobs). */
  reauditCadence?: 'none' | 'monthly' | 'weekly' | 'daily';
  lastReauditNudgeAt?: number;
  /** Competitors to watch for citation presence in SERP snippets. */
  competitorNames?: string[];
  lastCompetitorHits?: Record<string, boolean>;
}

/** Edge security audit without CORS limits. Score: https40+redir15+hsts15+csp10+ref5+xfo5+sectxt10. */
export async function auditSecurityOnEdge(domain: string): Promise<{
  httpsEnforced: boolean;
  redirectsToHttps: boolean;
  hstsEnabled: boolean;
  cspDetected: boolean;
  referrerPolicy: boolean;
  xFrameOptions: boolean;
  securityTxtPresent: boolean;
  trustScore: number;
  measurementConfidence: 'full' | 'cors_limited' | 'failed';
}> {
  const httpsUrl = `https://${domain}`;
  let hsts = false;
  let csp = false;
  let referrerPolicy = false;
  let xFrameOptions = false;
  let redirectsToHttps = false;
  let securityTxtPresent = false;
  let fetchWorked = false;

  try {
    let res = await fetch(httpsUrl, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
    if (!res || !res.ok) {
      res = await fetch(httpsUrl, { method: 'GET', redirect: 'follow' }).catch(() => null);
    }
    if (res) {
      fetchWorked = true;
      hsts = Boolean(res.headers.get('strict-transport-security'));
      csp = Boolean(res.headers.get('content-security-policy'));
      referrerPolicy = Boolean(res.headers.get('referrer-policy'));
      xFrameOptions = Boolean(res.headers.get('x-frame-options'));
    }

    const httpUrl = `http://${domain}`;
    const redir = await fetch(httpUrl, { method: 'GET', redirect: 'follow' }).catch(() => null);
    if (redir?.url?.startsWith('https://')) redirectsToHttps = true;

    const st = await fetch(`https://${domain}/.well-known/security.txt`, { method: 'GET' }).catch(() => null);
    if (st && st.ok) {
      const body = await st.text().catch(() => '');
      securityTxtPresent = /contact\s*:/i.test(body) || /canonical\s*:/i.test(body);
    }
  } catch {
    // leave defaults
  }

  const measurementConfidence = fetchWorked ? 'full' : 'failed';
  let trustScore = 40; // https assumed for edge probe target
  if (redirectsToHttps) trustScore += 15;
  if (hsts) trustScore += 15;
  if (csp) trustScore += 10;
  if (referrerPolicy) trustScore += 5;
  if (xFrameOptions) trustScore += 5;
  if (securityTxtPresent) trustScore += 10;

  return {
    httpsEnforced: true,
    redirectsToHttps,
    hstsEnabled: hsts,
    cspDetected: csp,
    referrerPolicy,
    xFrameOptions,
    securityTxtPresent,
    trustScore: Math.min(100, trustScore),
    measurementConfidence,
  };
}

export async function runSentinelScan(env: Env): Promise<{ scanned: number; alertsSent: number; reauditNudges: number }> {
  try {
    const raw = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get('sentinel:targets', 'json')) as SentinelTarget[] | null) : null;
    const targets = raw || [];
    if (targets.length === 0) return { scanned: 0, alertsSent: 0, reauditNudges: 0 };

    let alertsSent = 0;
    let reauditNudges = 0;
    const updatedTargets: SentinelTarget[] = [];
    const dayMs = 24 * 3600 * 1000;

    for (const target of targets) {
      // Legacy or tampered records: never probe non-public hosts, never alert a chat the owner doesn't own.
      if (!safePublicHostname(target.domain)) continue;
      const alertChat = target.ownerId && target.tgChatId !== undefined && String(target.tgChatId) === String(target.ownerId) ? target.tgChatId : undefined;
      const keyword = target.keywords?.[0] || `${target.brandName || target.domain} solutions`;
      let cited = true;
      let serpBlob = '';

      if (env.TAVILY_API_KEY) {
        try {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: env.TAVILY_API_KEY,
              query: keyword,
              search_depth: 'basic',
              max_results: 5,
            }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as { results?: Array<{ url: string; content: string }> };
            const cleanDomain = target.domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
            cited = (data.results || []).some(r => r.url.toLowerCase().includes(cleanDomain));
            serpBlob = (data.results || []).map(r => `${r.url} ${r.content || ''}`).join('\n').toLowerCase();
          }
        } catch (e) {
          console.warn('[Sentinel] Tavily search fallback', e);
        }
      }

      let securityTrust = target.lastSecurityTrust;
      try {
        const sec = await auditSecurityOnEdge(target.domain);
        securityTrust = sec.trustScore;
      } catch {
        // keep previous
      }

      const trustRegression =
        typeof target.lastSecurityTrust === 'number' &&
        typeof securityTrust === 'number' &&
        target.lastSecurityTrust - securityTrust > 20;

      const now = Date.now();
      const competitorHits: Record<string, boolean> = { ...(target.lastCompetitorHits || {}) };
      const competitorChanges: string[] = [];
      for (const name of target.competitorNames || []) {
        const hit = serpBlob.includes(name.toLowerCase());
        const prev = target.lastCompetitorHits?.[name];
        if (typeof prev === 'boolean' && prev !== hit) {
          competitorChanges.push(hit ? `[[${name}]] gained SERP presence` : `[[${name}]] lost SERP presence`);
        }
        competitorHits[name] = hit;
      }

      const needsAlert = !cited || trustRegression || competitorChanges.length > 0;
      let status: SentinelTarget['lastStatus'] = needsAlert ? 'drift_detected' : 'healthy';

      if (needsAlert && alertChat && env.BOT_TOKEN) {
        const canAlert = !target.driftAlertSentAt || (now - target.driftAlertSentAt > dayMs);
        if (canAlert) {
          const reasons: string[] = [];
          if (!cited) reasons.push('Brand citation missing from top AI answers.');
          if (trustRegression) {
            reasons.push(
              `Trust regression: security trust dropped from ${target.lastSecurityTrust} to ${securityTrust} (>20 point drop).`
            );
          }
          if (competitorChanges.length) reasons.push(`Competitor deltas: ${competitorChanges.join('; ')}.`);
          const alertMsg = `⚠️ *Luminara 24/7 Drift Sentinel Alert*\n\n` +
            `Your domain *${target.domain}* has detected an AEO citation or trust regression.\n` +
            `• Target query: _${keyword}_\n` +
            `• Current status: ${reasons.join(' ')}\n\n` +
            `Tap below to review the empirical diff and deploy 1-click schema remediation.`;

          const sent = await sendTelegramAlert(env, alertChat, alertMsg, env.WEBAPP_URL);
          if (sent) {
            alertsSent++;
            target.driftAlertSentAt = now;
          }
        }
      }

      // Scheduled re-audit nudges (weekly / monthly / daily routines).
      const cadence = target.reauditCadence || 'none';
      const cadenceMs =
        cadence === 'daily' ? dayMs : cadence === 'weekly' ? 7 * dayMs : cadence === 'monthly' ? 30 * dayMs : 0;
      let lastReauditNudgeAt = target.lastReauditNudgeAt;
      if (cadenceMs > 0 && alertChat && env.BOT_TOKEN) {
        const due = !lastReauditNudgeAt || now - lastReauditNudgeAt >= cadenceMs;
        if (due) {
          const nudge = `🗓️ *Luminara scheduled re-audit*\n\n` +
            `It is time for your *${cadence}* AEO check on *${target.domain}*.\n` +
            `Open the app → Audit my website to refresh Brand Memory and competitor citation deltas.`;
          const sent = await sendTelegramAlert(env, alertChat, nudge, env.WEBAPP_URL);
          if (sent) {
            reauditNudges++;
            lastReauditNudgeAt = now;
            status = 'reaudit_due';
          }
        }
      }

      updatedTargets.push({
        ...target,
        lastScanAt: now,
        lastStatus: status,
        lastSecurityTrust: securityTrust,
        lastCompetitorHits: competitorHits,
        lastReauditNudgeAt,
        driftAlertSentAt: target.driftAlertSentAt,
      });
    }

    if (env.LUMINARA_KV) {
      await env.LUMINARA_KV.put('sentinel:targets', JSON.stringify(updatedTargets));
    }
    return { scanned: targets.length, alertsSent, reauditNudges };
  } catch (err) {
    console.error('[Sentinel] Scheduled scan error', err);
    return { scanned: 0, alertsSent: 0, reauditNudges: 0 };
  }
}

/**
 * Handles /sentinel/register and /sentinel/status.
 * Drift Sentinel targets are owned by the signed-in Telegram user.
 */
export async function handleSentinelRoute(request: Request, env: Env, path: string): Promise<Response> {
  const who = await identify(request, env);
  if (!who.user) return json({ error: who.error || 'Telegram sign-in required' }, 401);
  const ownerId = who.user.id;

  if (path === '/sentinel/status') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const raw = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get('sentinel:targets', 'json')) as SentinelTarget[] | null) : null;
    return json({ ok: true, targets: (raw || []).filter(t => t.ownerId === ownerId) });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ error: read.error }, read.status);
  const body = (read.value || {}) as Partial<SentinelTarget>;
  const cleanDomain = safePublicHostname(String(body.domain || ''));
  if (!cleanDomain) return json({ error: 'domain must be a public hostname such as example.com' }, 400);

  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map(k => k.trim().slice(0, 200)).slice(0, 10)
    : [];
  const raw = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get('sentinel:targets', 'json')) as SentinelTarget[] | null) : null;
  const targets = raw || [];
  const ownedCount = targets.filter(t => t.ownerId === ownerId).length;
  if (targets.length >= 500) return json({ error: 'Sentinel is full. Try again later.' }, 503);

  const sub = await getActiveSubscription(env, who.user);
  const caps = planCapsFor(sub?.plan);
  const existingIdx = targets.findIndex(t => t.domain.toLowerCase() === cleanDomain && t.ownerId === ownerId);
  if (existingIdx < 0 && ownedCount >= caps.sentinelLimit) {
    const msg =
      caps.sentinelLimit <= 0
        ? 'Drift Sentinel requires a paid plan. Upgrade to Starter or higher.'
        : `Your plan allows up to ${caps.sentinelLimit} watched domains. Upgrade for more.`;
    return json({ error: msg, code: 'DOMAIN_LIMIT', limit: caps.sentinelLimit, plan: sub?.plan || 'free' }, 402);
  }

  const bodyExtra = body as { reauditCadence?: string; competitorNames?: string[] };
  const cadenceRaw = typeof bodyExtra.reauditCadence === 'string' ? bodyExtra.reauditCadence : caps.scheduledReaudit;
  const reauditCadence =
    cadenceRaw === 'monthly' || cadenceRaw === 'weekly' || cadenceRaw === 'daily' ? cadenceRaw : 'none';

  const newTarget: SentinelTarget = {
    id: existingIdx >= 0 ? targets[existingIdx].id : `sentinel-${Date.now()}-${ownerId}`,
    ownerId,
    domain: cleanDomain,
    brandName: typeof body.brandName === 'string' && body.brandName.trim() ? body.brandName.trim().slice(0, 100) : cleanDomain.split('.')[0],
    // Alerts are delivered over Telegram only, and only to the registering user's own chat.
    tgChatId: who.user.source === 'telegram' ? Number(ownerId) : undefined,
    keywords: keywords.length > 0 ? keywords : [`what is ${cleanDomain}`, `best ${cleanDomain} alternative`],
    lastScanAt: Date.now(),
    lastStatus: 'healthy',
    reauditCadence,
    competitorNames: Array.isArray(bodyExtra.competitorNames)
      ? bodyExtra.competitorNames
          .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
          .map(k => k.trim().slice(0, 100))
          .slice(0, 20)
      : [],
  };

  if (existingIdx >= 0) {
    targets[existingIdx] = { ...targets[existingIdx], ...newTarget };
  } else {
    targets.push(newTarget);
  }

  if (env.LUMINARA_KV) {
    await env.LUMINARA_KV.put('sentinel:targets', JSON.stringify(targets));
  }
  return json({ ok: true, target: newTarget });
}
