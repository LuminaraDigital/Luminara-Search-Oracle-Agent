#!/usr/bin/env node
/**
 * Make the Worker's OIDC signing key pair for Workload Identity (docs/adr/0001-firebase-gcp-data-plane.md).
 * The private PKCS#8 PEM goes to stdout so it can be piped straight into `wrangler secret put` and never
 * touches disk. The public JWK (no private fields) goes to stderr for the GCP_OIDC_PUBLIC_JWK secret.
 *
 *   node scripts/gcp-oidc-keypair.mjs prod-1 | npx wrangler secret put GCP_OIDC_SIGNING_KEY --env production
 */
import { generateKeyPairSync } from 'node:crypto';

const kid = process.argv[2];
if (!kid) {
  console.error('Usage: node scripts/gcp-oidc-keypair.mjs <key-id>   (for example prod-1)');
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { kty, n, e } = publicKey.export({ format: 'jwk' });
process.stdout.write(privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.error(`GCP_OIDC_KEY_ID=${kid}`);
console.error(`GCP_OIDC_PUBLIC_JWK=${JSON.stringify({ kty, n, e, kid, alg: 'RS256', use: 'sig' })}`);
