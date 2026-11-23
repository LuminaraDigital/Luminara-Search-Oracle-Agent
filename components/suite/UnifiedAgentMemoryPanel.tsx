import React, { useState, useEffect, useCallback } from 'react';
import {
  unifiedMemoryClient,
  type ClientMemoryFactKind,
  type ClientScopedFact,
  type ClientTemporalEdge,
  type ClientVaultSnapshotRow,
  type CreateVaultSnapshotResponse,
} from '../../services/memory/unifiedMemoryClient';
import { formatAuDate } from '../../utils/formatAuDate';

interface UnifiedAgentMemoryPanelProps {
  domain: string;
  projectId?: string | null;
  onRefreshParent?: () => void;
}

type SubView = 'facts' | 'graph' | 'vault';

const FACT_KIND_LABELS: Record<ClientMemoryFactKind, string> = {
  constraint: 'Negative Constraint',
  preference: 'Preference',
  brand_fact: 'Brand Fact',
  decision: 'Decision',
  finding_outcome: 'Finding Outcome',
  episode: 'Episode',
  fact: 'General Fact',
};

export const UnifiedAgentMemoryPanel: React.FC<UnifiedAgentMemoryPanelProps> = ({
  domain,
  projectId = null,
  onRefreshParent,
}) => {
  const [subView, setSubView] = useState<SubView>('facts');
  const [loading, setLoading] = useState<boolean>(true);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Scoped Facts state
  const [l0Abstract, setL0Abstract] = useState<string>('');
  const [strictConstraints, setStrictConstraints] = useState<string[]>([]);
  const [facts, setFacts] = useState<ClientScopedFact[]>([]);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [newFactText, setNewFactText] = useState<string>('');
  const [newFactKind, setNewFactKind] = useState<ClientMemoryFactKind>('brand_fact');
  const [supersedeTarget, setSupersedeTarget] = useState<ClientScopedFact | null>(null);
  const [submittingFact, setSubmittingFact] = useState<boolean>(false);

  // Bi-Temporal Graph state
  const [edges, setEdges] = useState<ClientTemporalEdge[]>([]);
  const [activeOnlyEdges, setActiveOnlyEdges] = useState<boolean>(false);
  const [asOfDate, setAsOfDate] = useState<string>('');
  const [subjectEntity, setSubjectEntity] = useState<string>(domain || 'brand');
  const [predicate, setPredicate] = useState<string>('competes_with');
  const [objectEntity, setObjectEntity] = useState<string>('');
  const [submittingEdge, setSubmittingEdge] = useState<boolean>(false);

  // Verifiable Vault state
  const [snapshots, setSnapshots] = useState<ClientVaultSnapshotRow[]>([]);
  const [vaultPassphrase, setVaultPassphrase] = useState<string>('');
  const [creatingSnapshot, setCreatingSnapshot] = useState<boolean>(false);
  const [lastCreatedSnapshot, setLastCreatedSnapshot] = useState<CreateVaultSnapshotResponse | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [leafHashInput, setLeafHashInput] = useState<string>('');
  const [leafVerifyResult, setLeafVerifyResult] = useState<{
    verified: boolean;
    merkleRoot?: string;
    steps?: number;
  } | null>(null);
  const [tonTxHash, setTonTxHash] = useState<string>('');
  const [verifyOnChain, setVerifyOnChain] = useState<boolean>(true);
  const [anchoringTx, setAnchoringTx] = useState<boolean>(false);
  const [verifyingLeaf, setVerifyingLeaf] = useState<boolean>(false);
  const [decrypting, setDecrypting] = useState<boolean>(false);
  const [decryptPassphrase, setDecryptPassphrase] = useState<string>('');
  const [decryptedLeavesCount, setDecryptedLeavesCount] = useState<number | null>(null);
  const [decryptedBundleJson, setDecryptedBundleJson] = useState<string | null>(null);
  const [verifiedSnapshotStatus, setVerifiedSnapshotStatus] = useState<
    Record<string, { status: 'verified_on_chain' | 'recorded_unverified'; explorerUrl?: string | null }>
  >({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const asOfTs = asOfDate ? new Date(`${asOfDate}T23:59:59Z`).getTime() : null;
      const [recalled, timeline, vaultList] = await Promise.all([
        unifiedMemoryClient.recallContext({ domain, projectId, topK: 25 }),
        unifiedMemoryClient.queryTimeline({
          domain,
          projectId,
          activeOnly: activeOnlyEdges,
          asOfTimestamp: Number.isFinite(asOfTs) ? asOfTs : null,
          limit: 50,
        }),
        unifiedMemoryClient.listVaultSnapshots(),
      ]);
      setL0Abstract(recalled.l0Abstract || '');
      setStrictConstraints(recalled.strictConstraints || []);
      setFacts(recalled.facts || []);
      setEdges(timeline || []);
      setSnapshots(vaultList || []);
      if (!selectedSnapshotId && vaultList.length > 0) {
        setSelectedSnapshotId(vaultList[0].id);
      }
    } catch {
      setStatusMsg({ text: 'Could not load unified memory state.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [domain, projectId, activeOnlyEdges, asOfDate, selectedSnapshotId]);

  useEffect(() => {
    setSubjectEntity(domain || 'brand');
    void loadAll();
  }, [domain, loadAll]);

  const handleAddOrSupersedeFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFactText.trim() || submittingFact) return;
    setSubmittingFact(true);
    setStatusMsg(null);
    try {
      const res = await unifiedMemoryClient.rememberFact({
        text: newFactText.trim(),
        domain,
        projectId,
        kind: newFactKind,
        importance: newFactKind === 'constraint' ? 0.95 : 0.8,
        confidence: 0.92,
        supersedesFactId: supersedeTarget?.id || null,
      });
      if (res.ok) {
        setNewFactText('');
        setSupersedeTarget(null);
        setStatusMsg({
          text: res.supersededFactId
            ? `Updated memory and superseded prior fact (${res.supersededFactId}).`
            : res.deduplicated
              ? 'Memory fact already recorded (SHA-256 deduplicated).'
              : 'Saved scoped memory fact.',
          type: 'success',
        });
        await loadAll();
        onRefreshParent?.();
      } else {
        setStatusMsg({ text: res.error || 'Could not store memory fact.', type: 'error' });
      }
    } finally {
      setSubmittingFact(false);
    }
  };

  const handleForgetFact = async (factId: string) => {
    setStatusMsg(null);
    const res = await unifiedMemoryClient.forgetFact(factId, 'User deleted from Brand Memory UI');
    if (res.ok) {
      setStatusMsg({ text: `Forgot memory fact ${factId}.`, type: 'success' });
      await loadAll();
      onRefreshParent?.();
    } else {
      setStatusMsg({ text: res.error || 'Could not forget fact.', type: 'error' });
    }
  };

  const handleAddEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectEntity.trim() || !predicate.trim() || !objectEntity.trim() || submittingEdge) return;
    setSubmittingEdge(true);
    setStatusMsg(null);
    try {
      const res = await unifiedMemoryClient.upsertEdge({
        domain,
        projectId,
        subjectEntity: subjectEntity.trim(),
        predicate: predicate.trim(),
        objectEntity: objectEntity.trim(),
        confidence: 0.92,
      });
      if (res.ok) {
        setObjectEntity('');
        setStatusMsg({
          text: res.supersededEdgeId
            ? `Recorded temporal relationship and closed prior edge (${res.supersededEdgeId}).`
            : 'Recorded bi-temporal relationship edge.',
          type: 'success',
        });
        await loadAll();
      } else {
        setStatusMsg({ text: res.error || 'Could not record relationship edge.', type: 'error' });
      }
    } finally {
      setSubmittingEdge(false);
    }
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingSnapshot) return;
    if (vaultPassphrase.trim().length > 0 && vaultPassphrase.trim().length < 8) {
      setStatusMsg({ text: 'Encryption passphrase must be at least 8 characters.', type: 'error' });
      return;
    }
    setCreatingSnapshot(true);
    setStatusMsg(null);
    try {
      const res = await unifiedMemoryClient.createVaultSnapshot({
        domain,
        projectId,
        passphrase: vaultPassphrase.trim() || null,
      });
      if (res.ok && res.snapshotId) {
        setLastCreatedSnapshot(res);
        setSelectedSnapshotId(res.snapshotId);
        if (res.leafHashes && res.leafHashes.length > 0) {
          setLeafHashInput(res.leafHashes[0]);
        }
        setStatusMsg({
          text: `Minted Merkle Vault Snapshot ${res.snapshotId} (${res.leafCount || 0} leaves, root ${res.merkleRoot?.slice(0, 14)}...).`,
          type: 'success',
        });
        await loadAll();
      } else {
        setStatusMsg({ text: res.error || 'Snapshot creation failed.', type: 'error' });
      }
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleVerifyLeaf = async () => {
    if (!selectedSnapshotId || !leafHashInput.trim() || verifyingLeaf) return;
    setVerifyingLeaf(true);
    setStatusMsg(null);
    try {
      const res = await unifiedMemoryClient.verifyVaultLeaf({
        snapshotId: selectedSnapshotId,
        leafHash: leafHashInput.trim(),
      });
      if (res.ok) {
        setLeafVerifyResult({
          verified: Boolean(res.verified),
          merkleRoot: res.merkleRoot,
          steps: res.proof?.length ?? 0,
        });
        setStatusMsg({
          text: res.verified
            ? 'Cryptographic Merkle inclusion proof verified against snapshot root.'
            : 'Leaf hash is not present in the selected Merkle snapshot.',
          type: res.verified ? 'success' : 'error',
        });
      } else {
        setStatusMsg({ text: res.error || 'Could not verify leaf proof.', type: 'error' });
      }
    } finally {
      setVerifyingLeaf(false);
    }
  };

  const handleAnchorTonTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSnapshotId || !tonTxHash.trim() || anchoringTx) return;
    setAnchoringTx(true);
    setStatusMsg(null);
    try {
      const res = await unifiedMemoryClient.anchorVaultTonTx({
        snapshotId: selectedSnapshotId,
        txHash: tonTxHash.trim(),
        verifyOnChain,
      });
      if (res.ok) {
        const verStatus = res.verificationStatus || 'recorded_unverified';
        setVerifiedSnapshotStatus((prev) => ({
          ...prev,
          [selectedSnapshotId]: { status: verStatus === 'verified_on_chain' ? 'verified_on_chain' : 'recorded_unverified', explorerUrl: res.explorerUrl },
        }));
        setTonTxHash('');
        setStatusMsg({
          text:
            verStatus === 'verified_on_chain'
              ? 'TON commitment transaction verified on-chain (verified_on_chain) and anchored.'
              : 'TON transaction hash recorded (recorded_unverified: on-chain index verification was skipped or pending).',
          type: 'success',
        });
        await loadAll();
      } else {
        const prefix = res.verificationStatus === 'mismatch' ? '[mismatch] ' : '';
        setStatusMsg({ text: `${prefix}${res.error || 'TON anchor verification failed.'}`, type: 'error' });
      }
    } finally {
      setAnchoringTx(false);
    }
  };

  const handleDecryptPreview = async () => {
    if (!selectedSnapshotId || !decryptPassphrase.trim() || decrypting) return;
    setDecrypting(true);
    setStatusMsg(null);
    try {
      const res = await unifiedMemoryClient.decryptVaultSnapshot(
        selectedSnapshotId,
        decryptPassphrase.trim(),
      );
      if (res.ok && res.bundle) {
        setDecryptedLeavesCount(res.bundle.leafCount);
        setDecryptedBundleJson(JSON.stringify(res.bundle, null, 2));
        setStatusMsg({
          text: `AES-256-GCM decryption verified: ${res.bundle.leafCount} canonical memory leaves recovered.`,
          type: 'success',
        });
      } else {
        setDecryptedLeavesCount(null);
        setDecryptedBundleJson(null);
        setStatusMsg({ text: res.error || 'Decryption failed: check passphrase.', type: 'error' });
      }
    } finally {
      setDecrypting(false);
    }
  };

  const handleDownloadDecryptedBundle = () => {
    if (!decryptedBundleJson || !selectedSnapshotId) return;
    const blob = new Blob([decryptedBundleJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luminara-vault-${selectedSnapshotId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredFacts =
    kindFilter === 'all' ? facts : facts.filter((f) => f.kind === kindFilter);

  return (
    <div className="space-y-5">
      {/* L0 Abstract & Sub-navigation */}
      <div className="p-4 rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-gold">
            GAM L0 Memory Abstract &amp; Scope
          </div>
          <p className="text-xs text-gray-300 font-mono tabular-nums">
            {l0Abstract || `Scope: ${domain || 'account'} | Facts: ${facts.length} | Edges: ${edges.length}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['facts', `Scoped Facts (${facts.length})`],
              ['graph', `Bi-Temporal Graph (${edges.length})`],
              ['vault', `Verifiable Vault (${snapshots.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubView(id)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                subView === id
                  ? 'bg-gold text-black'
                  : 'bg-white/5 text-gray-300 border border-white/10 hover:border-gold/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Strict Negative Constraints Banner */}
      {strictConstraints.length > 0 && (
        <div className="p-3.5 rounded-2xl border border-danger-500/40 bg-danger-500/10 space-y-1.5">
          <div className="text-[10px] font-black uppercase tracking-wider text-danger-300">
            Strict Negative Constraints (Never Bring Up in Oracle or Reports)
          </div>
          <ul className="text-xs text-gray-200 space-y-1 list-disc list-inside">
            {strictConstraints.map((c, idx) => (
              <li key={idx}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {statusMsg && (
        <div
          role="status"
          className={`p-3 rounded-xl border text-xs ${
            statusMsg.type === 'success'
              ? 'border-success-500/40 bg-success-500/10 text-success-300'
              : 'border-danger-500/40 bg-danger-500/10 text-danger-300'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* SUBVIEW 1: SCOPED FACTS & CONSTRAINTS */}
      {subView === 'facts' && (
        <div className="space-y-4">
          <form
            onSubmit={handleAddOrSupersedeFact}
            className="p-4 rounded-2xl border border-white/10 bg-black/40 space-y-3"
          >
            <div className="flex items-center justify-between">
              <label
                htmlFor="unified-fact-input"
                className="text-xs font-bold text-white"
              >
                {supersedeTarget
                  ? `Supersede Fact (${supersedeTarget.id}): "${supersedeTarget.text.slice(0, 60)}..."`
                  : 'Add Scoped Memory Fact or Negative Constraint'}
              </label>
              {supersedeTarget && (
                <button
                  type="button"
                  onClick={() => setSupersedeTarget(null)}
                  className="text-[10px] text-gray-400 underline focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  Cancel supersede
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <select
                aria-label="Memory fact kind"
                value={newFactKind}
                onChange={(e) => setNewFactKind(e.target.value as ClientMemoryFactKind)}
                className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                <option value="brand_fact">Brand Fact</option>
                <option value="constraint">Negative Constraint (Never Bring Up)</option>
                <option value="preference">Preference / Voice</option>
                <option value="decision">Strategic Decision</option>
                <option value="finding_outcome">Finding Outcome</option>
                <option value="episode">Episode</option>
                <option value="fact">General Fact</option>
              </select>
              <input
                id="unified-fact-input"
                aria-label="Scoped memory fact text"
                value={newFactText}
                onChange={(e) => setNewFactText(e.target.value)}
                placeholder={
                  newFactKind === 'constraint'
                    ? 'Never bring up competitor X or suggest keyword stuffing'
                    : 'Our CMS is Webflow and our primary ICP is B2B SaaS founders in AU'
                }
                className="sm:col-span-2 bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={submittingFact || !newFactText.trim()}
                className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-black uppercase disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                {supersedeTarget ? 'Supersede Fact' : 'Save Fact'}
              </button>
            </div>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {(
              ['all', 'constraint', 'brand_fact', 'decision', 'preference', 'finding_outcome', 'episode', 'fact'] as const
            ).map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                    kindFilter === k
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'bg-white/5 text-gray-400 border border-white/10'
                  }`}
                >
                  {k === 'all' ? 'All Kinds' : FACT_KIND_LABELS[k]}
                </button>
              ),
            )}
          </div>

          {loading ? (
            <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02] text-xs text-gray-400">
              Loading scoped facts...
            </div>
          ) : filteredFacts.length === 0 ? (
            <div className="p-6 text-center rounded-2xl border border-dashed border-white/15 bg-white/[0.01] space-y-1">
              <p className="text-xs font-bold text-white">No Scoped Facts in This View</p>
              <p className="text-[11px] text-gray-400">
                Add a brand fact, preference, or negative constraint above, or chat with Oracle to auto-extract durable memory.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredFacts.map((fact) => (
                <div
                  key={fact.id}
                  className="p-4 rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          fact.kind === 'constraint'
                            ? 'bg-danger-500/20 text-danger-300 border border-danger-500/30'
                            : 'bg-gold/15 text-gold-light border border-gold/30'
                        }`}
                      >
                        {FACT_KIND_LABELS[fact.kind] || fact.kind}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono tabular-nums">
                        {Math.round(fact.confidence * 100)}% conf · {formatAuDate(fact.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-white leading-relaxed">{fact.text}</p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[10px]">
                    <span className="text-gray-400 font-mono">
                      {fact.domain || 'account'} · {fact.id.slice(0, 12)}
                    </span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSupersedeTarget(fact);
                          setNewFactKind(fact.kind);
                          setNewFactText(fact.text);
                        }}
                        className="text-gold hover:underline font-bold uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                      >
                        Supersede
                      </button>
                      <button
                        type="button"
                        onClick={() => handleForgetFact(fact.id)}
                        className="text-danger-400 hover:text-danger-300 font-bold uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                      >
                        Forget
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW 2: BI-TEMPORAL KNOWLEDGE GRAPH (GRAPHITI) */}
      {subView === 'graph' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-white/10 bg-black/40 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold text-white">
                  Bi-Temporal Entity &amp; Relationship Graph (valid_from .. valid_to)
                </h4>
                <p className="text-[11px] text-gray-400">
                  Audit findings, weekly decisions, and chat facts automatically update temporal edges. Filter by point-in-time below.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] text-gray-300 flex items-center gap-1.5">
                  <span>As-Of Date:</span>
                  <input
                    type="date"
                    aria-label="As-Of point-in-time date filter"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                    className="bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  />
                </label>
                {asOfDate && (
                  <button
                    type="button"
                    onClick={() => setAsOfDate('')}
                    className="text-[10px] text-gold underline focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    Clear date
                  </button>
                )}
                <label className="text-[10px] text-gray-300 flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeOnlyEdges}
                    onChange={(e) => setActiveOnlyEdges(e.target.checked)}
                    className="rounded border-white/20 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  />
                  <span>Active only</span>
                </label>
              </div>
            </div>

            <form onSubmit={handleAddEdge} className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-white/10">
              <input
                aria-label="Subject entity"
                value={subjectEntity}
                onChange={(e) => setSubjectEntity(e.target.value)}
                placeholder="Subject (e.g. acme.com)"
                className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              />
              <input
                aria-label="Relationship predicate"
                value={predicate}
                onChange={(e) => setPredicate(e.target.value)}
                placeholder="Predicate (e.g. competes_with)"
                className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              />
              <input
                aria-label="Object entity"
                value={objectEntity}
                onChange={(e) => setObjectEntity(e.target.value)}
                placeholder="Object (e.g. rival.io)"
                className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={submittingEdge || !objectEntity.trim()}
                className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-black uppercase disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Upsert Edge
              </button>
            </form>
          </div>

          {loading ? (
            <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02] text-xs text-gray-400">
              Loading bi-temporal relationship graph...
            </div>
          ) : edges.length === 0 ? (
            <div className="p-6 text-center rounded-2xl border border-dashed border-white/15 bg-white/[0.01]">
              <p className="text-xs font-bold text-white">No Temporal Edges Match Filter</p>
              <p className="text-[11px] text-gray-400 mt-1">
                Upsert an entity relationship above or run an audit to populate verified domain edges.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {edges.map((edge) => (
                <div
                  key={edge.id}
                  className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                    edge.validTo === null
                      ? 'border-white/10 bg-white/[0.02]'
                      : 'border-white/5 bg-black/30 opacity-70'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-white">{edge.subjectEntity}</span>
                      <span className="px-2 py-0.5 rounded bg-gold/15 text-gold font-mono text-[10px]">
                        {edge.predicate}
                      </span>
                      <span className="font-bold text-gold-light">{edge.objectEntity}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono tabular-nums">
                      Valid from {formatAuDate(edge.validFrom)}
                      {edge.validTo ? ` to ${formatAuDate(edge.validTo)} (Superseded)` : ' · Active now'}
                      {' · '}
                      Derivation: {edge.derivation}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-black uppercase self-start sm:self-center ${
                      edge.validTo === null
                        ? 'bg-success-500/20 text-success-300 border border-success-500/30'
                        : 'bg-white/10 text-gray-400'
                    }`}
                  >
                    {edge.validTo === null ? 'Active' : 'Historical'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW 3: VERIFIABLE MEMORY VAULT & TON ANCHOR */}
      {subView === 'vault' && (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateSnapshot}
            className="p-4 rounded-2xl border border-white/10 bg-black/40 space-y-3"
          >
            <div>
              <h4 className="text-xs font-bold text-white">
                Mint Encrypted Merkle Memory Snapshot (Anamnesis + OriginTrail DKG)
              </h4>
              <p className="text-[11px] text-gray-400">
                Serializes your scoped facts, bi-temporal edges, and business memories into a canonical SHA-256 Merkle tree, encrypts with PBKDF2 + AES-256-GCM, and prepares a TON commitment memo.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                aria-label="Vault encryption passphrase"
                value={vaultPassphrase}
                onChange={(e) => setVaultPassphrase(e.target.value)}
                placeholder="Optional AES-256-GCM passphrase (min 8 chars for encrypted ciphertext)"
                className="flex-1 bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={creatingSnapshot}
                className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-black uppercase disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                {creatingSnapshot ? 'Minting...' : 'Create Vault Snapshot'}
              </button>
            </div>
          </form>

          {lastCreatedSnapshot?.ok && lastCreatedSnapshot.tonAnchorDraft && (
            <div className="p-4 rounded-2xl border border-gold/40 bg-gold/5 space-y-2 text-xs">
              <div className="text-[10px] font-black uppercase tracking-wider text-gold">
                Latest Snapshot Commitment Ready for TON
              </div>
              <div className="font-mono text-[11px] text-gray-200 break-all">
                Merkle Root: <span className="text-white">{lastCreatedSnapshot.merkleRoot}</span>
              </div>
              <div className="font-mono text-[11px] text-gray-200 break-all">
                CID ({lastCreatedSnapshot.storageBackend}): <span className="text-white">{lastCreatedSnapshot.cid}</span>
              </div>
              <div className="font-mono text-[11px] text-gold-light break-all">
                TON Memo: <code>{lastCreatedSnapshot.tonAnchorDraft.memo}</code>
              </div>
            </div>
          )}

          {loading ? (
            <div className="p-6 rounded-2xl border border-white/10 bg-white/[0.02] text-xs text-gray-400">
              Loading verifiable memory vault snapshots...
            </div>
          ) : snapshots.length === 0 ? (
            <div className="p-6 text-center rounded-2xl border border-dashed border-white/15 bg-white/[0.01] space-y-1">
              <p className="text-xs font-bold text-white">No Memory Vault Snapshots Minted Yet</p>
              <p className="text-[11px] text-gray-400">
                Create a snapshot above to compute a deterministic SHA-256 Merkle root, encrypt your memory bundle with AES-256-GCM, and generate a TON commitment memo.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Selective Disclosure Leaf Proof Verifier */}
                <div className="p-4 rounded-2xl border border-white/10 bg-white/[0.02] space-y-3">
                  <h5 className="text-xs font-bold text-white">
                    Selective-Disclosure Merkle Leaf Proof
                  </h5>
                  <select
                    aria-label="Select snapshot for proof verification"
                    value={selectedSnapshotId}
                    onChange={(e) => setSelectedSnapshotId(e.target.value)}
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white tabular-nums focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id} · {s.leaf_count} leaves · {formatAuDate(s.created_at)}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      aria-label="Leaf SHA-256 hash to verify"
                      value={leafHashInput}
                      onChange={(e) => setLeafHashInput(e.target.value)}
                      placeholder="Enter 64-char SHA-256 leaf hash"
                      className="flex-1 bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    />
                    <button
                      type="button"
                      disabled={verifyingLeaf || !leafHashInput.trim()}
                      onClick={handleVerifyLeaf}
                      className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white text-xs font-bold uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    >
                      {verifyingLeaf ? 'Verifying...' : 'Verify'}
                    </button>
                  </div>
                  {leafVerifyResult && (
                    <p className="text-[11px] font-mono tabular-nums text-gray-300">
                      Result: {leafVerifyResult.verified ? 'VALID INCLUSION PROOF' : 'NOT FOUND'} (
                      {leafVerifyResult.steps ?? 0} sibling hops)
                    </p>
                  )}

                  <div className="pt-2 border-t border-white/10 flex gap-2">
                    <input
                      type="password"
                      aria-label="Passphrase to decrypt snapshot"
                      value={decryptPassphrase}
                      onChange={(e) => setDecryptPassphrase(e.target.value)}
                      placeholder="Passphrase to test AES-256-GCM decrypt"
                      className="flex-1 bg-black/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    />
                    <button
                      type="button"
                      disabled={decrypting || !decryptPassphrase.trim()}
                      onClick={handleDecryptPreview}
                      className="px-3 py-1.5 rounded-xl border border-gold/40 text-gold text-[10px] font-black uppercase disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    >
                      {decrypting ? 'Decrypting...' : 'Decrypt'}
                    </button>
                  </div>
                  {decryptedLeavesCount !== null && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-[11px] text-success-300 font-mono tabular-nums">
                        Decrypted {decryptedLeavesCount} verified leaves.
                      </p>
                      {decryptedBundleJson && (
                        <button
                          type="button"
                          onClick={handleDownloadDecryptedBundle}
                          className="px-2.5 py-1 rounded-lg bg-gold/20 border border-gold/40 text-gold text-[10px] font-black uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                        >
                          Export Decrypted JSON
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* TON On-Chain Commitment Verifier */}
                <form
                  onSubmit={handleAnchorTonTx}
                  className="p-4 rounded-2xl border border-white/10 bg-white/[0.02] space-y-3"
                >
                  <h5 className="text-xs font-bold text-white">
                    Bind &amp; Verify TON On-Chain Commitment
                  </h5>
                  <p className="text-[11px] text-gray-400">
                    Submit the TON transaction hash carrying your snapshot memo (<code>luminara:mem_v1:...</code>).
                  </p>
                  <input
                    aria-label="TON transaction hash"
                    value={tonTxHash}
                    onChange={(e) => setTonTxHash(e.target.value)}
                    placeholder="64-character hex or base64url TON tx hash"
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  />
                  <label className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={verifyOnChain}
                      onChange={(e) => setVerifyOnChain(e.target.checked)}
                      className="rounded border-white/20 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    />
                    <span>Verify memo against Toncenter / TonAPI on-chain index</span>
                  </label>
                  <button
                    type="submit"
                    disabled={anchoringTx || !tonTxHash.trim() || !selectedSnapshotId}
                    className="w-full py-2 rounded-xl bg-gold text-black text-xs font-black uppercase disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    {anchoringTx ? 'Verifying...' : 'Bind TON Commitment'}
                  </button>
                </form>
              </div>

              {/* Snapshot History List */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold text-gold-light">Snapshot Ledger</h5>
                {snapshots.map((snap) => {
                  const localStatus = verifiedSnapshotStatus[snap.id];
                  const isVerifiedOnChain = localStatus?.status === 'verified_on_chain';
                  return (
                    <div
                      key={snap.id}
                      className="p-3 rounded-xl border border-white/10 bg-white/[0.01] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-0.5 font-mono tabular-nums">
                        <div className="text-white font-bold">
                          {snap.id} · {snap.leaf_count} leaves · [{snap.storage_backend.toUpperCase()}]
                        </div>
                        <div className="text-[10px] text-gray-400">
                          Root: {snap.merkle_root.slice(0, 24)}... · CID: {snap.cid.slice(0, 24)}...
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {snap.tx_hash ? (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                              isVerifiedOnChain
                                ? 'bg-success-500/20 text-success-300 border border-success-500/30'
                                : 'bg-gold/15 text-gold-light border border-gold/30'
                            }`}
                          >
                            {isVerifiedOnChain ? 'Verified On-Chain' : 'TON Tx Recorded'}:{' '}
                            {snap.tx_hash.slice(0, 10)}...
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-white/5 text-gray-400 text-[10px]">
                            Unanchored Draft
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
