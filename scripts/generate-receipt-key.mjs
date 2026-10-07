#!/usr/bin/env node
/**
 * Generates an Ed25519 key pair for Trust Receipts (Trust Network TN0-3).
 *
 *   npm run keys:receipt
 *
 * Prints the PRIVATE JWK (store with `wrangler secret put RECEIPT_SIGNING_KEY`,
 * never commit it) and the PUBLIC JWK (safe to share; append it to
 * RECEIPT_RETIRED_PUBLIC_KEYS when rotating so old receipts keep verifying).
 * Nothing is written to disk.
 */
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const priv = await subtle.exportKey('jwk', pair.privateKey);
const pub = await subtle.exportKey('jwk', pair.publicKey);
const digest = await subtle.digest('SHA-256', new TextEncoder().encode(`luminara-receipt-key:${pub.x}`));
const kid = Buffer.from(digest).toString('hex').slice(0, 16);

process.stdout.write(
  [
    `kid: ${kid}`,
    '',
    'PRIVATE (secret, do not commit). Paste into: npx wrangler secret put RECEIPT_SIGNING_KEY [--env staging|production]',
    JSON.stringify({ kty: priv.kty, crv: priv.crv, d: priv.d, x: priv.x }),
    '',
    'PUBLIC (shareable). Keep for RECEIPT_RETIRED_PUBLIC_KEYS when you rotate:',
    JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x }),
    '',
  ].join('\n'),
);
