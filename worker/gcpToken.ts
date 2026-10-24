/**
 * Keyless GCP access tokens.
 * The Worker signs an OIDC JWT with its own RSA key (not a Google service account key),
 * exchanges it at STS, then impersonates suite-worker for a short-lived Firestore token.
 * Provisioning (pools, providers, IAM) stays an operator checklist in ADR 0001.
 */
import type { DataPlaneEnv } from './dataPlaneDocs';

export type GcpTokenProvider = {
  getAccessToken(now?: number): Promise<string>;
};

export class StubGcpTokenProvider implements GcpTokenProvider {
  private readonly token: string;

  constructor(token = 'test-access-token') {
    this.token = token;
  }

  async getAccessToken(): Promise<string> {
    return this.token;
  }
}

export type WorkloadIdentityConfig = {
  audience: string;
  issuer: string;
  subject: string;
  keyId: string;
  privateKeyPem: string;
  serviceAccountEmail: string;
};

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const JWT_TTL_SEC = 10 * 60;
const STS_URL = 'https://sts.googleapis.com/v1/token';
const DATASTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

export function readWorkloadIdentityConfig(env: DataPlaneEnv): WorkloadIdentityConfig | null {
  const audience = env.GCP_WIF_AUDIENCE?.trim() ?? '';
  const issuer = env.GCP_OIDC_ISSUER?.trim() ?? '';
  const subject = env.GCP_OIDC_SUBJECT?.trim() ?? '';
  const keyId = env.GCP_OIDC_KEY_ID?.trim() ?? '';
  const privateKeyPem = env.GCP_OIDC_SIGNING_KEY?.trim() ?? '';
  const serviceAccountEmail = env.GCP_IMPERSONATE_SERVICE_ACCOUNT?.trim() ?? '';
  if (!audience || !issuer || !subject || !keyId || !privateKeyPem || !serviceAccountEmail) return null;
  return { audience, issuer, subject, keyId, privateKeyPem, serviceAccountEmail };
}

export function tokenProviderFromEnv(env: DataPlaneEnv, fetchImpl: typeof fetch): GcpTokenProvider | null {
  const config = readWorkloadIdentityConfig(env);
  if (!config) return null;
  return new WorkloadIdentityTokenProvider(config, fetchImpl);
}

type CachedToken = { token: string; expiresAtMs: number };

export class WorkloadIdentityTokenProvider implements GcpTokenProvider {
  private cached: CachedToken | null = null;
  private readonly config: WorkloadIdentityConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: WorkloadIdentityConfig, fetchImpl: typeof fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async getAccessToken(now = Date.now()): Promise<string> {
    if (this.cached && now < this.cached.expiresAtMs - REFRESH_SKEW_MS) return this.cached.token;
    const exchanged = await exchangeForAccessToken(this.config, this.fetchImpl, now);
    if (!exchanged.ok) {
      const failed = exchanged.steps.find((step) => !step.ok);
      throw new Error(failed?.error ?? 'token exchange failed');
    }
    this.cached = { token: exchanged.token, expiresAtMs: exchanged.expiresAtMs };
    return exchanged.token;
  }
}

export type WifChainStepName = 'sign' | 'sts' | 'impersonate';

export type WifChainStep = {
  step: WifChainStepName;
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type WorkloadIdentityExchange =
  | { ok: true; token: string; expiresAtMs: number; steps: WifChainStep[] }
  | { ok: false; steps: WifChainStep[] };

/** Fresh sign, STS exchange, and impersonation. The token stays out of `steps`. */
export async function exchangeForAccessToken(
  config: WorkloadIdentityConfig,
  fetchImpl: typeof fetch,
  now = Date.now(),
): Promise<WorkloadIdentityExchange> {
  const steps: WifChainStep[] = [];
  const signStarted = Date.now();
  let subjectToken: string;
  try {
    subjectToken = await signOidcJwt(config, Math.floor(now / 1000));
  } catch {
    steps.push(chainStep('sign', signStarted, 'sign failed'));
    return { ok: false, steps };
  }
  steps.push(chainStep('sign', signStarted));

  const stsStarted = Date.now();
  let federated: string;
  try {
    federated = await stsExchange(fetchImpl, config.audience, subjectToken);
  } catch (err) {
    steps.push(chainStep('sts', stsStarted, safeChainError(err)));
    return { ok: false, steps };
  }
  steps.push(chainStep('sts', stsStarted));

  const iamStarted = Date.now();
  try {
    const impersonated = await impersonate(fetchImpl, config.serviceAccountEmail, federated);
    steps.push(chainStep('impersonate', iamStarted));
    return { ok: true, token: impersonated.token, expiresAtMs: impersonated.expiresAtMs, steps };
  } catch (err) {
    steps.push(chainStep('impersonate', iamStarted, safeChainError(err)));
    return { ok: false, steps };
  }
}

function chainStep(step: WifChainStepName, started: number, error?: string): WifChainStep {
  const row: WifChainStep = { step, ok: !error, latencyMs: Math.max(0, Date.now() - started) };
  if (error) row.error = error;
  return row;
}

function safeChainError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'request failed';
  if (message.length > 80 || /bearer|eyJ|private key|-----/i.test(message)) return 'request failed';
  return message;
}

async function signOidcJwt(config: WorkloadIdentityConfig, iatSec: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', kid: config.keyId };
  const payload = {
    iss: config.issuer,
    sub: config.subject,
    aud: config.audience,
    iat: iatSec,
    exp: iatSec + JWT_TTL_SEC,
  };
  const unsigned = `${base64UrlBytes(jsonBytes(header))}.${base64UrlBytes(jsonBytes(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`;
}

async function stsExchange(fetchImpl: typeof fetch, audience: string, subjectToken: string): Promise<string> {
  const response = await fetchImpl(STS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audience,
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: DATASTORE_SCOPE,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken,
    }),
  });
  if (!response.ok) throw new Error(`sts ${response.status}`);
  const body = await response.json();
  const token = tokenField(body, 'access_token') ?? tokenField(body, 'accessToken');
  if (!token) throw new Error('sts missing token');
  return token;
}

async function impersonate(fetchImpl: typeof fetch, serviceAccountEmail: string, federatedToken: string): Promise<CachedToken> {
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${federatedToken}`,
    },
    body: JSON.stringify({ scope: [DATASTORE_SCOPE], lifetime: '3600s' }),
  });
  if (!response.ok) throw new Error(`iam ${response.status}`);
  const body = await response.json();
  const token = tokenField(body, 'accessToken') ?? tokenField(body, 'access_token');
  if (!token) throw new Error('iam missing token');
  const expireTime = typeof body === 'object' && body && 'expireTime' in body ? body.expireTime : null;
  const expiresAtMs = typeof expireTime === 'string' ? Date.parse(expireTime) : Number.NaN;
  if (!Number.isFinite(expiresAtMs)) throw new Error('iam missing expiry');
  return { token, expiresAtMs };
}

function tokenField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !(key in body)) return null;
  const value = Reflect.get(body, key);
  return typeof value === 'string' && value ? value : null;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
