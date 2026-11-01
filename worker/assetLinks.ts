import type { Env } from './env';

/**
 * Digital Asset Links for the Android app. The certificate fingerprints come from configuration:
 * Play App Signing holds the production key, so this file cannot ship a real value in source.
 * With none configured the route is a 404, which Android reads as an unverified link.
 */
const ANDROID_PACKAGE = 'com.luminarasuite.app';
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function handleAssetLinks(request: Request, env: Env): Response | null {
  if (new URL(request.url).pathname !== '/.well-known/assetlinks.json') return null;
  const fingerprints = String(env.ANDROID_APP_CERT_SHA256 || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => FINGERPRINT.test(value));
  if (fingerprints.length === 0) return new Response('Not found', { status: 404 });
  return new Response(
    JSON.stringify([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } },
  );
}
