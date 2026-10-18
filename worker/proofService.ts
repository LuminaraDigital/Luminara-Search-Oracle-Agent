/**
 * Audit Proof & Citation Service for Luminara Suite.
 *
 * Implements the Verifiable Citation Oracle (Phase 1).
 * Computes canonical evidence hashes, records tamper-evident rows in D1 proof_anchors,
 * asks the TON CitationRegistry client for an anchor (which sends nothing and answers
 * `ok: false` while the Worker holds no signer, so every proof is recorded off-chain),
 * and serves public verification and embed badges.
 */

import type { Env } from './env';
import { resolveChainNetwork, tonExplorerTxUrl } from './chainNetwork';
import { recordProofAnchorBestEffort, type ProofAnchorInput } from './proofAnchors';
import { anchorAuditCitation, type CitationPayload } from './chain/ton/citationRegistry';
import { safePublicHostname } from './security';
import { escapeHtml } from './marketingShell';
import { json, secretEquals, sha256Hex } from './workerUtils';

export interface CanonicalAuditFinding {
  id: string;
  severity: string;
  title: string;
}

export interface CanonicalEvidencePayload {
  domain: string;
  healthScore: number;
  citationRatePercent: number;
  findingsCount: number;
  timestamp: number;
  findingsFingerprint: string;
}

export interface AnchorAuditInput {
  domain: string;
  healthScore: number;
  citationRatePercent: number;
  findings?: CanonicalAuditFinding[];
  findingsFingerprint?: string;
  timestamp?: number;
  evidenceHash?: string;
  actorId?: string;
}

/**
 * Generates the deterministic findings fingerprint (sorted id:severity:title).
 */
export function buildFindingsFingerprint(findings: CanonicalAuditFinding[] = []): string {
  if (!findings || findings.length === 0) return '';
  return findings
    .map((f) => `${String(f?.id || '').trim()}:${String(f?.severity || '').trim()}:${String(f?.title || '').trim()}`)
    .sort()
    .join(';');
}

/**
 * Computes the canonical SHA-256 evidence hash.
 * Tamper-evident: altering even one character changes the resulting digest.
 */
export async function computeCanonicalEvidenceHash(payload: CanonicalEvidencePayload): Promise<string> {
  const canonicalJson = JSON.stringify({
    citationRate: Math.max(0, Math.min(100, Math.round(payload.citationRatePercent))),
    domain: payload.domain.toLowerCase().trim(),
    findingsCount: Math.max(0, Math.round(payload.findingsCount)),
    findingsFingerprint: payload.findingsFingerprint,
    score: Math.max(0, Math.min(100, Math.round(payload.healthScore))),
    timestamp: payload.timestamp,
  });
  return sha256Hex(canonicalJson);
}

/**
 * Records an audit citation proof anchor in D1 and dispatches to TON if enabled.
 */
