import React, { useEffect } from 'react';
import { ICONS } from '../../constants';

/** True when a table cell holds no measured value (empty or a placeholder). Text values count as measured. */
export const isMetricMissing = (value: string | undefined | null): boolean =>
  /^(|-|n\/a|unknown|not[_ ]measured)$/i.test((value ?? '').trim());

// Metric modal for clickable table cells. Shows the single point-in-time audit value only:
// the audit has no history, so no trend or projection is drawn.
export const MetricModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  data: { header: string; value: string; entity: string } | null
}> = ({ isOpen, onClose, data }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !data) return null;

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="glass-morphism border border-gold/40 rounded-2xl shadow-2xl w-full max-w-lg my-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] overflow-y-auto relative bg-black/95"
        role="dialog"
        aria-modal="true"
        aria-label={data.header || 'Metric Details'}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
          <ICONS.X className="w-5 h-5" />
        </button>

        <div className="bg-gradient-to-r from-gold/20 to-transparent px-6 py-4 border-b border-gold/20">
          <h3 className="text-base font-bold text-white uppercase tracking-wider">{data.entity}</h3>
          <p className="text-xs text-gold-light font-mono">{data.header}</p>
        </div>

        <div className="p-6">
          {isMetricMissing(data.value) ? (
            <span className="text-xl font-bold font-mono text-gray-400">Not measured</span>
          ) : (
            <span className="text-3xl font-black font-mono gold-text">{data.value}</span>
          )}
          <p className="mt-4 text-[11px] text-gray-500">Point-in-time value from this audit. No historical trend was measured.</p>
        </div>
      </div>
    </div>
  );
};
