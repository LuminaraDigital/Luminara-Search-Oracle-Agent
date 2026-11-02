/**
 * Anamnesis + OriginTrail DKG + Context0 Verifiable Memory Vault (`worker/memoryVaultService.ts`).
 *
 * Implements:
 * 1. Canonical Knowledge Asset serialization & pairwise sorted SHA-256 Merkle trees
 *    with selective-disclosure inclusion proofs (`buildMerkleInclusionProof`, `verifyMerkleInclusionProof`).
 * 2. WebCrypto AES-256-GCM authenticated encryption (`encryptVaultBundle`, `decryptVaultBundle`)
 *    so off-chain backups (D1, R2, or IPFS) remain private and user-owned.
 * 3. TON & `proof_anchors` commitment recording + TonConnect deep-link / payload builder
 *    for user-signed on-chain memory state anchoring.
 *
 * No em dashes in copy.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { billingId, json, sha256Hex } from './workerUtils';
import { canonicalJson } from '../services/trust/receiptCrypto';
import { recordProofAnchorBestEffort } from './proofAnchors';
import { normalizeTonTxHash, resolveChainNetwork, tonExplorerTxUrl } from './chainNetwork';
import { normalizeMemoryDomain, queryTemporalTimeline } from './unifiedMemoryRouter';
import { getActiveBusinessMemories } from './dreamingService';
import { extractTonComment, readTonInboundHistory } from './tonPayment';

export interface MemoryLeafItem {
  leafType: 'fact' | 'edge' | 'business_memory' | 'finding';
  id: string;
  canonicalPayload: string;
  leafHash: string;
}

export interface MerkleProofStep {
  siblingHash: string;
  position: 'left' | 'right';
}

export interface MemoryVaultBundle {
  version: 1;
  accountId: string;
  projectId: string | null;
  domain: string | null;
  exportedAt: number;
  merkleRoot: string;
  leafCount: number;
  leaves: MemoryLeafItem[];
}

export interface EncryptedVaultEnvelope {
  ciphertextBase64: string;
  ivBase64: string;
  saltBase64: string;
  cid: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function nextMerkleLevel(level: string[]): Promise<string[]> {
  const next: string[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i];
    const right = i + 1 < level.length ? level[i + 1] : left;
    next.push(await sha256Hex(`node:${left}:${right}`));
  }
  return next;
}

/**
 * Deterministic pairwise SHA-256 Merkle root over leaf hashes.
 */
export async function computeMerkleRoot(leafHashes: string[]): Promise<string> {
  if (leafHashes.length === 0) {
    return sha256Hex('luminara:empty_merkle_tree');
  }
  let level = [...leafHashes];
  while (level.length > 1) {
    level = await nextMerkleLevel(level);
  }
  return level[0];
}

/**
 * Builds an OriginTrail DKG-style Merkle inclusion proof for a single leaf hash,
 * enabling selective disclosure of one memory fact or finding without exposing the full vault.
 */
export async function buildMerkleInclusionProof(
  leafHashes: string[],
  targetLeafHash: string,
): Promise<{ found: boolean; index: number; proof: MerkleProofStep[]; merkleRoot: string }> {
  let idx = leafHashes.indexOf(targetLeafHash);
  if (idx === -1) {
    return { found: false, index: -1, proof: [], merkleRoot: await computeMerkleRoot(leafHashes) };
  }

  const proof: MerkleProofStep[] = [];
  let level = [...leafHashes];
  const originalIndex = idx;

  while (level.length > 1) {
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1 < level.length ? idx + 1 : idx;
    proof.push({
      siblingHash: level[siblingIdx],
      position: isRightNode ? 'left' : 'right',
    });
    level = await nextMerkleLevel(level);
    idx = Math.floor(idx / 2);
  }

  return { found: true, index: originalIndex, proof, merkleRoot: level[0] };
}

/**
 * Verifies a Merkle inclusion proof against an anchored `merkleRoot`.
 */
