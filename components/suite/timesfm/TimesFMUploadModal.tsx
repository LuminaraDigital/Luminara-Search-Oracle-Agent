import React, { useState, useEffect } from 'react';
import { ICONS } from '../../../constants';
import { TimesFmPoint } from '../../../types';
import { timesfmService } from '../../../services/timesfm/timesfmService';

export interface TimesFMUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyData: (points: TimesFmPoint[], name: string) => void;
  onError: (msg: string) => void;
}

export const TimesFMUploadModal: React.FC<TimesFMUploadModalProps> = ({
  isOpen,
  onClose,
  onApplyData,
  onError,
}) => {
  const [pasteText, setPasteText] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleApplyCustomData = () => {
    if (!pasteText.trim()) return;
    const parsed = timesfmService.parseTimeSeriesData(pasteText);
    if (parsed.length < 5) {
      onError('Parsed fewer than 5 data points. Please ensure valid CSV, TSV, or numeric sequence.');
      return;
    }
    onApplyData(parsed, 'Custom Ingested Sequence');
    setPasteText('');
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const parsed = timesfmService.parseTimeSeriesData(text);
        if (parsed.length >= 5) {
          onApplyData(parsed, file.name.replace(/\.[^/.]+$/, ''));
          onClose();
        } else {
          onError('File contains insufficient valid data points (minimum 5 required).');
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="glass-morphism border border-gold/40 rounded-2xl shadow-2xl w-full max-w-lg my-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden relative bg-black/95"
        role="dialog"
        aria-modal="true"
        aria-label="Ingest Time-Series Dataset"
      >
        <div className="bg-gradient-to-r from-gold/20 to-transparent px-6 py-4 border-b border-gold/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ICONS.FileText className="w-4 h-4 text-gold-light" />
            <h3 className="text-base font-bold text-white uppercase tracking-wider">Ingest Time-Series Dataset</h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            title="Close (Esc)"
            aria-label="Close modal"
          >
            <ICONS.X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
              Upload CSV or TSV File
            </label>
            <label className="border-2 border-dashed border-white/15 hover:border-gold/60 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors group">
              <ICONS.FileText className="w-8 h-8 text-gold-light/60 group-hover:text-gold-light mb-2" />
              <span className="text-xs text-gray-300 group-hover:text-white font-medium">Click to browse file (.csv, .tsv, .txt)</span>
              <span className="text-[10px] text-gray-500 mt-1">Columns: Date/Timestamp, Metric Value</span>
              <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
              Or Paste Raw Numbers / CSV Lines
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="2026-01-01, 1420&#10;2026-01-02, 1490&#10;2026-01-03, 1510..."
              rows={5}
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl p-3 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleApplyCustomData}
              disabled={!pasteText.trim()}
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs uppercase tracking-wider disabled:opacity-30"
            >
              Load & Ingest
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