export async function recordAuditProof(
  env: Env,
  input: AnchorAuditInput,
  fetcher: typeof fetch = fetch,
): Promise<{
  ok: boolean;
  evidenceHash: string;
  anchorId: string;
  status: 'anchored' | 'pending' | 'failed' | 'off_chain';
  txHash?: string | null;
  explorerUrl?: string | null;
  network?: string;
  chain?: string;
  auditRunId?: string;
  error?: string;
}> {
  const cleanDomain = safePublicHostname(input.domain);
  if (!cleanDomain) {
    return { ok: false, evidenceHash: '', anchorId: '', status: 'failed', error: 'Invalid domain' };
  }
  // The route hands the request body straight in: check every field read below.
  const percent = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
  if (
    !percent(input.healthScore) ||
    !percent(input.citationRatePercent) ||
    (input.timestamp !== undefined && !Number.isFinite(input.timestamp)) ||
    (input.findings !== undefined && !Array.isArray(input.findings)) ||
    (input.findingsFingerprint !== undefined && typeof input.findingsFingerprint !== 'string') ||
    (input.evidenceHash !== undefined && typeof input.evidenceHash !== 'string')
  ) {
    return { ok: false, evidenceHash: '', anchorId: '', status: 'failed', error: 'healthScore and citationRatePercent must be numbers from 0 to 100; findings an array; findingsFingerprint and evidenceHash strings' };
  }

  const timestamp = input.timestamp || Date.now();
  const findingsFingerprint = input.findingsFingerprint ?? buildFindingsFingerprint(input.findings || []);
  const findingsCount = input.findings ? input.findings.length : (input.findingsFingerprint ? input.findingsFingerprint.split(';').length : 0);

  const payload: CanonicalEvidencePayload = {
    domain: cleanDomain,
    healthScore: input.healthScore,
    citationRatePercent: input.citationRatePercent,
    findingsCount,
    timestamp,
    findingsFingerprint,
  };

  const computedHash = await computeCanonicalEvidenceHash(payload);
  if (input.evidenceHash && !secretEquals(input.evidenceHash.toLowerCase().trim(), computedHash)) {
    return { ok: false, evidenceHash: computedHash, anchorId: '', status: 'failed', error: 'Provided evidenceHash does not match computed digest' };
  }

  // Always minted here: a caller-chosen id could shadow another proof in domain + auditRunId lookups.
  const auditRunId = `audit_${Date.now().toString(36)}_${crypto.randomUUID()}`;
  const network = resolveChainNetwork(env) || 'unknown';
  const anchorId = `pa_ton_${computedHash.slice(0, 32)}`;

  // Store in KV as fast off-chain fallback
  if (env.LUMINARA_KV) {
    const kvRecord = {
      digestHex: computedHash,
      domain: cleanDomain,
      auditRunId,
      healthScore: input.healthScore,
      citationRatePercent: input.citationRatePercent,
      findingsCount,
      timestamp,
      verifiedAt: Date.now(),
      ownerId: input.actorId || 'anon',
    };
    await env.LUMINARA_KV.put(`poa:${computedHash}`, JSON.stringify(kvRecord), { expirationTtl: 31536000 });
  }

  // Attempt TON on-chain anchoring
  const citationPayload: CitationPayload = {
    domain: cleanDomain,
    auditRunId,
    evidenceHash: computedHash,
    healthScore: input.healthScore,
    citationRatePercent: input.citationRatePercent,
    findingsCount,
  };

  const anchorResult = await anchorAuditCitation(env, citationPayload, fetcher);

  const status = anchorResult.ok ? 'anchored' : 'pending';
  const txHash = anchorResult.txHash || null;
  const explorerUrl = anchorResult.explorerUrl || (txHash && network !== 'unknown' ? tonExplorerTxUrl(network as any, txHash) : null);

  const anchorRecord: ProofAnchorInput = {
    id: anchorId,
    kind: 'audit_citation',
    auditRunId,
    domain: cleanDomain,
    evidenceHash: computedHash,
    chain: 'ton',
    network: network as any,
    contract: anchorResult.contract || null,
    txHash,
    explorerUrl,
    status,
    error: anchorResult.error || null,
  };

  await recordProofAnchorBestEffort(env, anchorRecord);

  return {
    ok: true,
    evidenceHash: computedHash,
    anchorId,
    auditRunId,
    status: anchorResult.ok ? 'anchored' : 'off_chain',
    txHash,
    explorerUrl,
    network,
    chain: 'ton',
  };
}

/** Said of an audit citation row that an older build stored as anchored. */
export const AUDIT_NEVER_ANCHORED_DISCLOSURE = 'Recorded off-chain. Not anchored on TON.';

/**
 * Verifies an audit proof by evidence hash or domain + auditRunId.
 */
