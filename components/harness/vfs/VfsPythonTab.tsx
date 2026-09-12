import React, { useState } from 'react';
import { GeneratedVfsFile } from '../../../services/vfs/vfsCodeExporter';
import { downloadBlob } from '../../../utils/download';
import { copyToClipboard } from '../../../utils/clipboard';

interface VfsPythonTabProps {
  pythonFiles: GeneratedVfsFile[];
}

export const VfsPythonTab: React.FC<VfsPythonTabProps> = ({
  pythonFiles,
}) => {
  const [selectedPyFile, setSelectedPyFile] = useState<string>('vfs.py');
  const [copiedFile, setCopiedFile] = useState(false);

  const handleDownloadManifest = () => {
    const zipContent = JSON.stringify(pythonFiles, null, 2);
    const blob = new Blob([zipContent], { type: 'application/json' });
    downloadBlob(blob, 'luminara_viking_python_codebase.json');
  };

  const handleCopyFile = async (code: string) => {
    await copyToClipboard(code);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 2000);
  };

  const currentFile = pythonFiles.find(f => f.filename === selectedPyFile) || pythonFiles[0];

  return (
    <div className="space-y-6">
      <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">
              Standalone Clean-Room Python Package Exporter
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Export the complete Luminara Viking context database to a self-contained Python / FastAPI package (<code className="text-gold-light">luminara_viking/</code>) for deployment in microservices, sidecars, or standalone agent harnesses.
            </p>
          </div>
          <button
            onClick={handleDownloadManifest}
            className="px-4 py-2 rounded-xl bg-gold hover:bg-gold-dark text-xs font-mono text-black font-bold transition-all shadow-md flex items-center gap-1.5"
          >
            <span>⬇ Download Code Manifest</span>
          </button>
        </div>

        {/* File Switcher Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {pythonFiles.map(file => (
            <button
              key={file.filename}
              onClick={() => setSelectedPyFile(file.filename)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono transition-all shrink-0 border ${
                selectedPyFile === file.filename
                  ? 'bg-gold/20 text-gold-light border-gold/60 font-bold'
                  : 'text-gray-400 hover:text-white border-transparent hover:bg-white/5'
              }`}
            >
              <span>{file.filename}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Selected File Code Viewer */}
      {currentFile && (
        <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div>
              <span className="text-xs font-mono text-white font-bold">{currentFile.path}</span>
              <p className="text-[11px] text-gray-400 mt-0.5">{currentFile.description}</p>
            </div>
            <button
              onClick={() => handleCopyFile(currentFile.code)}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300"
            >
              {copiedFile ? 'Copied!' : 'Copy File'}
            </button>
          </div>

          <pre className="p-4 rounded-xl bg-black/80 border border-white/10 text-xs font-mono text-gray-200 overflow-x-auto max-h-[500px] leading-relaxed">
            <code>{currentFile.code}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
