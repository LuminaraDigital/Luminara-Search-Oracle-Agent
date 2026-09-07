import React, { useState, useEffect } from 'react';
import { BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { vfsMemoryService } from '../../services/vfs/vfsMemoryService';
import { ICONS } from '../../constants';

interface BusinessDNAViewProps {
  currentDNA: BusinessDNA | null;
  onDNAGenerated: (dna: BusinessDNA | null) => void;
  onNavigateToTool?: () => void;
  onRouteToOracleMind?: () => void;
}

export const BusinessDNAView: React.FC<BusinessDNAViewProps> = ({ currentDNA, onDNAGenerated, onNavigateToTool, onRouteToOracleMind }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<BusinessDNA | null>(currentDNA);
  const [vfsSyncSuccess, setVfsSyncSuccess] = useState<string | null>(null);

  // If the DNA is changed elsewhere (dashboard clear, another tab), reflect it here.
  useEffect(() => {
    if (!editing) setFormData(currentDNA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDNA]);

  const syncToVfs = (dna: BusinessDNA) => {
    try {
      const res = vfsMemoryService.syncFromBusinessDNA(dna);
      setVfsSyncSuccess(`Synced to Viking VFS (${res.nodesCreated} nodes updated).`);
      setTimeout(() => setVfsSyncSuccess(null), 3500);
    } catch (e) {
      console.error('VFS sync error', e);
    }
  };

  const handleExtractDNA = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const extracted = await geminiService.extractBusinessDNA(input);
      setFormData(extracted);
      onDNAGenerated(extracted);
      syncToVfs(extracted);
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to extract Strategic DNA. Please check your API key.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (formData) {
      onDNAGenerated(formData);
      syncToVfs(formData);
      setEditing(false);
    }
  };

  const handleClear = () => {
    if (window.confirm('Clear stored Strategic Business DNA?')) {
      onDNAGenerated(null);
      setFormData(null);
      setInput('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#BF953F]/10 border border-[#BF953F]/30 mb-4">
          <ICONS.DNA className="w-4 h-4 text-[#FCF6BA]" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#FCF6BA]">Strategic Genome Sequencer</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          Strategic Business DNA
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Extract and anchor your brand’s core genome—mission, USP, target audience, and competitive gaps—to personalize all audits and simulations.
        </p>
      </div>

      {/* Input / Scanner Section */}
      <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-6 sm:p-8 mb-8 shadow-2xl">
        <div className="space-y-4">
          <label className="block text-xs font-bold uppercase tracking-widest text-gray-300">
            Scan Brand URL or Describe Business
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g., luminaradigital.io or 'Luxury AI marketing boutique in Sydney'"
              onKeyDown={(e) => e.key === 'Enter' && handleExtractDNA()}
              className="flex-1 bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-gray-600 focus:outline-none transition-all shadow-inner"
            />
            <button
              onClick={handleExtractDNA}
              disabled={loading || !input.trim()}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black font-black uppercase text-xs tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center gap-2 shrink-0 shadow-lg shadow-[#BF953F]/20"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                  <span>Sequencing...</span>
                </>
              ) : (
                <>
                  <ICONS.Sparkle className="w-4 h-4" />
                  <span>Extract Genome</span>
                </>
              )}
            </button>
          </div>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>
      </div>

      {/* Active DNA Profile Display */}
      {formData && (
        <div className="glass-morphism rounded-2xl border border-[#BF953F]/40 p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#10B981] animate-pulse"></div>
              <div>
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">Active Strategic Link</span>
                <h2 className="text-2xl font-bold text-white tracking-tight">{formData.name}</h2>
                {vfsSyncSuccess && (
                  <span className="text-[10px] font-mono text-emerald-400 block mt-0.5">
                    ✓ {vfsSyncSuccess}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => syncToVfs(formData)}
                className="px-3 py-1.5 rounded-lg border border-[#BF953F]/40 bg-[#BF953F]/10 text-xs text-[#FCF6BA] hover:bg-[#BF953F]/20 uppercase font-bold tracking-wider transition-all flex items-center gap-1.5"
                title="Force sync DNA to Viking VFS .memories/"
              >
                <span>🧠</span>
                <span>Sync VFS</span>
              </button>
              <button
                onClick={() => setEditing(!editing)}
                className="px-4 py-1.5 rounded-lg border border-white/15 text-xs text-gray-300 hover:text-white uppercase font-bold tracking-wider transition-all"
              >
                {editing ? 'Cancel' : 'Edit DNA'}
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-300 hover:text-red-200 uppercase font-bold tracking-wider transition-all hover:bg-red-500/10"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#FCF6BA] mb-1">Brand Mission</label>
                {editing ? (
                  <textarea
                    value={formData.mission}
                    onChange={(e) => setFormData({ ...formData, mission: e.target.value })}
                    className="w-full bg-black/60 border border-white/20 rounded-xl p-3 text-xs text-white"
                  />
                ) : (
                  <p className="text-xs text-gray-300 leading-relaxed bg-black/40 p-3 rounded-xl border border-white/5">{formData.mission}</p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#FCF6BA] mb-1">Unique Selling Proposition (USP)</label>
                {editing ? (
                  <textarea
                    value={formData.usp}
                    onChange={(e) => setFormData({ ...formData, usp: e.target.value })}
                    className="w-full bg-black/60 border border-white/20 rounded-xl p-3 text-xs text-white"
                  />
                ) : (
                  <p className="text-xs text-gray-300 leading-relaxed bg-black/40 p-3 rounded-xl border border-white/5 font-medium">{formData.usp}</p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#FCF6BA] mb-1">Target Audience</label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.targetAudience}
                    onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                    className="w-full bg-black/60 border border-white/20 rounded-xl p-3 text-xs text-white"
                  />
                ) : (
                  <p className="text-xs text-gray-300 bg-black/40 p-3 rounded-xl border border-white/5">{formData.targetAudience}</p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#FCF6BA] mb-1">Primary Market Competitors</label>
                <div className="flex flex-wrap gap-2 p-3 bg-black/40 rounded-xl border border-white/5">
                  {formData.competitors.map((comp, idx) => (
                    <span key={idx} className="px-2.5 py-1 rounded-lg bg-[#BF953F]/10 border border-[#BF953F]/30 text-[11px] font-mono text-[#FCF6BA]">
                      {comp}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-1">Identified Strategic Gaps</label>
                <ul className="space-y-1.5 p-3 bg-black/40 rounded-xl border border-white/5 text-xs text-gray-300">
                  {formData.perceivedGaps.map((gap, gIdx) => (
                    <li key={gIdx} className="flex items-start gap-2">
                      <span className="text-amber-400">&bull;</span>
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Context Synthesis</label>
                <p className="text-[11px] text-gray-400 italic bg-black/40 p-3 rounded-xl border border-white/5">{formData.rawContext}</p>
              </div>
            </div>
          </div>

          {editing && (
            <div className="pt-4 border-t border-white/10 flex justify-end">
              <button
                onClick={handleSave}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black font-bold uppercase text-xs tracking-wider"
              >
                Save Changes
              </button>
            </div>
          )}

          <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-3">
            <span className="text-[11px] text-gray-400">This DNA context is now automatically injected into all audits, Oracle Agent, and OracleMind SLM.</span>
            <div className="flex items-center gap-3">
              {onRouteToOracleMind && (
                <button
                  onClick={onRouteToOracleMind}
                  className="px-3 py-1.5 rounded-lg border border-[#BF953F]/40 bg-[#BF953F]/15 text-xs font-bold text-[#FCF6BA] hover:bg-[#BF953F]/25 uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <ICONS.Brain className="w-3.5 h-3.5 text-[#FCF6BA]" />
                  <span>Fine-Tune SLM &rarr;</span>
                </button>
              )}
              {onNavigateToTool && (
                <button
                  onClick={onNavigateToTool}
                  className="text-xs font-bold text-[#FCF6BA] hover:underline uppercase tracking-wider flex items-center gap-1"
                >
                  Launch Terminal with DNA &rarr;
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
