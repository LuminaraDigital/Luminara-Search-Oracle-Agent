#!/usr/bin/env node
/**
 * One-shot backfill: insert proof_anchors rows for historic ton_credited_tx.
 * Usage (local sqlite not supported): run after migrate via wrangler d1 execute,
 * or call backfillTonPaymentAnchors from a staging admin/smoke path.
 *
 * Prefer Worker helper: import { backfillTonPaymentAnchors } from '../worker/proofAnchors'
 * This script documents the SQL equivalent for operators.
 */
console.log(`[backfill-proof-anchors] Prefer Worker backfillTonPaymentAnchors(env, network).`);
console.log(`[backfill-proof-anchors] Example D1 SQL (set network to testnet|mainnet|legacy):`);
console.log(`
INSERT INTO proof_anchors (
  id, kind, order_id, chain, network, tx_hash, status, created_at, anchored_at
)
SELECT
  'pa_legacy_' || replace(tx_hash, '/', '_'),
  'ton_payment',
  order_id,
  'ton',
  'legacy',
  tx_hash,
  'anchored',
  datetime(credited_at / 1000, 'unixepoch'),
  datetime(credited_at / 1000, 'unixepoch')
FROM ton_credited_tx
WHERE NOT EXISTS (
  SELECT 1 FROM proof_anchors p WHERE p.tx_hash = ton_credited_tx.tx_hash AND p.kind = 'ton_payment'
);
`);
process.exit(0);
