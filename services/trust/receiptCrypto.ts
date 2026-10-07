/**
 * Trust Receipt crypto shared by the Worker (signing), the browser (offline
 * verification on /verify), and Node scripts. WebCrypto only, no dependencies.
 *
 * Signature = Ed25519 over the UTF-8 bytes of canonicalJson(payload).
 * Canonical JSON: object keys sorted by code unit, no whitespace, arrays in
 * order, undefined object members dropped. Non-finite numbers are rejected so
 * a payload can never sign differently across runtimes.
 */

export type ReceiptPublicJwk = {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
};

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256HexOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Key id = first 16 hex chars of SHA-256 over the public key's `x`. Derived, so it cannot drift from the key. */
export async function receiptKeyId(x: string): Promise<string> {
  return (await sha256HexOf(`luminara-receipt-key:${x}`)).slice(0, 16);
}

/**
 * Verifies a receipt signature with only a published public key. Returns false
 * (never throws) for malformed keys or signatures, so callers can render
 * "signature invalid" instead of crashing.
 */
export async function verifyReceiptSignature(
  publicJwk: ReceiptPublicJwk,
  payload: unknown,
  signatureB64Url: string,
): Promise<boolean> {
  try {
    if (publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519' || !publicJwk.x) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x },
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(canonicalJson(payload));
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, base64UrlToBytes(signatureB64Url), data);
  } catch {
    return false;
  }
}