export async function verifyAuditProof(
  env: Env,
  query: { evidenceHash?: string; domain?: string; auditRunId?: string },
): Promise<{
  ok: boolean;
  verified: boolean;
  evidenceHash: string;
  domain: string;
  source: 'on_chain' | 'off_chain_digest';
  chain?: string;
  network?: string;
  txHash?: string | null;
  explorerUrl?: string | null;
  record?: Record<string, unknown>;
  disclosure: string;
}> {
  const hash = query.evidenceHash ? query.evidenceHash.toLowerCase().trim() : '';

  // 1. Try D1 proof_anchors
  if (env.DB) {
    try {
      let row: any = null;
      if (hash) {
        row = await env.DB.prepare(
          'SELECT * FROM proof_anchors WHERE evidence_hash = ? ORDER BY created_at DESC LIMIT 1',
        )
          .bind(hash)
          .first();
      } else if (query.domain && query.auditRunId) {
        row = await env.DB.prepare(
          'SELECT * FROM proof_anchors WHERE domain = ? AND audit_run_id = ? ORDER BY created_at DESC LIMIT 1',
        )
          .bind(safePublicHostname(query.domain) || query.domain, query.auditRunId)
          .first();
      }

      if (row) {
        // An audit citation has never been anchored: the Worker has never held a signer.
        // A row of that kind stored as "anchored" was written by the old registry client
        // from an unsigned post or a hash it computed itself, so it is reported as the
        // off-chain record it is, and its stored hash and explorer link are not handed out.
        // Every other kind (payment anchors carry a transaction hash read from the chain)
        // is reported as before.
        const isAuditCitation = row.kind === 'audit_citation';
        const claimsAnchor = Boolean(row.tx_hash || row.status === 'anchored');
        const isOnChain = !isAuditCitation && Boolean(row.tx_hash && row.status === 'anchored');
        const neverAnchored = isAuditCitation && claimsAnchor;
        return {
          ok: true,
          verified: true,
          evidenceHash: row.evidence_hash || hash,
          domain: row.domain || query.domain || '',
          source: isOnChain ? 'on_chain' : 'off_chain_digest',
          chain: row.chain,
          network: row.network,
          txHash: isAuditCitation ? null : row.tx_hash,
          explorerUrl: isAuditCitation ? null : row.explorer_url,
          // The stored row, as the current writer would have stored it: no hash, not anchored.
          record: neverAnchored ? { ...row, status: 'pending', tx_hash: null, explorer_url: null, anchored_at: null } : row,
          disclosure: isOnChain
            ? `Anchored on TON ${row.network}. Verifiable on-chain.`
            : neverAnchored
              ? AUDIT_NEVER_ANCHORED_DISCLOSURE
              : 'Recorded by Luminara. Self-reported, off-chain digest.',
        };
      }
    } catch (err) {
      console.warn(`[Proof] D1 query failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2. Fall back to KV poa:${hash}
  if (hash && env.LUMINARA_KV) {
    const raw = await env.LUMINARA_KV.get(`poa:${hash}`, 'json');
    if (raw) {
      // The route is public: the owner's account id stays private.
      const { ownerId: _ownerId, ...rec } = raw as Record<string, unknown>;
      return {
        ok: true,
        verified: true,
        evidenceHash: hash,
        domain: String(rec.domain || ''),
        source: 'off_chain_digest',
        record: rec,
        disclosure: 'Recorded by Luminara. Self-reported, off-chain digest.',
      };
    }
  }

  return {
    ok: false,
    verified: false,
    evidenceHash: hash,
    domain: query.domain || '',
    source: 'off_chain_digest',
    disclosure: 'Proof not found or unverified.',
  };
}

/**
 * Generates badge metadata and embed HTML for a stored audit proof. Only the evidence hash
 * is read from the caller: score, network and link come from the stored record, so a badge
 * cannot be forged for a proof that was never recorded. Without `env` nothing can be read,
 * so every badge is 404.
 */
export async function generateBadgeResponse(input: { evidenceHash?: unknown }, env?: Env): Promise<Response> {
  const hash = typeof input?.evidenceHash === 'string' ? input.evidenceHash.toLowerCase().trim() : '';
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return json({ ok: false, error: 'evidenceHash must be a 64-character hex SHA-256 digest' }, 400);
  }
  const proof = env ? await verifyAuditProof(env, { evidenceHash: hash }) : null;
  if (!proof?.ok) return json({ ok: false, error: 'Proof not found' }, 404);

  // D1 rows carry no score; the KV record written by recordAuditProof does.
  const stored = env?.LUMINARA_KV ? ((await env.LUMINARA_KV.get(`poa:${hash}`, 'json')) as Record<string, unknown> | null) : null;
  const score = typeof stored?.healthScore === 'number' && Number.isFinite(stored.healthScore) ? Math.round(stored.healthScore) : null;
  const scoreColor = score === null ? '#64748b' : score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const label = proof.source === 'on_chain' ? `TON ${proof.network || 'unknown'}` : 'Self-reported digest';
  let explorerUrl: string | null = null;
  try {
    if (proof.explorerUrl && new URL(proof.explorerUrl).protocol === 'https:') explorerUrl = proof.explorerUrl;
  } catch {
    explorerUrl = null;
  }
  const href = explorerUrl || `https://luminarasuite.com/verify/${hash}`;

  const embedHtml = `<!-- Luminara Proof Badge -->
<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:#0f172a;color:#f8fafc;border-radius:8px;font-family:sans-serif;font-size:12px;text-decoration:none;border:1px solid #334155;">
  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${scoreColor};"></span>
  <span>AEO Health: <strong>${score === null ? 'not measured' : `${score}/100`}</strong></span>
  <span style="color:#64748b;">| ${escapeHtml(label)}</span>
</a>`;

  return json({
    ok: true,
    badge: {
      domain: proof.domain,
      evidenceHash: hash,
      healthScore: score,
      scoreColor,
      source: proof.source,
      network: proof.network || 'unknown',
      explorerUrl,
      embedHtml,
    },
  });
}
