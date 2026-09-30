/**
 * Run-scoped circuit for hosted provider authentication failures.
 * The first 401/403 opens the circuit for the rest of that Instant Audit run
 * so sibling Firecrawl / search calls are not hammered.
 * Firebase token refresh in workerFetchWithAuthRetry is unchanged: this circuit
 * is consulted around that helper, not inside it.
 * Jina Reader (r.jina.ai) is a public non-hosted fallback and does not trip this circuit.
 */

import { classifyProviderFailure } from './failureClassification';
import {
  createAdaptiveCircuit,
  isCircuitAvailable,
  observeCircuit,
  type AdaptiveCircuit,
} from './adaptiveCircuit';

const AUTH_SKIP_BODY = {
  error: 'Hosted provider skipped after an authentication failure. Add your own key in Settings or sign in.',
  code: 'HOSTED_AUTH_CIRCUIT',
};

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

export function hostedAuthCircuitResponse(): Response {
  noteHostedAuthSkip();
  return new Response(JSON.stringify(AUTH_SKIP_BODY), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'x-hosted-auth-circuit': 'open',
    },
  });
}
