import type { Env } from './env';
import { resolvesToPublicAddress, safePublicHostname } from './security';
import { identify, json } from './workerUtils';
import { auditSecurityOnEdge } from './sentinel';

/**
 * Handles GET /api/enrichment/entity
 * Signed-in Wikidata & Wayback Machine edge resolution with KV cache and SSRF protection.
 */
export async function handleEntityEnrichment(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (env.REQUIRE_TG_AUTH === 'true') {
    const who = await identify(request, env);
    if (who.error || !who.user) return json({ error: who.error || 'Sign in required' }, 401);
  }

  const url = new URL(request.url);
  const domainParam = url.searchParams.get('domain') || '';
  const cleanDomain = safePublicHostname(domainParam);
  if (!cleanDomain) {
    return json({ error: 'domain query parameter must be a public hostname such as example.com' }, 400);
  }
  const brand = (url.searchParams.get('brand') || cleanDomain.split('.')[0] || '').slice(0, 200);
  const cacheKey = `enrich:${cleanDomain}`;

  try {
    const cached = env.LUMINARA_KV ? await env.LUMINARA_KV.get(cacheKey, 'json') : null;
    if (cached) {
      return json({ ok: true, cached: true, data: cached });
    }
  } catch {
    // KV miss/unbound in local dev, proceed to fetch
  }

  // SSRF guard: the Worker is about to fetch https://<domain> on the caller's behalf. The name
  // must resolve to public addresses only (loopback, RFC1918, link-local, metadata are refused).
  if (!(await resolvesToPublicAddress(cleanDomain))) {
    return json({ error: 'domain does not resolve to a public address' }, 400);
  }

  const [wikidataRes, waybackRes, securityRes, microlinkRes] = await Promise.allSettled([
    (async () => {
      const qUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brand)}&language=en&format=json&origin=*&limit=1`;
      const res = await fetch(qUrl, { headers: { 'User-Agent': 'LuminaraOracle/1.0 (https://luminarasuite.com)' } });
      if (!res.ok) return null;
      const data: any = await res.json();
      const first = data?.search?.[0];
      if (!first) return null;
      const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(String(first.label || brand).replace(/\s+/g, '_'))}`;
      return {
        id: first.id,
        label: first.label,
        description: first.description,
        url: `https://www.wikidata.org/wiki/${first.id}`,
        wikipediaUrl,
      };
    })(),
    (async () => {
      const wbUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanDomain)}&timestamp=19960101`;
      const res = await fetch(wbUrl, { headers: { 'User-Agent': 'LuminaraOracle/1.0 (https://luminarasuite.com)' } });
      if (!res.ok) return null;
      const data: any = await res.json();
      const snap = data?.archived_snapshots?.closest;
      if (!snap || !snap.timestamp) {
        return { hasArchive: false, status: 'unindexed' as const };
      }
      const ts = String(snap.timestamp);
      const year = parseInt(ts.substring(0, 4), 10);
      const month = ts.substring(4, 6);
      const day = ts.substring(6, 8);
      const earliestDate = `${year}-${month}-${day}`;
      const archivedYearsAgo = Math.max(0, new Date().getFullYear() - year);
      let status: 'historic_authority' | 'established' | 'new_domain' | 'unindexed' = 'new_domain';
      if (archivedYearsAgo >= 10) status = 'historic_authority';
      else if (archivedYearsAgo >= 3) status = 'established';
      return {
        hasArchive: true,
        earliestDate,
        archivedYearsAgo,
        snapshotUrl: snap.url as string,
        status,
        // legacy fields kept for older clients
        earliestTimestamp: ts,
        firstArchiveYear: year,
        archiveSnapshotUrl: snap.url as string,
      };
    })(),
    auditSecurityOnEdge(cleanDomain),
    (async () => {
      try {
        const mlUrl = `https://api.microlink.io/?url=${encodeURIComponent(`https://${cleanDomain}`)}`;
        const res = await fetch(mlUrl, { headers: { 'User-Agent': 'LuminaraOracle/1.0 (https://luminarasuite.com)' } });
        if (!res.ok) return null;
        const data: any = await res.json();
        if (data?.status !== 'success' || !data?.data) return null;
        return {
          title: data.data.title,
          description: data.data.description,
          publisher: data.data.publisher,
          image: data.data.image?.url,
          author: data.data.author,
          date: data.data.date,
          lang: data.data.lang,
        };
      } catch {
        return null;
      }
    })(),
  ]);

  const wikidata = wikidataRes.status === 'fulfilled' ? wikidataRes.value : null;
  const waybackRaw = waybackRes.status === 'fulfilled' ? waybackRes.value : null;
  const wayback = waybackRaw || { hasArchive: false, status: 'unindexed' as const };
  const security =
    securityRes.status === 'fulfilled'
      ? securityRes.value
      : {
          httpsEnforced: true,
          redirectsToHttps: false,
          hstsEnabled: false,
          cspDetected: false,
          referrerPolicy: false,
          xFrameOptions: false,
          securityTxtPresent: false,
          trustScore: 40,
          measurementConfidence: 'failed' as const,
        };
  const metadata = microlinkRes.status === 'fulfilled' ? microlinkRes.value : null;

  const sameAsUrls: string[] = [];
  if (wikidata?.url) sameAsUrls.push(wikidata.url);
  if (wikidata?.wikipediaUrl) sameAsUrls.push(wikidata.wikipediaUrl);

  const result = {
    domain: cleanDomain,
    brandName: brand,
    brand,
    wikidata,
    wayback,
    metadata,
    security,
    sameAsUrls,
    timestamp: Date.now(),
  };

  try {
    if (env.LUMINARA_KV) {
      await env.LUMINARA_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 604800 });
    }
  } catch {
    // Non-fatal if KV put fails
  }

  return json({ ok: true, cached: false, data: result });
}
