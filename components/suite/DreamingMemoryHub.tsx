import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessDNA, BusinessMemoryItem, DreamProposal, DreamRun } from '../../types';
import { dreamingClient, type DreamStatusResult } from '../../services/dreaming/dreamingClient';
import { ICONS } from '../../constants';

interface DreamingMemoryHubProps {
  domain: string;
  dna: BusinessDNA | null;
  onNavigateToAudit?: () => void;
}

export const DreamingMemoryHub: React.FC<DreamingMemoryHubProps> = ({
  domain,
  dna,
  onNavigateToAudit,
}) => {
  const [status, setStatus] = useState<DreamStatusResult | null>(null);
  const [memories, setMemories] = useState<BusinessMemoryItem[]>([]);
  const [proposals, setProposals] = useState<DreamProposal[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isDreaming, setIsDreaming] = useState<boolean>(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');

  const targetDomain = useMemo(() => {
    if (domain) return domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (dna?.name) return dna.name.toLowerCase().replace(/\s+/g, '') + '.com';
    return 'business.local';
  }, [domain, dna]);

  const loadData = async () => {
    try {
      const [s, mems, props] = await Promise.all([
        dreamingClient.getStatus(targetDomain),
        dreamingClient.getActiveMemories(targetDomain),
        dreamingClient.getProposals(targetDomain),
      ]);
      setStatus(s);
      setMemories(mems);
      setProposals(props);
    } catch {
      /* ignore load errors */
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDomain]);

  const handleDreamNow = async (force = true) => {
    if (isDreaming) return;
    setIsDreaming(true);
    setMsg(null);
    try {
      const res = await dreamingClient.runDream(targetDomain, force, 'manual_user');
      if (res.ok) {
        if (res.woke) {
          setMsg({
            text: `Dream run complete: ${res.run?.autoAppliedCount || 0} auto-applied, ${res.run?.pendingReviewCount || 0} pending review.`,
            type: 'success',
          });
        } else {
          setMsg({
            text: `Wake Gate held: ${res.reason || 'Not enough new signal'}. Use force to override.`,
            type: 'success',
          });
        }
        await loadData();
      } else {
        setMsg({ text: res.error || 'Dream run failed.', type: 'error' });
      }
    } catch (err: any) {
      setMsg({ text: err?.message || 'Dream run failed.', type: 'error' });
    } finally {
      setIsDreaming(false);
    }
  };

  const handleReview = async (proposalId: string, action: 'approve' | 'reject') => {
    try {
      const contentToSubmit = editingProposalId === proposalId ? editedContent : undefined;
      const res = await dreamingClient.reviewProposal(proposalId, action, contentToSubmit);
      if (res.ok) {
        setEditingProposalId(null);
        setMsg({
          text: `Proposal ${action === 'approve' ? 'approved and added to Business DNA' : 'rejected'}.`,
          type: 'success',
        });
        await loadData();
      } else {
        setMsg({ text: res.error || 'Review failed.', type: 'error' });
      }
    } catch (err: any) {
      setMsg({ text: err?.message || 'Review failed.', type: 'error' });
    }
  };

  const handleRollback = async (runId: string) => {
    if (!window.confirm('Roll back this Dream Run? Reverted mutations will be restored to their prior state.')) {
      return;
    }
    try {
      const res = await dreamingClient.rollbackRun(runId);
      if (res.ok) {
        setMsg({
          text: `Rollback complete: ${res.revertedCount || 0} proposal mutations reverted.`,
          type: 'success',
        });
        await loadData();
      } else {
        setMsg({ text: res.error || 'Rollback failed.', type: 'error' });
      }
    } catch (err: any) {
      setMsg({ text: err?.message || 'Rollback failed.', type: 'error' });
    }
  };

  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const filteredMemories =
    selectedCategory === 'all'
      ? memories
      : memories.filter((m) => m.memoryType === selectedCategory);

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Deck */}
      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gold/10 border border-gold/30 text-gold-light text-xs font-mono uppercase tracking-wider mb-2">
              <ICONS.DNA className="w-3.5 h-3.5" />
              <span>Hermes Dreaming Layer</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold gold-text">
              Business Memory & Reflection
            </h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1 max-w-xl">
              Consolidates audit results, recommendation outcomes, and brand positioning into durable Business DNA for {targetDomain}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleDreamNow(true)}
              disabled={isDreaming}
              className="px-4 py-2.5 rounded-xl bg-gold/20 hover:bg-gold/30 border border-gold/40 text-gold-light font-medium text-xs sm:text-sm flex items-center gap-2 transition-all shadow-lg active:scale-95 disabled:opacity-50"
            >
              <ICONS.Refresh className={`w-4 h-4 ${isDreaming ? 'animate-spin' : ''}`} />
              <span>{isDreaming ? 'Dreaming...' : 'Dream Now'}</span>
            </button>
            {onNavigateToAudit && (
              <button
                onClick={onNavigateToAudit}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs sm:text-sm transition-all"
              >
                Run Audit
              </button>
            )}
          </div>
        </div>

        {/* Wake Gate Diagnostic Bar */}
        <div className="mt-6 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 block">Wake Gate</span>
            <span
              className={`text-sm font-semibold mt-1 inline-block ${
                status?.wake?.shouldWake ? 'text-emerald-400' : 'text-gray-400'
              }`}
            >
              {status?.wake?.shouldWake ? 'Ready' : 'Idle'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 block">Signal Score</span>
            <span className="text-sm font-semibold mt-1 inline-block text-gold">
              {(status?.wake?.signalScore ?? 0).toFixed(1)} / {(status?.wake?.threshold ?? 3.0).toFixed(1)}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 block">Active Memories</span>
            <span className="text-sm font-semibold mt-1 inline-block text-white">
              {memories.length}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 block">Awaiting Review</span>
            <span
              className={`text-sm font-semibold mt-1 inline-block ${
                pendingProposals.length > 0 ? 'text-amber-400 font-bold' : 'text-gray-400'
              }`}
            >
              {pendingProposals.length}
            </span>
          </div>
        </div>

        {msg && (
          <div
            className={`mt-4 p-3 rounded-xl text-xs flex items-center justify-between border ${
              msg.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
            }`}
          >
            <span>{msg.text}</span>
            <button onClick={() => setMsg(null)} className="text-gray-400 hover:text-white ml-2">
              ×
            </button>
          </div>
        )}
      </div>

      {/* Pending Proposals Review Inbox */}
      {pendingProposals.length > 0 && (
        <div className="glass-morphism rounded-2xl border border-amber-500/40 p-6 shadow-2xl bg-amber-950/[0.08]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <h3 className="text-base sm:text-lg font-bold text-amber-300">
                Pending Review Queue ({pendingProposals.length})
              </h3>
            </div>
            <span className="text-xs text-amber-200/70 font-mono">
              Hermes Governance Gate
            </span>
          </div>
          <p className="text-xs text-gray-300 mb-4">
            High-impact mutations (positioning shifts, new competitors, deprecations) require your approval before updating live Business DNA.
          </p>

          <div className="space-y-4">
            {pendingProposals.map((prop) => {
              const isEditing = editingProposalId === prop.id;
              return (
                <div
                  key={prop.id}
                  className="p-4 rounded-xl bg-black/40 border border-amber-500/30 hover:border-amber-500/50 transition-all"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded ${
                          prop.action === 'create'
                            ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-500/30'
                            : prop.action === 'update'
                            ? 'bg-blue-900/60 text-blue-300 border border-blue-500/30'
                            : 'bg-rose-900/60 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {prop.action}
                      </span>
                      <span className="text-xs font-semibold text-gray-200">
                        {prop.title}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400">
                        [{prop.memoryType.replace('_', ' ')}]
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-gold-light bg-gold/10 px-2 py-0.5 rounded border border-gold/20">
                        Confidence: {prop.confidence >= 0.8 ? 'High' : prop.confidence >= 0.65 ? 'Medium' : 'Low'}
                      </span>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="my-3 space-y-2">
                      <textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full text-xs font-mono bg-black/80 border border-amber-400/50 rounded-lg p-2.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        rows={3}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingProposalId(null)}
                          className="px-2.5 py-1 text-xs text-gray-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleReview(prop.id, 'approve')}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium"
                        >
                          Save & Approve
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-300 my-2 leading-relaxed bg-white/[0.02] p-2.5 rounded-lg border border-white/5">
                      {prop.proposedContent}
                    </p>
                  )}

                  {prop.rationale && (
                    <p className="text-[11px] text-gray-400 italic mb-3">
                      Rationale: {prop.rationale}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Evidence:</span>
                      {prop.sourceRefs.map((ref) => (
                        <span key={ref} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                          {ref}
                        </span>
                      ))}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setEditingProposalId(prop.id);
                            setEditedContent(prop.proposedContent);
                          }}
                          className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-all"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleReview(prop.id, 'reject')}
                          className="px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/20 text-xs font-medium transition-all"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleReview(prop.id, 'approve')}
                          className="px-3 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-medium transition-all shadow"
                        >
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Memories Matrix */}
      <div className="glass-morphism rounded-2xl border border-white/10 p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-gray-100">
              Active Business Memories ({filteredMemories.length})
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Durable knowledge actively used to personalize audit prompts, action plans, and simulations.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap gap-1.5 p-1 bg-black/40 rounded-xl border border-white/10">
            {[
              { id: 'all', label: 'All' },
              { id: 'business_dna', label: 'Business DNA' },
              { id: 'visibility_profile', label: 'Visibility' },
              { id: 'action_memory', label: 'Actions' },
              { id: 'preference_memory', label: 'Preferences' },
              { id: 'evidence_memory', label: 'Evidence' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedCategory(tab.id)}
                className={`px-3 py-1 rounded-lg text-xs transition-all ${
                  selectedCategory === tab.id
                    ? 'bg-gold/20 text-gold-light border border-gold/30 font-medium'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredMemories.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-white/10 rounded-xl">
            <ICONS.DNA className="w-8 h-8 text-gray-500 mx-auto mb-2 opacity-50" />
            <p className="text-xs text-gray-400">
              No memories recorded in this category yet. Run an audit or click "Dream Now" to consolidate knowledge.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMemories.map((mem) => {
              const isExpanded = expandedMemoryId === mem.id;
              return (
                <div
                  key={mem.id}
                  className="p-4 rounded-xl bg-white/[0.02] border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-gold/10 text-gold-light border border-gold/20">
                        {mem.memoryType.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        Verified {new Date(mem.lastVerifiedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <h4 className="text-xs sm:text-sm font-semibold text-gray-100 mb-1">
                      {mem.title}
                    </h4>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      {mem.content}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5">
                    <button
                      onClick={() => setExpandedMemoryId(isExpanded ? null : mem.id)}
                      className="text-[11px] text-gold hover:text-gold-light flex items-center gap-1 font-medium transition-colors"
                    >
                      <span>{isExpanded ? 'Hide Evidence Drawer' : 'Why did Luminara remember this?'}</span>
                      <span className="text-xs">{isExpanded ? '↑' : '↓'}</span>
                    </button>

                    {isExpanded && (
                      <div className="mt-3 p-3 rounded-lg bg-black/60 border border-white/10 space-y-2 text-[11px]">
                        <div className="flex items-center justify-between text-gray-400">
                          <span>Confidence Score</span>
                          <span className="text-gold font-mono">{(mem.confidence * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center justify-between text-gray-400">
                          <span>Memory ID</span>
                          <span className="font-mono text-gray-300">{mem.id}</span>
                        </div>
                        <div className="text-gray-400">
                          <span className="block mb-1">Source Event IDs:</span>
                          <div className="flex flex-wrap gap-1">
                            {mem.sourceRefs.map((ref) => (
                              <span
                                key={ref}
                                className="font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-300 border border-white/10 text-[10px]"
                              >
                                {ref}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dream History & Rollback Log */}
      {status?.lastRun && (
        <div className="glass-morphism rounded-2xl border border-white/10 p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-gray-200">
                Latest Dream Run Audit Trail
              </h3>
              <p className="text-[11px] text-gray-400">
                Executed on {new Date(status.lastRun.createdAt).toLocaleString()} via {status.lastRun.triggerReason}
              </p>
            </div>
            {status.lastRun.rolledBackAt ? (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-500/30">
                Rolled back on {new Date(status.lastRun.rolledBackAt).toLocaleDateString()}
              </span>
            ) : (
              <button
                onClick={() => status.lastRun && handleRollback(status.lastRun.id)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-rose-950/40 text-gray-400 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 text-xs transition-all font-mono"
              >
                Roll Back Run
              </button>
            )}
          </div>
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-gray-300 leading-relaxed">
            <span className="text-gold font-medium">Summary: </span>
            {status.lastRun.summary}
          </div>
        </div>
      )}
    </div>
  );
};
