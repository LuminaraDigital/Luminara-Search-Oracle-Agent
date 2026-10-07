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

/** Record a non-retryable 401/403. The first one opens the circuit for this run. */
export function noteHostedAuthFailure(statusCode: number, providerId: string): void {
  const failure = classifyProviderFailure({
    providerId,
    statusCode,
    message: `HTTP ${statusCode}`,
  });
  if (failure.retryable) return;
  if (failure.type !== 'authentication_error' && failure.type !== 'permission_error') return;
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
