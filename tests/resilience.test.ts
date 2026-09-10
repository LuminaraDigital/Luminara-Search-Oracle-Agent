import { describe, it, expect } from 'vitest';
import { classifyProviderFailure } from '../services/resilience/failureClassification';
import {
  createAdaptiveCircuit,
  observeCircuit,
  isCircuitAvailable,
} from '../services/resilience/adaptiveCircuit';

describe('Resilience Engine - Failure Classification', () => {
  it('classifies 401 and 403 as unretryable authentication/permission errors', () => {
    const res401 = classifyProviderFailure({
      providerId: 'groq',
      statusCode: 401,
      message: 'Invalid API Key provided',
    });
    expect(res401.type).toBe('authentication_error');
    expect(res401.retryable).toBe(false);

    const res403 = classifyProviderFailure({
      providerId: 'nim',
      statusCode: 403,
      message: 'Forbidden permission denied',
    });
    expect(res403.type).toBe('permission_error');
    expect(res403.retryable).toBe(false);
  });

  it('differentiates 429 transient rate limits from quota exhaustion', () => {
    const rateLimit = classifyProviderFailure({
      providerId: 'groq',
      statusCode: 429,
      message: 'Rate limit reached. Please wait 10s',
      retryAfter: 10,
    });
    expect(rateLimit.type).toBe('rate_limit');
    expect(rateLimit.retryable).toBe(true);

    const quotaExhausted = classifyProviderFailure({
      providerId: 'openrouter',
      statusCode: 429,
      message: 'User credit balance is $0.00. Insufficient balance',
    });
    expect(quotaExhausted.type).toBe('quota_exhausted');
    expect(quotaExhausted.retryable).toBe(false);
  });

  it('classifies 5xx, timeouts, and network failures as retryable', () => {
    const timeout = classifyProviderFailure({
      providerId: 'ollama',
      message: 'fetch failed: ETIMEDOUT connection timed out',
    });
    expect(timeout.type).toBe('timeout');
    expect(timeout.retryable).toBe(true);

    const server500 = classifyProviderFailure({
      providerId: 'nim',
      statusCode: 502,
      message: 'Bad Gateway',
    });
    expect(server500.type).toBe('provider_5xx');
    expect(server500.retryable).toBe(true);
  });
});

describe('Resilience Engine - 3-State Adaptive Circuit Breaker', () => {
  it('transitions from closed to open when failureThreshold is reached', () => {
    let circuit = createAdaptiveCircuit();
    expect(circuit.state).toBe('closed');
    expect(isCircuitAvailable(circuit)).toBe(true);

    const baseTime = new Date('2026-09-10T12:00:00Z');
    // Fail 1
    circuit = observeCircuit(circuit, 'failure', { now: baseTime, failureThreshold: 3 });
    expect(circuit.state).toBe('closed');
    expect(circuit.failureCount).toBe(1);

    // Fail 2
    circuit = observeCircuit(circuit, 'failure', { now: baseTime, failureThreshold: 3 });
    expect(circuit.state).toBe('closed');

    // Fail 3 -> Trips to Open
    circuit = observeCircuit(circuit, 'failure', { now: baseTime, failureThreshold: 3, cooldownMs: 30_000 });
    expect(circuit.state).toBe('open');
    expect(circuit.nextProbeAt).toBe(new Date('2026-09-10T12:00:30Z').toISOString());
    expect(isCircuitAvailable(circuit, baseTime)).toBe(false);
  });

  it('transitions from open to half-open when probe cooldown expires and closes on success', () => {
    const baseTime = new Date('2026-09-10T12:00:00Z');
    let circuit = createAdaptiveCircuit();
    // Force open
    circuit = observeCircuit(circuit, 'failure', { now: baseTime, failureThreshold: 1, cooldownMs: 10_000 });
    expect(circuit.state).toBe('open');

    // Time before cooldown expires: still not available
    const beforeProbe = new Date('2026-09-10T12:00:05Z');
    expect(isCircuitAvailable(circuit, beforeProbe)).toBe(false);

    // Time after cooldown expires: becomes available for probe
    const afterCooldown = new Date('2026-09-10T12:00:11Z');
    expect(isCircuitAvailable(circuit, afterCooldown)).toBe(true);

    // Probe event
    circuit = observeCircuit(circuit, 'probe', { now: afterCooldown });
    expect(circuit.state).toBe('half_open');

    // Probe succeeds -> Closed
    circuit = observeCircuit(circuit, 'success', { now: afterCooldown });
    expect(circuit.state).toBe('closed');
    expect(circuit.failureCount).toBe(0);
  });
});