export async function verifyMerkleInclusionProof(
  leafHash: string,
  proof: MerkleProofStep[],
  expectedMerkleRoot: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(leafHash) || !/^[a-f0-9]{64}$/i.test(expectedMerkleRoot)) {
    return false;
  }
  let current = leafHash.toLowerCase();
  for (const step of proof) {
    if (!/^[a-f0-9]{64}$/i.test(step.siblingHash)) return false;
    const sib = step.siblingHash.toLowerCase();
    current =
      step.position === 'left'
        ? await sha256Hex(`node:${sib}:${current}`)
        : await sha256Hex(`node:${current}:${sib}`);
  }
  return current === expectedMerkleRoot.toLowerCase();
}

async function deriveAesGcmKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Anamnesis pattern: encrypts a canonical memory bundle using AES-256-GCM with a user-supplied secret
 * and returns a content-addressed `cid` (`bafk_<sha256>`).
 */
export async function encryptVaultBundle(
  plaintextJson: string,
  passphrase: string,
): Promise<EncryptedVaultEnvelope> {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const key = await deriveAesGcmKey(passphrase, salt);
  const encoded = new TextEncoder().encode(plaintextJson);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded,
  );
  const ciphertextBase64 = bytesToBase64(new Uint8Array(cipherBuf));
  const ivBase64 = bytesToBase64(iv);
  const saltBase64 = bytesToBase64(salt);
  const digest = await sha256Hex(`${saltBase64}.${ivBase64}.${ciphertextBase64}`);

  return {
    ciphertextBase64,
    ivBase64,
    saltBase64,
    cid: `bafk_${digest.slice(0, 48)}`,
  };
}

/**
 * Decrypts and verifies an AES-256-GCM encrypted memory vault envelope.
 */
export async function decryptVaultBundle(
  envelope: Pick<EncryptedVaultEnvelope, 'ciphertextBase64' | 'ivBase64' | 'saltBase64'>,
  passphrase: string,
): Promise<string> {
  const salt = base64ToBytes(envelope.saltBase64);
  const iv = base64ToBytes(envelope.ivBase64);
  const ciphertext = base64ToBytes(envelope.ciphertextBase64);
  const key = await deriveAesGcmKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );
  return new TextDecoder().decode(plainBuf);
}

/**
 * Collects all active memories, temporal edges, business memories, and findings into a canonical
 * Merkle-rooted bundle.
 */
