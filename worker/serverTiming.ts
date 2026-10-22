import type { FirebaseAuthTiming } from './firebaseAuth';

/** Server-Timing plus one staging log. Production responses are unchanged. */
export function withStageTiming(
  res: Response,
  environment: string | undefined,
  started: number,
  auth?: FirebaseAuthTiming,
  extra: Record<string, number> = {},
): Response {
  if (environment !== 'staging') return res;
  const verify = auth?.verifyMs ?? 0;
  const jwks = auth?.jwksMs ?? 0;
  const total = Math.max(0, performance.now() - started);
  const parts = [
    `verify;dur=${Math.round(verify)}`,
    `jwks;dur=${Math.round(jwks)}`,
    ...Object.entries(extra).map(([name, dur]) => `${name};dur=${Math.round(dur)}`),
    `total;dur=${Math.round(total)}`,
  ];
  if (auth) parts.push(`auth;desc="${auth.cache}"`);
  console.log(JSON.stringify({ event: 'worker_timing', verify, jwks, ...extra, total, cache: auth?.cache ?? 'none' }));
  const headers = new Headers(res.headers);
  headers.set('Server-Timing', parts.join(', '));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
