/**
 * Run-scoped circuit for hosted provider authentication failures.
 * The first 401/403 opens the circuit for the rest of that Instant Audit run
 * so sibling Firecrawl / search calls are not hammered.
 * Firebase token refresh in workerFetchWithAuthRetry is unchanged: this circuit
 * is consulted around that helper, not inside it.
 * Jina Reader (r.jina.ai) is a public non-hosted fallback and does not trip this circuit.
 */

import { hostedAuthRecoveryHint } from '../audit/hostedScoutRail';
import { classifyProviderFailure } from './failureClassification';
import {
  createAdaptiveCircuit,
  isCircuitAvailable,
  observeCircuit,
  type AdaptiveCircuit,
} from './adaptiveCircuit';

/** User-facing body when a later hosted call is skipped after the first 401/403. */
export function hostedAuthSkipError(signedIn: boolean): string {
  return `Hosted provider skipped after an authentication failure. ${hostedAuthRecoveryHint({ signedIn })}`;
}

let circuit: AdaptiveCircuit = createAdaptiveCircuit();
let skipCount = 0;

export function resetHostedAuthCircuit(): void {
  circuit = createAdaptiveCircuit();
  skipCount = 0;
}

export function hostedAuthBlocked(): boolean {
  return !isCircuitAvailable(circuit);
}

export function hostedAuthSkipCount(): number {
  return skipCount;
}

/** 403 codes the Worker uses for a refusal that is not a sign-in failure, so the circuit stays closed. */
const NOT_SIGN_IN_403_CODES = new Set(['AUDIT_RUN_REJECTED', 'EMAIL_UNVERIFIED']);

/**
 * A 403 that is not a sign-in failure: the audit run host check (a site mismatch), or an email
 * sign-up that has not confirmed its address yet (it must keep working once the link is clicked).
 */
export async function isNotSignInRefusal(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const body = await res.clone().json() as { code?: unknown };
    return typeof body?.code === 'string' && NOT_SIGN_IN_403_CODES.has(body.code);
  } catch {
    return false;
  }
}

/** Record a non-retryable 401/403 or quota_exhausted / credit 429. The first one opens the circuit for this run. */
export function noteHostedAuthFailure(statusCode: number, providerId: string, message?: string): void {
  const failure = classifyProviderFailure({
    providerId,
    statusCode,
    message: message || `HTTP ${statusCode}`,
  });
  if (failure.retryable) return;
  if (
    failure.type !== 'authentication_error' &&
    failure.type !== 'permission_error' &&
    failure.type !== 'quota_exhausted'
  ) return;
  circuit = observeCircuit(circuit, 'failure', {
    failureThreshold: 1,
    cooldownMs: 10 * 60_000,
    reason: failure.type,
  });
}

export function noteHostedAuthSkip(): void {
  skipCount += 1;
}

export function hostedAuthCircuitResponse(signedIn = false): Response {
  noteHostedAuthSkip();
  return new Response(JSON.stringify({
    error: hostedAuthSkipError(signedIn),
    code: 'HOSTED_AUTH_CIRCUIT',
  }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'x-hosted-auth-circuit': 'open',
    },
  });
}