export async function assembleMemoryVaultBundle(
  env: Env,
  opts: { accountId: string; projectId?: string | null; domain?: string | null },
): Promise<MemoryVaultBundle> {
  const projectId = opts.projectId?.trim() || null;
  const domain = normalizeMemoryDomain(opts.domain);
  const leaves: MemoryLeafItem[] = [];

  if (env.DB) {
    // 1. Active non-expired memory_facts (schema-safe fallback if 0044 is unapplied)
    let rawFactRows: Record<string, unknown>[] = [];
    try {
      const now = Date.now();
      const factClauses = [
        "account_id = ? AND (status IS NULL OR status = 'active') AND (expires_at IS NULL OR expires_at > ?)",
      ];
      const factBinds: unknown[] = [opts.accountId, now];
      if (projectId) {
        factClauses.push('project_id = ?');
        factBinds.push(projectId);
      }
      if (domain) {
        factClauses.push('LOWER(domain) = LOWER(?)');
        factBinds.push(domain);
      }
      const factRows = await env.DB.prepare(
        `SELECT id, project_id, domain, kind, text, importance, confidence, created_at
         FROM memory_facts
         WHERE ${factClauses.join(' AND ')}
         ORDER BY id ASC LIMIT 250`,
      )
        .bind(...factBinds)
        .all<Record<string, unknown>>();
      rawFactRows = factRows.results || [];
    } catch {
      try {
        const legacyRows = await env.DB.prepare(
          `SELECT id, text, created_at FROM memory_facts WHERE account_id = ? ORDER BY id ASC LIMIT 250`,
        )
          .bind(opts.accountId)
          .all<Record<string, unknown>>();
        rawFactRows = legacyRows.results || [];
      } catch {
        rawFactRows = [];
      }
    }

    for (const r of rawFactRows) {
      const id = String(r.id);
      const canonicalPayload = canonicalJson({
        leafType: 'fact',
        id,
        projectId: r.project_id ?? null,
        domain: r.domain ?? null,
        kind: r.kind ?? 'fact',
        text: r.text,
        importance: Number(r.importance ?? 0.5),
        confidence: Number(r.confidence ?? 0.8),
        createdAt: Number(r.created_at),
      });
      const leafHash = await sha256Hex(`leaf:${canonicalPayload}`);
      leaves.push({ leafType: 'fact', id, canonicalPayload, leafHash });
    }

    // 2. Active temporal knowledge graph edges
    const edges = await queryTemporalTimeline(env, {
      accountId: opts.accountId,
      projectId,
      domain,
      activeOnly: true,
      limit: 150,
    });
    const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
    for (const e of sortedEdges) {
      const canonicalPayload = canonicalJson({
        leafType: 'edge',
        id: e.id,
        subjectEntity: e.subjectEntity,
        predicate: e.predicate,
        objectEntity: e.objectEntity,
        validFrom: e.validFrom,
        derivation: e.derivation,
      });
      const leafHash = await sha256Hex(`leaf:${canonicalPayload}`);
      leaves.push({ leafType: 'edge', id: e.id, canonicalPayload, leafHash });
    }

    // 3. Consolidated Dreaming Business Memories
    if (domain) {
      const bmList = await getActiveBusinessMemories(env, opts.accountId, domain);
      const sortedBm = [...bmList].sort((a, b) => a.id.localeCompare(b.id));
      for (const bm of sortedBm) {
        const canonicalPayload = canonicalJson({
          leafType: 'business_memory',
          id: bm.id,
          domain: bm.domain,
          memoryType: bm.memoryType,
          title: bm.title,
          content: bm.content,
          confidence: bm.confidence,
        });
        const leafHash = await sha256Hex(`leaf:${canonicalPayload}`);
        leaves.push({ leafType: 'business_memory', id: bm.id, canonicalPayload, leafHash });
      }
    }
  }

  // Sort all leaves deterministically by (leafType, id) before computing the Merkle root
  leaves.sort((a, b) => `${a.leafType}:${a.id}`.localeCompare(`${b.leafType}:${b.id}`));
  const merkleRoot = await computeMerkleRoot(leaves.map((l) => l.leafHash));

  return {
    version: 1,
    accountId: opts.accountId,
    projectId,
    domain,
    exportedAt: Date.now(),
    merkleRoot,
    leafCount: leaves.length,
    leaves,
  };
}

function formatTonMemoryMemo(merkleRoot: string, cid: string): string {
  return `luminara:mem_v1:${merkleRoot.slice(0, 32)}:${cid.slice(0, 24)}`;
}

/**
 * Build a TonConnect transaction request payload so the user can anchor a memory snapshot's
 * Merkle root and CID on TON directly from their wallet in Telegram Mini App or Web.
 */
export function buildTonMemoryAnchorTxPayload(opts: {
  merkleRoot: string;
  cid: string;
  recipientAddress?: string | null;
  network?: 'mainnet' | 'testnet';
}): {
  validUntil: number;
  network: 'mainnet' | 'testnet';
  memo: string;
  amountNano: string;
  recipientAddress: string | null;
} {
  return {
    validUntil: Math.floor(Date.now() / 1000) + 600,
    network: opts.network || 'testnet',
    memo: formatTonMemoryMemo(opts.merkleRoot, opts.cid),
    amountNano: '10000000', // 0.01 TON nominal commitment self/registry transfer
    recipientAddress: opts.recipientAddress || null,
  };
}

