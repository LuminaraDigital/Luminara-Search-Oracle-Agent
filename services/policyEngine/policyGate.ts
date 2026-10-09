/**
 * Luminara Policy Engine: Gate & Execution Verifier
 *
 * Enforces bounded loss, PII sanitization, and Google Search Essentials compliance
 * before invoking models, crawlers, or smart contract settlements.
 */

import { sanitizePii } from '../trust/piiSanitizer';
import { validateSchemaJsonLd, schemaSafetyScore } from '../deployment/schemaSafetyGate';
import type { PolicyBindingContext, PolicyGateDecision } from './policyTypes';

export const DEFAULT_MAX_BOUND_UNITS = 10;

/**
 * Runs a context payload through the Luminara Policy Engine.
 */
export function evaluatePolicyGate(ctx: PolicyBindingContext): PolicyGateDecision {
  const now = Date.now();

  // 1. Binding Stage
  if (!ctx.accountId || !ctx.accountId.trim()) {
    return {
      allowed: false,
      stageFailed: 'binding',
      reason: 'Missing required accountId binding',
      maxBoundUnits: 0,
      timestamp: now,
    };
  }

  // 2. Budget & Limits Stage (Bounded Loss)
  const estimatedCost = ctx.estimatedCostUnits ?? 1;
  const maxAuth = ctx.maxAuthorizedUnits ?? DEFAULT_MAX_BOUND_UNITS;

  if (estimatedCost > maxAuth) {
    return {
      allowed: false,
      stageFailed: 'budget',
      reason: `Estimated compute cost (${estimatedCost} units) exceeds authorized ceiling (${maxAuth} units)`,
      maxBoundUnits: maxAuth,
      timestamp: now,
    };
  }

  // 3. PII & Secret Sanitization Stage
  let sanitizedInput = ctx.untrustedInput;
  if (ctx.untrustedInput) {
    const sanitization = sanitizePii(ctx.untrustedInput);
    sanitizedInput = sanitization.sanitized;
  }

  // 4. Search Engine Integrity & Schema Stage
  let schemaSafety: number | undefined;
  let schemaIssues: string[] | undefined;

  if (ctx.rawSchemaJsonLd) {
    const schemaValidation = validateSchemaJsonLd(ctx.rawSchemaJsonLd);
    schemaSafety = schemaSafetyScore(schemaValidation);
    schemaIssues = schemaValidation.issues.map((i) => `${i.code}: ${i.message}`);

    if (!schemaValidation.okToDeploy) {
      return {
        allowed: false,
        stageFailed: 'search_integrity',
        reason: `Schema validation failed Google Search Essentials integrity check: ${schemaIssues.join('; ')}`,
        sanitizedInput,
        schemaSafetyScore: schemaSafety,
        schemaIssues,
        maxBoundUnits: maxAuth,
        timestamp: now,
      };
    }
  }

  // 5. Execution Allowed
  return {
    allowed: true,
    sanitizedInput,
    schemaSafetyScore: schemaSafety,
    schemaIssues,
    maxBoundUnits: maxAuth,
    timestamp: now,
  };
}
