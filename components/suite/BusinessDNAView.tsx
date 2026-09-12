import React, { useState, useEffect } from 'react';
import { BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { brandMemoryVaultService } from '../../services/memory/brandMemoryVaultService';
import { ICONS } from '../../constants';
import { useConfirm } from '../ui/ConfirmModal';
import { draftPersistenceService, DRAFT_KEYS } from '../../services/state/draftPersistenceService';
import { productTelemetry } from '../../services/analytics/productTelemetry';

interface BusinessDNAViewProps {
  currentDNA: BusinessDNA | null;
  onDNAGenerated: (dna: BusinessDNA | null) => void;
  onNavigateToTool?: () => void;
  onRouteToOracleMind?: () => void;
}

export const BusinessDNAView: React.FC<BusinessDNAViewProps> = ({ currentDNA, onDNAGenerated, onNavigateToTool, onRouteToOracleMind }) => {
  const [input, setInput] = useState(() => draftPersistenceService.getDraft(DRAFT_KEYS.BUSINESS_DNA_INPUT));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineValidationError, setInlineValidationError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<BusinessDNA | null>(currentDNA);
  const [vfsSyncSuccess, setVfsSyncSuccess] = useState<string | null>(null);

  // If the DNA is changed elsewhere (dashboard clear, another tab), reflect it here.
  useEffect(() => {
    if (!editing) setFormData(currentDNA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDNA]);

  const handleInputChange = (value: string) => {
    setInput(value);
    draftPersistenceService.setDraft(DRAFT_KEYS.BUSINESS_DNA_INPUT, value);
    if (inlineValidationError) setInlineValidationError(null);
  };

  const syncToVfs = (dna: BusinessDNA) => {
    try {
      brandMemoryVaultService.syncDna(dna);
      setVfsSyncSuccess('Synced to Brand Memory Vault + Viking VFS.');
      setTimeout(() => setVfsSyncSuccess(null), 3500);
    } catch (e) {
      console.error('VFS sync error', e);
    }
  };

  const handleExtractDNA = async () => {
    if (loading) return;
    if (!input.trim()) {
      setInlineValidationError('Please enter your website URL or a short description of your business.');
      return;
    }
    setInlineValidationError(null);
    setLoading(true);
    setError(null);
    try {
      const extracted = await geminiService.extractBusinessDNA(input);
      setFormData(extracted);
      onDNAGenerated(extracted);
      syncToVfs(extracted);
      draftPersistenceService.clearDraft(DRAFT_KEYS.BUSINESS_DNA_INPUT);
      productTelemetry.recordOnboardingStep('business_dna');
      setEditing(false);
    } catch (err: any) {
      const msg = err?.message || 'Could not build your business profile. Check your AI key in Settings.';
      setError(msg);
      productTelemetry.recordError('BusinessDNAView', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (formData) {
      onDNAGenerated(formData);
      syncToVfs(formData);
      draftPersistenceService.clearDraft(DRAFT_KEYS.BUSINESS_DNA_INPUT);
      productTelemetry.recordOnboardingStep('business_dna');
      setEditing(false);
    }
  };

  const { requestConfirm, confirmModal } = useConfirm();

  const handleClear = () => {
    requestConfirm(
      {
        title: 'Remove your business profile?',
        description: 'Luminara will stop using this profile to personalise answers and audits. You can create a new one at any time.',
        confirmLabel: 'Remove profile',
        variant: 'danger',
      },
      () => {
        onDNAGenerated(null);
        setFormData(null);
        setInput('');
        draftPersistenceService.clearDraft(DRAFT_KEYS.BUSINESS_DNA_INPUT);
      },
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      {confirmModal}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/10 border border-gold/30 mb-4">
          <ICONS.DNA className="w-4 h-4 text-gold-light" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-light">Your business</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold gold-text tracking-tight mb-3">
          My business profile
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed">
          Define your brand mission, USP, and market competitors to personalize all audits and simulations.
        </p>
      </div>

      {/* Input / Scanner Section */}
      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 sm:p-8 mb-8 shadow-2xl">
        <div className="space-y-4">
          <label htmlFor="business-dna-input" className="block text-xs font-bold uppercase tracking-widest text-gray-300">
            Scan Brand URL or Describe Business
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="business-dna-input"
              type="text"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Your website, or a sentence about your business (e.g. 'family dental clinic in Austin')"
              onKeyDown={(e) => e.key === 'Enter' && handleExtractDNA()}
              className={`flex-1 bg-black/60 border rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none transition-all shadow-inner ${
                inlineValidationError ? 'border-danger-500/70 focus:border-danger-400' : 'border-white/15 focus:border-gold'
              }`}
            />
            <button
              type="button"
              onClick={handleExtractDNA}
              disabled={loading}
              aria-busy={loading}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0 shadow-lg shadow-gold/20 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                  <span>Building your profile…</span>
                </>
              ) : (
                <>
                  <ICONS.Sparkle className="w-4 h-4" />
                  <span>Build my profile</span>
                </>
              )}
            </button>
          </div>
          {inlineValidationError && (
            <div className="flex items-center gap-1.5 text-xs text-danger-400 font-medium animate-in fade-in">
              <ICONS.AlertCircle className="w-4 h-4 shrink-0 text-danger-400" />
              <span>{inlineValidationError}</span>
            </div>
          )}
          {error && <p className="text-xs text-danger-400 mt-2">{error}</p>}
        </div>
      </div>

      {/* Active DNA Profile Display */}
      {formData && (
        <div className="glass-morphism rounded-2xl border border-gold/40 p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-success-400 shadow-sm shadow-success-500/30 animate-pulse"></div>
              <div>
                <span className="text-[10px] font-mono text-success-400 uppercase tracking-widest">Profile active</span>
                <h2 className="text-2xl font-bold text-white tracking-tight">{formData.name}</h2>
                {vfsSyncSuccess && (
                  <span className="text-[10px] font-mono text-success-400 block mt-0.5">
                    ✓ {vfsSyncSuccess}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => syncToVfs(formData)}
                className="px-3 py-1.5 rounded-lg border border-gold/40 bg-gold/10 text-xs text-gold-light hover:bg-gold/20 uppercase font-bold tracking-wider transition-all flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                title="Force sync DNA to Viking VFS .memories/"
              >
                <span>🧠</span>
                <span>Sync VFS</span>
              </button>
              <button
                type="button"
                onClick={() => setEditing(!editing)}
                className="px-4 py-1.5 rounded-lg border border-white/15 text-xs text-gray-300 hover:text-white uppercase font-bold tracking-wider transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                {editing ? 'Cancel' : 'Edit DNA'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-1.5 rounded-lg border border-danger-500/30 text-xs text-danger-300 hover:text-danger-200 uppercase font-bold tracking-wider transition-all hover:bg-danger-500/10 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gold-light mb-1">Brand Mission</label>
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
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gold-light mb-1">Unique Selling Proposition (USP)</label>
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
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gold-light mb-1">Target Audience</label>
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
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gold-light mb-1">Primary Market Competitors</label>
                <div className="flex flex-wrap gap-2 p-3 bg-black/40 rounded-xl border border-white/5">
                  {formData.competitors.map((comp, idx) => (
                    <span key={idx} className="px-2.5 py-1 rounded-lg bg-gold/10 border border-gold/30 text-[11px] font-mono text-gold-light">
                      {comp}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-warning-400 mb-1">Where you are losing</label>
                <ul className="space-y-1.5 p-3 bg-black/40 rounded-xl border border-white/5 text-xs text-gray-300">
                  {formData.perceivedGaps.map((gap, gIdx) => (
                    <li key={gIdx} className="flex items-start gap-2">
                      <span className="text-warning-400">&bull;</span>
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
                type="button"
                onClick={handleSave}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold uppercase text-xs tracking-wider focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Save Changes
              </button>
            </div>
          )}

          <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-3">
            <span className="text-[11px] text-gray-400">Brand profile active across audits, agent sessions, and intelligence models.</span>
            <div className="flex items-center gap-3">
              {onRouteToOracleMind && (
                <button
                  type="button"
                  onClick={onRouteToOracleMind}
                  className="px-3 py-1.5 rounded-lg border border-gold/40 bg-gold/15 text-xs font-bold text-gold-light hover:bg-gold/25 uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  <ICONS.Brain className="w-3.5 h-3.5 text-gold-light" />
                  <span>Fine-Tune SLM &rarr;</span>
                </button>
              )}
              {onNavigateToTool && (
                <button
                  type="button"
                  onClick={onNavigateToTool}
                  className="text-xs font-bold text-gold-light hover:underline uppercase tracking-wider flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
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
