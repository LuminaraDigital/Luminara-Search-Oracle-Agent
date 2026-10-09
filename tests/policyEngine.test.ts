import { describe, it, expect } from 'vitest';
import { evaluatePolicyGate } from '../services/policyEngine/policyGate';
import type { PolicyBindingContext } from '../services/policyEngine/policyTypes';

describe('Luminara Policy Engine', () => {
  it('blocks requests missing accountId binding', () => {
    const ctx: PolicyBindingContext = {
      accountId: '',
      action: 'instant_audit',
    };
    const decision = evaluatePolicyGate(ctx);
    expect(decision.allowed).toBe(false);
    expect(decision.stageFailed).toBe('binding');
    expect(decision.reason).toContain('Missing required accountId');
  });

  it('enforces bounded loss when estimated cost exceeds authorization ceiling', () => {
    const ctx: PolicyBindingContext = {
      accountId: 'acc_123',
      action: 'multi_agent_crawl',
      estimatedCostUnits: 15,
      maxAuthorizedUnits: 5,
    };
    const decision = evaluatePolicyGate(ctx);
    expect(decision.allowed).toBe(false);
    expect(decision.stageFailed).toBe('budget');
    expect(decision.reason).toContain('exceeds authorized ceiling');
  });

  it('redacts sensitive PII and API keys from untrusted input before execution', () => {
    const testKey = 'sk-1234567890123456789012'; // dummy placeholder key
    const ctx: PolicyBindingContext = {
      accountId: 'acc_123',
      action: 'oracle_chat',
      untrustedInput: `Here is my dummy secret ${testKey} and email admin@mycompany.com`,
    };
    const decision = evaluatePolicyGate(ctx);
    expect(decision.allowed).toBe(true);
    expect(decision.sanitizedInput).not.toContain(testKey); // dummy testKey redacted
    expect(decision.sanitizedInput).toContain('[REDACTED_API_KEY]');
    expect(decision.sanitizedInput).not.toContain('admin@mycompany.com');
    expect(decision.sanitizedInput).toContain('[REDACTED_EMAIL]');
  });

  it('blocks invalid or malicious Schema.org markup', () => {
    const ctx: PolicyBindingContext = {
      accountId: 'acc_123',
      action: 'schema_patch',
      rawSchemaJsonLd: '{ invalid json schema',
    };
    const decision = evaluatePolicyGate(ctx);
    expect(decision.allowed).toBe(false);
    expect(decision.stageFailed).toBe('search_integrity');
    expect(decision.reason).toContain('Schema validation failed');
  });

  it('approves compliant requests and computes safety score', () => {
    const validSchema = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Luminara Digital',
      url: 'https://luminarasuite.com',
    });

    const ctx: PolicyBindingContext = {
      accountId: 'acc_123',
      action: 'instant_audit',
      targetDomain: 'luminarasuite.com',
      rawSchemaJsonLd: validSchema,
      estimatedCostUnits: 1,
      maxAuthorizedUnits: 10,
    };
    const decision = evaluatePolicyGate(ctx);
    expect(decision.allowed).toBe(true);
    expect(decision.schemaSafetyScore).toBe(100);
    expect(decision.maxBoundUnits).toBe(10);
  });
});