async function pinEncryptedEnvelopeToIpfs(
  env: Env,
  envelope: EncryptedVaultEnvelope,
  accountId: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const pinUrl = String(env.IPFS_PINNING_URL || '').trim();
  if (!pinUrl) return null;
  try {
    const parsedUrl = new URL(pinUrl);
    if (parsedUrl.protocol !== 'https:') return null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (env.IPFS_PINNING_JWT?.trim()) {
      headers.Authorization = `Bearer ${env.IPFS_PINNING_JWT.trim()}`;
    }
    const res = await fetcher(pinUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pinataContent: envelope,
        pinataMetadata: { name: `luminara-vault-${accountId}-${envelope.cid}` },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { IpfsHash?: string; cid?: string; Hash?: string };
    const remoteCid = data.IpfsHash || data.cid || data.Hash;
    return typeof remoteCid === 'string' && remoteCid.trim() ? remoteCid.trim() : envelope.cid;
  } catch {
    return null;
  }
}

/**
 * Verifies a TON memory vault commitment transaction against Toncenter v3 / TonAPI v2.
 */
export async function verifyTonMemoryAnchorOnChain(
  env: Env,
  opts: {
    recipientAddress: string;
    expectedMemo: string;
    txHash: string;
    createdAt?: number;
    fetcher?: typeof fetch;
  },
): Promise<{
  verified: boolean;
  reason: 'verified' | 'memo_mismatch' | 'not_found' | 'unverified_offline';
  observedMemo?: string;
}> {
  const recipient = String(opts.recipientAddress || '').trim();
  if (!recipient) return { verified: false, reason: 'unverified_offline' };
  const sinceSec = Math.floor(((opts.createdAt || Date.now()) - 3600_000) / 1000);
  const history = await readTonInboundHistory(env, recipient, sinceSec, opts.fetcher || fetch);
  if (!history || (history.toncenter === null && history.tonapi === null)) {
    return { verified: false, reason: 'unverified_offline' };
  }

  const targetNorm = normalizeTonTxHash(opts.txHash);
  const allTxs = [...(history.toncenter ?? []), ...(history.tonapi ?? [])];
  // Pass 1: exact txHash match takes precedence so a mismatched memo on the named tx is never masked
  for (const tx of allTxs) {
    const rawHash =
      typeof tx?.hash === 'string'
        ? tx.hash
        : typeof tx?.transaction_id?.hash === 'string'
          ? tx.transaction_id.hash
          : '';
    const txNorm = rawHash ? normalizeTonTxHash(rawHash) : '';
    if (txNorm && (txNorm === targetNorm || rawHash === opts.txHash)) {
      const comment = extractTonComment(tx?.in_msg).trim();
      if (comment === opts.expectedMemo) {
        return { verified: true, reason: 'verified', observedMemo: comment };
      }
      return { verified: false, reason: 'memo_mismatch', observedMemo: comment };
    }
  }
  // Pass 2: fallback to memo match when index hash encoding differs
  for (const tx of allTxs) {
    const comment = extractTonComment(tx?.in_msg).trim();
    if (comment === opts.expectedMemo) {
      return { verified: true, reason: 'verified', observedMemo: comment };
    }
  }
  return { verified: false, reason: 'not_found' };
}

/**
 * Creates a verifiable memory vault snapshot, optionally encrypts it with a user passphrase
 * (Anamnesis pattern), stores the encrypted payload in IPFS/R2/D1, and records a proof anchor entry.
 */
export async function createMemoryVaultSnapshot(
  env: Env,
  opts: {
    accountId: string;
    projectId?: string | null;
    domain?: string | null;
    passphrase?: string | null;
    fetcher?: typeof fetch;
  },
): Promise<
  | {
      ok: true;
      snapshotId: string;
      merkleRoot: string;
      cid: string;
      leafCount: number;
      leafHashes: string[];
      storageBackend: 'd1' | 'r2' | 'ipfs' | 'client_only';
      encrypted: boolean;
      tonAnchorDraft: ReturnType<typeof buildTonMemoryAnchorTxPayload>;
    }
  | { ok: false; error: string }
> {
  if (!env.DB) return { ok: false, error: 'Database unavailable' };

  const bundle = await assembleMemoryVaultBundle(env, {
    accountId: opts.accountId,
    projectId: opts.projectId,
    domain: opts.domain,
  });

  const bundleJson = JSON.stringify(bundle);
  let ciphertextBase64: string | null = null;
  let ivBase64: string | null = null;
  let saltBase64: string | null = null;
  let cid: string;
  let storageBackend: 'd1' | 'r2' | 'ipfs' | 'client_only' = 'client_only';

  if (opts.passphrase && opts.passphrase.trim().length >= 8) {
    const enc = await encryptVaultBundle(bundleJson, opts.passphrase.trim());
    ciphertextBase64 = enc.ciphertextBase64;
    ivBase64 = enc.ivBase64;
    saltBase64 = enc.saltBase64;
    cid = enc.cid;
    storageBackend = 'd1';

    const ipfsCid = await pinEncryptedEnvelopeToIpfs(env, enc, opts.accountId, opts.fetcher);
    if (ipfsCid) {
      cid = ipfsCid;
      storageBackend = 'ipfs';
    } else if (env.DESKTOP_RELEASES) {
      try {
        await env.DESKTOP_RELEASES.put(
          `memory-vault/${opts.accountId}/${cid}.json`,
          JSON.stringify(enc),
          { httpMetadata: { contentType: 'application/json' } },
        );
        storageBackend = 'r2';
      } catch {
        storageBackend = 'd1';
      }
    }
  } else {
    const rawHash = await sha256Hex(bundleJson);
    cid = `bafk_${rawHash.slice(0, 48)}`;
  }

  const snapshotId = `mvault_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const network = resolveChainNetwork(env) || 'testnet';
  const anchorId = `pa_mem_${bundle.merkleRoot.slice(0, 32)}`;
  const leafHashes = bundle.leaves.map((l) => l.leafHash);

  try {
    await env.DB.prepare(
      `INSERT INTO memory_vault_snapshots (
        id, account_id, project_id, domain, merkle_root, leaf_hashes_json, leaf_count,
        ciphertext_base64, iv_base64, salt_base64, cid, storage_backend,
        anchor_id, chain, network, tx_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ton', ?, NULL, ?)`,
    )
      .bind(
        snapshotId,
        opts.accountId,
        bundle.projectId,
        bundle.domain,
        bundle.merkleRoot,
        JSON.stringify(leafHashes),
        bundle.leafCount,
        ciphertextBase64,
        ivBase64,
        saltBase64,
        cid,
        storageBackend,
        anchorId,
        network,
        Date.now(),
      )
      .run();
  } catch {
    return { ok: false, error: 'Memory vault schema migration 0044 required' };
  }

  await recordProofAnchorBestEffort(env, {
    id: anchorId,
    kind: 'memory_snapshot',
    auditRunId: snapshotId,
    domain: bundle.domain || 'account.luminara',
    evidenceHash: bundle.merkleRoot,
    chain: 'ton',
    network,
    status: 'pending',
  });

  return {
    ok: true,
    snapshotId,
    merkleRoot: bundle.merkleRoot,
    cid,
    leafCount: bundle.leafCount,
    leafHashes,
    storageBackend,
    encrypted: Boolean(ciphertextBase64),
    tonAnchorDraft: buildTonMemoryAnchorTxPayload({
      merkleRoot: bundle.merkleRoot,
      cid,
      recipientAddress: env.TON_RECEIVING_ADDRESS || null,
      network,
    }),
  };
}

