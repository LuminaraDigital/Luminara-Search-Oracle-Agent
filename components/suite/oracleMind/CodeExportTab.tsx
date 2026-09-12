import React from 'react';
import { ExportedCodeFile } from '../../../services/oracleMind/oracleMindCodeExporter';
import { ICONS } from '../../../constants';
import { useClipboard } from '../../../hooks/useClipboard';

interface CodeExportTabProps {
  exportedFiles: ExportedCodeFile[];
  selectedFileIndex: number;
  setSelectedFileIndex: (idx: number) => void;
}

export const CodeExportTab: React.FC<CodeExportTabProps> = ({
  exportedFiles,
  selectedFileIndex,
  setSelectedFileIndex,
}) => {
  const { copied, copy } = useClipboard();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* File List */}
      <div className="lg:col-span-4 glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-black uppercase tracking-widest text-gold-light">
            Exportable Package
          </span>
          <span className="text-[10px] font-mono text-success-400">100% Clean-Room</span>
        </div>

        <div className="space-y-1.5">
          {exportedFiles.map((file, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedFileIndex(idx)}
              className={`w-full text-left p-3 rounded-xl border transition-all text-xs ${
                selectedFileIndex === idx
                  ? 'border-gold bg-gold/15 text-white shadow-sm'
                  : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="font-mono font-bold">{file.filename}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{file.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Code Viewer & Actions */}
      <div className="lg:col-span-8 glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 flex flex-col space-y-3 min-h-[460px]">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div>
            <span className="font-mono text-xs font-bold text-gold-light">
              {exportedFiles[selectedFileIndex].filename}
            </span>
            <p className="text-[10px] text-gray-400">
              {exportedFiles[selectedFileIndex].description}
            </p>
          </div>

          <button
            onClick={() => copy(exportedFiles[selectedFileIndex].code)}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-gold/20 text-gray-300 hover:text-gold-light border border-white/10 hover:border-gold/40 text-xs font-bold transition-colors flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <ICONS.Check className="w-3.5 h-3.5 text-success-400" />
                <span className="text-success-400">Copied!</span>
              </>
            ) : (
              <>
                <ICONS.Copy className="w-3.5 h-3.5" />
                <span>Copy Source</span>
              </>
            )}
          </button>
        </div>

        <div className="flex-1 bg-black/90 rounded-xl p-4 border border-white/5 overflow-x-auto">
          <pre className="font-mono text-[11px] text-gray-300 whitespace-pre leading-relaxed">
            {exportedFiles[selectedFileIndex].code}
          </pre>
        </div>
      </div>
    </div>
  );
};
