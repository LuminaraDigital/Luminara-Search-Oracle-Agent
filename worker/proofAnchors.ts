/**
 * proof_anchors writers for payment + future audit attestations (migration 0017).
 */
import type { Env } from './env';
import type { ChainNetwork } from './chainNetwork';

export type ProofAnchorInput = {
  id?: string;
  kind: 'ton_payment' | 'audit_citation' | 'xdc_recheck';
  auditRunId?: string | null;
  orderId?: string | null;
  domain?: string | null;
  evidenceHash?: string | null;
  chain: 'ton' | 'xdc';
  network: ChainNetwork | 'legacy' | 'unknown';
  contract?: string | null;
  txHash?: string | null;
  seqno?: number | null;
  explorerUrl?: string | null;
  status?: 'pending' | 'anchored' | 'failed' | 'superseded';
  error?: string | null;
  anchoredAt?: string | null;
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function stablePaymentAnchorId(txHash: string): string {
  const safe = String(txHash || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `pa_ton_${safe || newId('anon')}`;
}

/** Best-effort insert; never throws into payment settlement. Idempotent for ton_payment tx hashes. */
export async function recordProofAnchorBestEffort(env: Pick<Env, 'DB'>, input: ProofAnchorInput): Promise<boolean> {
  const db = env.DB;
  if (!db) return false;
  const id =
    input.id ||
    (input.kind === 'ton_payment' && input.txHash ? stablePaymentAnchorId(input.txHash) : newId('pa'));
  const createdAt = new Date().toISOString();
  const status = input.status || 'anchored';
  const anchoredAt = input.anchoredAt ?? (status === 'anchored' ? createdAt : null);
  try {
    await db
      .prepare(
        `INSERT INTO proof_anchors (
           id, kind, audit_run_id, order_id, domain, evidence_hash,
           chain, network, contract, tx_hash, seqno, explorer_url,
           status, error, created_at, anchored_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           seqno = COALESCE(excluded.seqno, proof_anchors.seqno),
           explorer_url = COALESCE(excluded.explorer_url, proof_anchors.explorer_url),
           network = excluded.network,
           status = excluded.status,
           anchored_at = COALESCE(excluded.anchored_at, proof_anchors.anchored_at)`,
      )
      .bind(
        id,
        input.kind,
        input.auditRunId ?? null,
        input.orderId ?? null,
        input.domain ?? null,
        input.evidenceHash ?? null,
        input.chain,
        input.network,
        input.contract ?? null,
        input.txHash ?? null,
        input.seqno ?? null,
        input.explorerUrl ?? null,
        status,
        input.error ?? null,
        createdAt,
        anchoredAt,
      )
      .run();
    return true;
  } catch (err) {
    console.error(
      `[Proof] recordProofAnchorBestEffort failed: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

/** One-shot backfill from ton_credited_tx for rows not yet in proof_anchors. */
export async function backfillTonPaymentAnchors(
  env: Pick<Env, 'DB' | 'CHAIN_NETWORK'>,
  network: ChainNetwork | 'legacy' = 'legacy',
): Promise<{ inserted: number; skipped: boolean }> {
  const db = env.DB;
  if (!db) return { inserted: 0, skipped: true };
  try {
    const existing = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM ton_credited_tx t
         WHERE NOT EXISTS (
           SELECT 1 FROM proof_anchors p WHERE p.tx_hash = t.tx_hash AND p.kind = 'ton_payment'
         )`,
      )
      .first<{ n: number }>();
    const pending = Number(existing?.n || 0);
    if (pending === 0) return { inserted: 0, skipped: false };

    const rows = await db
      .prepare(
        `SELECT tx_hash, order_id, account_id, credited_at FROM ton_credited_tx t
         WHERE NOT EXISTS (
           SELECT 1 FROM proof_anchors p WHERE p.tx_hash = t.tx_hash AND p.kind = 'ton_payment'
         )`,
      )
      .all<{ tx_hash: string; order_id: string; account_id: string | null; credited_at: number }>();

    let inserted = 0;
    for (const row of rows.results || []) {
      const ok = await recordProofAnchorBestEffort(env, {
        kind: 'ton_payment',
        orderId: row.order_id,
        chain: 'ton',
        network,
        txHash: row.tx_hash,
        seqno: null,
        status: 'anchored',
        anchoredAt: new Date(Number(row.credited_at) || Date.now()).toISOString(),
      });
      if (ok) inserted += 1;
    }
    return { inserted, skipped: false };
  } catch (err) {
    console.error(`[Proof] backfillTonPaymentAnchors failed: ${err instanceof Error ? err.message : err}`);
    return { inserted: 0, skipped: true };
  }
}
