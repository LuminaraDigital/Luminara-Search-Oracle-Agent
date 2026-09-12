import type { Env } from './env';
import { MAX_SMALL_BODY_BYTES, readBody, safePublicHostname } from './security';
import { identify, json, secretEquals, sha256Hex } from './workerUtils';

/**
 * Handles GET & POST /api/agent/attest
 * Blockchain Proof-of-Audit attestation verification & storage.
 */
export async function handleAgentAttestation(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const digest = url.searchParams.get('digest');
    if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) {
      return json({ error: 'digest query parameter required (64-char hex)' }, 400);
    }
    const record = env.LUMINARA_KV ? await env.LUMINARA_KV.get(`poa:${digest.toLowerCase()}`, 'json') : null;
    if (!record) return json({ ok: false, error: 'Attestation not found' }, 404);
    return json({ ok: true, attestation: record });
  }

  if (request.method === 'POST') {
    const who = await identify(request, env);
    if (!who.user) return json({ error: who.error || 'Sign in required' }, 401);

    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ error: read.error }, read.status);
    const body = read.value as Record<string, unknown>;
    const digestHex = typeof body.digestHex === 'string' ? body.digestHex.trim().toLowerCase() : '';
    const domainRaw = typeof body.domain === 'string' ? body.domain : '';
    const findingsFingerprint = typeof body.findingsFingerprint === 'string' ? body.findingsFingerprint : '';
    const healthScore = Number(body.healthScore);
    const citationRatePercent = Number(body.citationRatePercent);
    const timestamp = Number(body.timestamp);
    const findingsCount = Number(body.findingsCount);

    if (!/^[a-f0-9]{64}$/.test(digestHex)) {
      return json({ error: 'Invalid digestHex' }, 400);
    }
    const cleanDomain = safePublicHostname(domainRaw);
    if (!cleanDomain) return json({ error: 'Invalid domain' }, 400);
    if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100) {
      return json({ error: 'Invalid healthScore' }, 400);
    }
    if (!Number.isFinite(citationRatePercent) || citationRatePercent < 0 || citationRatePercent > 100) {
      return json({ error: 'Invalid citationRatePercent' }, 400);
    }
    if (!Number.isFinite(timestamp) || timestamp < 1_600_000_000_000 || timestamp > Date.now() + 86_400_000) {
      return json({ error: 'Invalid timestamp' }, 400);
    }
    if (!Number.isFinite(findingsCount) || findingsCount < 0 || findingsCount > 10_000) {
      return json({ error: 'Invalid findingsCount' }, 400);
    }
    if (typeof body.findingsFingerprint !== 'string' || findingsFingerprint.length > 8_000) {
      return json({ error: 'findingsFingerprint required' }, 400);
    }
    if (findingsCount === 0 && findingsFingerprint.length > 0) {
      return json({ error: 'findingsFingerprint must be empty when findingsCount is 0' }, 400);
    }
    if (findingsCount > 0 && !findingsFingerprint) {
      return json({ error: 'findingsFingerprint required' }, 400);
    }

    const canonicalPayload = JSON.stringify({
      domain: cleanDomain,
      score: healthScore,
      citationRate: citationRatePercent,
      findingsCount,
      timestamp,
      findingsFingerprint,
    });
    const expectedDigest = await sha256Hex(canonicalPayload);
    if (!secretEquals(expectedDigest, digestHex)) {
      return json({ error: 'Digest does not match attestation payload' }, 400);
    }

    const attestation = {
      digestHex,
      domain: cleanDomain,
      healthScore,
      citationRatePercent,
      timestamp,
      tonMemo:
        typeof body.tonMemo === 'string'
          ? body.tonMemo.slice(0, 512)
          : `LUM:POA:${cleanDomain}:${healthScore}:${digestHex.slice(0, 16)}`,
      verifiedAt: Date.now(),
      ownerId: who.user.id,
    };
    if (env.LUMINARA_KV) {
      await env.LUMINARA_KV.put(`poa:${digestHex}`, JSON.stringify(attestation), { expirationTtl: 31536000 });
    }
    return json({ ok: true, digestHex });
  }

  return json({ error: 'Method not allowed' }, 405);
}