/**
 * Records a user-submitted TON transaction hash against a memory vault snapshot and updates `proof_anchors`.
 */
export async function bindMemoryVaultTonTx(
  env: Env,
  opts: {
    accountId: string;
    snapshotId: string;
    txHash: string;
    verifyOnChain?: boolean;
    requireOnChain?: boolean;
    fetcher?: typeof fetch;
  },
): Promise<{
  ok: boolean;
  explorerUrl?: string | null;
  verificationStatus?: 'verified_on_chain' | 'recorded_unverified' | 'mismatch';
  error?: string;
}> {
  if (!env.DB) return { ok: false, error: 'Database unavailable' };
  const txClean = String(opts.txHash || '').trim();
  if (!/^[a-fA-F0-9_-]{32,128}$/.test(txClean)) {
    return { ok: false, error: 'Invalid transaction hash format' };
  }

  let snap: {
    id: string;
    domain: string | null;
    merkle_root: string;
    cid: string | null;
    anchor_id: string | null;
    network: string | null;
    created_at: number | null;
  } | null = null;
  try {
    snap = await env.DB.prepare(
      `SELECT id, domain, merkle_root, cid, anchor_id, network, created_at FROM memory_vault_snapshots WHERE id = ? AND account_id = ?`,
    )
      .bind(opts.snapshotId, opts.accountId)
      .first();
  } catch {
    return { ok: false, error: 'Memory vault schema migration 0044 required' };
  }

  if (!snap) return { ok: false, error: 'Snapshot not found' };

  const network = (snap.network === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
  const expectedMemo = formatTonMemoryMemo(snap.merkle_root, snap.cid || '');

  let verificationStatus: 'verified_on_chain' | 'recorded_unverified' = 'recorded_unverified';
  if (opts.verifyOnChain || opts.requireOnChain || (env.TON_RECEIVING_ADDRESS && opts.fetcher)) {
    const check = await verifyTonMemoryAnchorOnChain(env, {
      recipientAddress: env.TON_RECEIVING_ADDRESS || '',
      expectedMemo,
      txHash: txClean,
      createdAt: snap.created_at || Date.now(),
      fetcher: opts.fetcher,
    });
    if (check.reason === 'memo_mismatch') {
      return {
        ok: false,
        verificationStatus: 'mismatch',
        error: `On-chain transaction memo mismatch: expected ${expectedMemo}`,
      };
    }
    if (check.verified) {
      verificationStatus = 'verified_on_chain';
    } else if (opts.requireOnChain) {
      return {
        ok: false,
        error: `Transaction ${txClean} not yet confirmed on TON (${check.reason})`,
      };
    }
  }

  const explorerUrl = tonExplorerTxUrl(network, txClean);

  await env.DB.prepare(
    `UPDATE memory_vault_snapshots SET tx_hash = ? WHERE id = ? AND account_id = ?`,
  )
    .bind(txClean, snap.id, opts.accountId)
    .run();

  if (snap.anchor_id) {
    await recordProofAnchorBestEffort(env, {
      id: snap.anchor_id,
      kind: 'memory_snapshot',
      auditRunId: snap.id,
      domain: snap.domain || 'account.luminara',
      evidenceHash: snap.merkle_root,
      chain: 'ton',
      network,
      txHash: txClean,
      explorerUrl,
      status: 'anchored',
    });
  }

  return { ok: true, explorerUrl, verificationStatus };
}

/**
 * HTTP route handler for `/memory/vault/*` (`snapshot`, `verify-leaf`, `decrypt`, `anchor-tx`, `list`).
 */
export async function handleMemoryVaultRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  const accountId = billingId(user);

  if (path === '/memory/vault/snapshot' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as {
      projectId?: string;
      domain?: string;
      passphrase?: string;
    };
    const res = await createMemoryVaultSnapshot(env, {
      accountId,
      projectId: body.projectId,
      domain: body.domain,
      passphrase: body.passphrase,
    });
    return json(res, res.ok ? 200 : 400);
  }

  if (path === '/memory/vault/list' && request.method === 'GET') {
    if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
    try {
      const rows = await env.DB.prepare(
        `SELECT id, project_id, domain, merkle_root, leaf_count, cid, storage_backend,
                anchor_id, chain, network, tx_hash, created_at
         FROM memory_vault_snapshots
         WHERE account_id = ?
         ORDER BY created_at DESC LIMIT 25`,
      )
        .bind(accountId)
        .all<Record<string, unknown>>();
      return json({ ok: true, snapshots: rows.results || [] });
    } catch {
      return json({ ok: true, snapshots: [] });
    }
  }

  if (path === '/memory/vault/verify-leaf' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as {
      snapshotId?: string;
      leafHash?: string;
      proof?: MerkleProofStep[];
      merkleRoot?: string;
    };
    if (body.snapshotId && body.leafHash && env.DB) {
      let row: { merkle_root: string; leaf_hashes_json: string } | null = null;
      try {
        row = await env.DB.prepare(
          `SELECT merkle_root, leaf_hashes_json FROM memory_vault_snapshots WHERE id = ? AND account_id = ?`,
        )
          .bind(body.snapshotId, accountId)
          .first<{ merkle_root: string; leaf_hashes_json: string }>();
      } catch {
        return json({ ok: false, error: 'Snapshot not found' }, 404);
      }
      if (!row) return json({ ok: false, error: 'Snapshot not found' }, 404);
      const leafHashes = JSON.parse(row.leaf_hashes_json || '[]') as string[];
      const built = await buildMerkleInclusionProof(leafHashes, body.leafHash);
      const verified =
        built.found &&
        (await verifyMerkleInclusionProof(body.leafHash, built.proof, row.merkle_root));
      return json({
        ok: true,
        verified,
        merkleRoot: row.merkle_root,
        index: built.index,
        proof: built.proof,
      });
    }
    if (body.leafHash && Array.isArray(body.proof) && body.merkleRoot) {
      const verified = await verifyMerkleInclusionProof(
        body.leafHash,
        body.proof,
        body.merkleRoot,
      );
      return json({ ok: true, verified });
    }
    return json({ ok: false, error: 'Provide (snapshotId + leafHash) or (leafHash + proof + merkleRoot)' }, 400);
  }

  if (path === '/memory/vault/decrypt' && request.method === 'POST') {
    if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as {
      snapshotId?: string;
      passphrase?: string;
    };
    if (!body.snapshotId || !body.passphrase) {
      return json({ ok: false, error: 'snapshotId and passphrase are required' }, 400);
    }
    let row: {
      ciphertext_base64: string | null;
      iv_base64: string | null;
      salt_base64: string | null;
      merkle_root: string;
    } | null = null;
    try {
      row = await env.DB.prepare(
        `SELECT ciphertext_base64, iv_base64, salt_base64, merkle_root FROM memory_vault_snapshots WHERE id = ? AND account_id = ?`,
      )
        .bind(body.snapshotId, accountId)
        .first();
    } catch {
      return json({ ok: false, error: 'Encrypted snapshot not found' }, 404);
    }
    if (!row || !row.ciphertext_base64 || !row.iv_base64 || !row.salt_base64) {
      return json({ ok: false, error: 'Encrypted snapshot not found' }, 404);
    }
    try {
      const plaintext = await decryptVaultBundle(
        {
          ciphertextBase64: row.ciphertext_base64,
          ivBase64: row.iv_base64,
          saltBase64: row.salt_base64,
        },
        body.passphrase,
      );
      const parsed = JSON.parse(plaintext) as MemoryVaultBundle;
      return json({ ok: true, merkleRoot: row.merkle_root, bundle: parsed });
    } catch {
      return json({ ok: false, error: 'Decryption failed: invalid passphrase or tampered ciphertext' }, 400);
    }
  }

  if (path === '/memory/vault/anchor-tx' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    const body = (raw.value || {}) as {
      snapshotId?: string;
      txHash?: string;
      verifyOnChain?: boolean;
      requireOnChain?: boolean;
    };
    if (!body.snapshotId || !body.txHash) {
      return json({ ok: false, error: 'snapshotId and txHash are required' }, 400);
    }
    const res = await bindMemoryVaultTonTx(env, {
      accountId,
      snapshotId: body.snapshotId,
      txHash: body.txHash,
      verifyOnChain: Boolean(body.verifyOnChain),
      requireOnChain: Boolean(body.requireOnChain),
    });
    return json(res, res.ok ? 200 : 400);
  }

  return null;
}
