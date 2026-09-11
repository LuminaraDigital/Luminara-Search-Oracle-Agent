import React, { useEffect } from 'react';
import { NotebookCitation } from '../../types';
import { ICONS } from '../../constants';

interface CitationPopoverProps {
  citation: NotebookCitation | null;
  onClose: () => void;
  onViewSource?: (sourceId: string) => void;
}

export const CitationPopover: React.FC<CitationPopoverProps> = ({
  citation,
  onClose,
  onViewSource,
}) => {
  useEffect(() => {
    if (!citation) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [citation, onClose]);

  if (!citation) return null;

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="w-full max-w-lg my-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] flex flex-col glass-morphism rounded-2xl border border-gold/40 p-4 sm:p-6 shadow-2xl bg-black/95 overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Source Attribution"
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-gold/20 text-gold-light border border-gold/40 flex items-center justify-center text-xs font-mono font-bold">
              {citation.citationNumber}
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
              Source Attribution
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Close (Esc)"
            aria-label="Close modal"
          >
            <ICONS.Close className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-gold-light mb-1">
              Source Document
            </div>
            <div className="text-sm font-semibold text-white">
              {citation.sourceTitle}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface-1 border border-white/10">
            <div className="text-[10px] uppercase font-mono tracking-widest text-gray-400 mb-2 flex items-center gap-1.5">
              <span>Grounding Excerpt</span>
            </div>
            <blockquote className="text-xs text-gray-200 italic leading-relaxed border-l-2 border-gold pl-3">
              "{citation.quote}"
            </blockquote>
          </div>

          <div className="flex items-center justify-between pt-2">
            {onViewSource && (
              <button
                onClick={() => {
                  onViewSource(citation.sourceId);
                  onClose();
                }}
                className="text-xs font-bold text-gold-light hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <span>Inspect full source</span>
                <ICONS.ChevronRight className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={onClose}
              className="ml-auto px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
