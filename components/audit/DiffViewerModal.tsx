import React, { useState, useEffect } from 'react';
import { ICONS } from '../../constants';
import { RemediationPayload } from '../../services/deployment/cmsDeploymentService';

interface DiffViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  unifiedDiff?: string;
  remediationPayload?: RemediationPayload;
  onDeployClick?: () => void;
}

export const DiffViewerModal: React.FC<DiffViewerModalProps> = ({
  isOpen,
  onClose,
  unifiedDiff,
  remediationPayload,
  onDeployClick,
}) => {
  const [activeTab, setActiveTab] = useState<'diff' | 'raw_schema'>('diff');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const diffText = unifiedDiff || (remediationPayload
    ? `--- a/index.html (Existing Schema: None)\n+++ b/index.html (Remediated AEO Entity Graph)\n@@ -1 +1 @@\n+ <script type="application/ld+json">\n+ ${remediationPayload.schemaJsonLd}\n+ </script>`
    : '// No remediation diff available for this audit.');

  const handleCopy = () => {
    const textToCopy = activeTab === 'diff' ? diffText : (remediationPayload?.schemaJsonLd || diffText);
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = diffText.split('\n');

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative my-auto w-full max-w-4xl glass-morphism rounded-2xl border border-gold/40 shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] overflow-hidden bg-black/95">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gold/10 text-gold-light">
              <ICONS.Terminal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                AEO Remediation Diff & Entity Patch
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-success-500/20 text-success-300 border border-success-500/30">
                  Ready to Deploy
                </span>
              </h3>
              <p className="text-xs text-gray-400">
                {remediationPayload?.domain || 'Target Website'} &bull; Structured Schema.org Graph
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg glass-morphism border border-white/10 hover:border-gold/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all"
            >
              {copied ? (
                <>
                  <ICONS.Check className="w-3.5 h-3.5 text-success-400" />
                  <span className="text-success-400">Copied!</span>
                </>
              ) : (
                <>
                  <ICONS.Copy className="w-3.5 h-3.5 text-gold" />
                  <span>Copy</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <ICONS.X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* View Tabs & Metadata Bar */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-black/40 border-b border-white/5 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('diff')}
              className={`px-3 py-1 rounded-md font-mono text-[11px] font-bold uppercase tracking-wider transition-all ${
                activeTab === 'diff'
                  ? 'bg-gold text-black shadow-md shadow-gold/20'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Unified Git Diff
            </button>
            <button
              onClick={() => setActiveTab('raw_schema')}
              className={`px-3 py-1 rounded-md font-mono text-[11px] font-bold uppercase tracking-wider transition-all ${
                activeTab === 'raw_schema'
                  ? 'bg-gold text-black shadow-md shadow-gold/20'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Raw JSON-LD Schema
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-[11px] text-gray-400 font-mono">
            <span className="flex items-center gap-1 text-success-400">
              <span className="w-2 h-2 rounded-full bg-success-400"></span> Injected Entity Graph
            </span>
            <span className="flex items-center gap-1 text-danger-400">
              <span className="w-2 h-2 rounded-full bg-danger-400"></span> Obsolete / Missing Markup
            </span>
          </div>
        </div>

        {/* Code View Area */}
        <div className="flex-1 p-4 overflow-y-auto font-mono text-xs leading-relaxed bg-surface-1">
          {activeTab === 'diff' ? (
            <div className="space-y-0.5 select-text">
              {lines.map((line, idx) => {
                const isAdd = line.startsWith('+');
                const isSub = line.startsWith('-');
                const isHeader = line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@');

                let lineClass = 'text-gray-400 py-0.5 px-2';
                if (isHeader) lineClass = 'text-cyan-400 font-bold bg-cyan-950/20 py-1 px-2 border-y border-cyan-900/40';
                else if (isAdd) lineClass = 'text-success-300 bg-success-950/30 py-0.5 px-2 rounded-sm border-l-2 border-success-500';
                else if (isSub) lineClass = 'text-danger-300 bg-danger-950/30 py-0.5 px-2 rounded-sm border-l-2 border-danger-500';

                return (
                  <div key={idx} className={`flex items-start gap-3 ${lineClass}`}>
                    <span className="w-8 text-right text-gray-600 select-none text-[10px] shrink-0 pt-0.5">
                      {idx + 1}
                    </span>
                    <span className="break-all whitespace-pre-wrap">{line}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <pre className="text-success-300 p-2 overflow-x-auto whitespace-pre-wrap select-text">
              <code>{remediationPayload?.schemaJsonLd || diffText}</code>
            </pre>
          )}
        </div>

        {/* Action Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-white/10 bg-black/70">
          <div className="text-xs text-gray-400 flex items-center gap-2">
            <ICONS.CheckCircle className="w-4 h-4 text-success-400 shrink-0" />
            <span>Remediates zero-click AI overview gap and binds strategic entity properties.</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl glass-morphism border border-white/10 text-xs font-bold text-gray-300 hover:text-white uppercase tracking-wider transition-colors w-full sm:w-auto"
            >
              Close
            </button>
            {onDeployClick && (
              <button
                onClick={() => {
                  onClose();
                  onDeployClick();
                }}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gold/20 flex items-center justify-center gap-2 w-full sm:w-auto"
              >
                <ICONS.Zap className="w-4 h-4" />
                <span>1-Click Deploy to CMS</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
