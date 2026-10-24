/**
 * Public OIDC discovery for Workload Identity Federation.
 * 404 unless a public JWK and an https issuer are configured.
 * A JWK that carries a private field is refused and never written to the response.
 */
import type { DataPlaneEnv } from './dataPlaneDocs';

const PRIVATE_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

export type PublicJwk = { kty: 'RSA'; n: string; e: string; kid: string; alg: 'RS256'; use: 'sig' };

export function publicJwkFromEnv(raw: string | undefined): PublicJwk | 'private' | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const jwk = parsed;
  for (const field of PRIVATE_FIELDS) {
    const value = jwk[field];
    if (typeof value === 'string' && value) return 'private';
  }
  if (jwk.kty !== 'RSA') return null;
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string' || typeof jwk.kid !== 'string') return null;
  if (!jwk.n || !jwk.e || !jwk.kid) return null;
  return { kty: 'RSA', n: jwk.n, e: jwk.e, kid: jwk.kid, alg: 'RS256', use: 'sig' };
}

export function oidcIssuer(env: DataPlaneEnv): string | null {
  const raw = (env.GCP_OIDC_ISSUER ?? '').trim();
  if (!raw.startsWith('https://')) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/$/, '');
  return `${url.origin}${path}`;
}

export function handleGcpOidcRoute(request: Request, env: DataPlaneEnv, path: string): Response | null {
  const discovery = path === '/gcp-oidc/.well-known/openid-configuration';
  const jwks = path === '/gcp-oidc/jwks';
  if (!discovery && !jwks) return null;
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const issuer = oidcIssuer(env);
  const jwk = publicJwkFromEnv(env.GCP_OIDC_PUBLIC_JWK);
  if (jwk === 'private') {
    console.warn(JSON.stringify({ event: 'oidc_jwks_refused', reason: 'private_field' }));
    return json({ ok: false, error: 'OIDC issuer is not configured' }, 404);
  }
  if (!issuer || !jwk) return json({ ok: false, error: 'OIDC issuer is not configured' }, 404);
  const headers = { 'cache-control': 'public, max-age=300', 'content-type': 'application/json; charset=utf-8' };
  if (jwks) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers });
  return new Response(JSON.stringify({
    issuer,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  }), { status: 200, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
