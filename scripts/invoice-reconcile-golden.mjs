#!/usr/bin/env node
/**
 * Golden invoice reconcile checks (no network).
 * Exit 0 when classifyInvoiceDelta matches the expected status table.
 */
import { createRequire } from 'node:module';

// Inline the pure classifier so the script runs without a TS build step.
const RECONCILE_FAIL_DELTA_CENTS = 50;
const RECONCILE_WARN_DELTA_CENTS = 10;

function classifyInvoiceDelta(internalCents, invoiceCents) {
  const deltaCents = Math.abs(Math.floor(internalCents) - Math.floor(invoiceCents));
  if (deltaCents > RECONCILE_FAIL_DELTA_CENTS) {
    return { deltaCents, status: 'reconciliation_required' };
  }
  if (deltaCents > RECONCILE_WARN_DELTA_CENTS) {
    return { deltaCents, status: 'warn' };
  }
  return { deltaCents, status: 'ok' };
}

const cases = [
  { internal: 1000, invoice: 1000, expect: 'ok' },
  { internal: 1000, invoice: 1005, expect: 'ok' },
  { internal: 1000, invoice: 1015, expect: 'warn' },
  { internal: 1000, invoice: 1060, expect: 'reconciliation_required' },
  { internal: 500, invoice: 449, expect: 'reconciliation_required' },
];

let failed = 0;
for (const c of cases) {
  const got = classifyInvoiceDelta(c.internal, c.invoice);
  const pass = got.status === c.expect;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} internal=${c.internal} invoice=${c.invoice} → ${got.status} (delta ${got.deltaCents}) expect ${c.expect}`,
  );
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`[invoice-reconcile-golden] ${failed} case(s) failed`);
  process.exit(1);
}
console.log('[invoice-reconcile-golden] OK');
void createRequire;
