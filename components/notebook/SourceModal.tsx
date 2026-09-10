import React, { useState } from 'react';
import { BusinessDNA } from '../../types';
import { notebookService } from '../../services/notebook/notebookService';
import { AeoCorpusService } from '../../services/corpus/aeoCorpusService';
import { ICONS } from '../../constants';

interface SourceModalProps {
  isOpen: boolean;
  notebookId: string;
  dna: BusinessDNA | null;
  onClose: () => void;
  onSourceAdded: () => void;
}

export const SourceModal: React.FC<SourceModalProps> = ({
  isOpen,
  notebookId,
  dna,
  onClose,
  onSourceAdded,
}) => {
  const [tab, setTab] = useState<'url' | 'text' | 'luminara' | 'file'>('url');

  // URL state
  const [url, setUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);

  // Text state
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');

  // Luminara corpus audits
  const [corpusRecords] = useState(() => AeoCorpusService.getInstance().getCorpusRecords());
  const [selectedAuditId, setSelectedAuditId] = useState<string>('');

  // Error state
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddUrl = async () => {
    if (!url.trim() || isScraping) return;
    setIsScraping(true);
    setError(null);
    try {
      await notebookService.addUrlSource(notebookId, url.trim());
      setUrl('');
      onSourceAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to scrape and ingest URL');
    } finally {
      setIsScraping(false);
    }
  };

  const handleAddText = () => {
    if (!textContent.trim()) return;
    try {
      notebookService.addTextSource(notebookId, textTitle, textContent);
      setTextTitle('');
      setTextContent('');
      onSourceAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to add text source');
    }
  };

  const handleAddDna = () => {
    if (!dna) return;
    try {
      notebookService.addDnaSource(notebookId, dna);
      onSourceAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to import Business DNA');
    }
  };

  const handleAddAudit = () => {
    const record = corpusRecords.find(r => r.id === selectedAuditId);
    if (!record) return;
    try {
      const auditText = `# Audit Report: ${record.domain}\n- Vertical: ${record.vertical}\n- Winning Schema: ${record.winningSchemaType}\n- Citation Rate: ${record.citationRate}%\n- Plain English Brief:\n${record.plainEnglishBrief}\n\n## Schema Snippet:\n\`\`\`json\n${record.schemaSnippet}\n\`\`\``;
      notebookService.addAuditSource(notebookId, record.domain, auditText);
      onSourceAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to import audit report');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await notebookService.addFileSource(notebookId, file);
      onSourceAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to read uploaded file');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl glass-morphism rounded-3xl border border-gold/40 p-6 sm:p-8 shadow-2xl bg-black/95 animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gold/15 text-gold-light border border-gold/30 flex items-center justify-center">
              <ICONS.Notebook className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Add Source to Notebook
              </h3>
              <p className="text-[11px] text-gray-400">
                Ground your notebook in live web pages, audits, or custom documentation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ICONS.Close className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-danger-500/10 border border-danger-500/30 text-danger-300 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-[10px] uppercase font-bold text-danger-400">Dismiss</button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-surface-1 border border-white/5 mb-6">
          <button
            onClick={() => setTab('url')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              tab === 'url' ? 'bg-gold text-black shadow-md font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            Web URL
          </button>
          <button
            onClick={() => setTab('text')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              tab === 'text' ? 'bg-gold text-black shadow-md font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            Paste Text
          </button>
          <button
            onClick={() => setTab('luminara')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              tab === 'luminara' ? 'bg-gold text-black shadow-md font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            Luminara Data
          </button>
          <button
            onClick={() => setTab('file')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              tab === 'file' ? 'bg-gold text-black shadow-md font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            Upload File
          </button>
        </div>

        {/* TAB 1: URL */}
        {tab === 'url' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">
                Website or Article URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                placeholder="https://example.com/pricing or https://competitor.com"
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl p-3.5 text-sm text-white placeholder:text-gray-600 focus:outline-none transition-all shadow-inner"
              />
              <p className="text-[11px] text-gray-500 mt-2">
                Luminara will crawl the page, strip boilerplate, and ingest clean distilled markdown into this notebook.
              </p>
            </div>

            <div className="flex justify-end pt-3">
              <button
                onClick={handleAddUrl}
                disabled={!url.trim() || isScraping}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-lg shadow-gold/20 flex items-center gap-2"
              >
                {isScraping ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Extracting…</span>
                  </>
                ) : (
                  <span>Scrape & Ingest</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: Text */}
        {tab === 'text' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                Source Title
              </label>
              <input
                type="text"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder="e.g. Q4 Strategy Memo, Competitor Pitch Deck"
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl p-3 text-sm text-white placeholder:text-gray-600 focus:outline-none transition-all shadow-inner mb-3"
              />

              <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                Content / Notes
              </label>
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={6}
                placeholder="Paste research notes, customer interviews, or strategic briefs..."
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl p-3 text-sm text-white placeholder:text-gray-600 focus:outline-none transition-all shadow-inner font-sans resize-y leading-relaxed"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleAddText}
                disabled={!textContent.trim()}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-lg shadow-gold/20"
              >
                Add Text Source
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: Luminara Import */}
        {tab === 'luminara' && (
          <div className="space-y-4">
            {dna && (
              <div className="p-4 rounded-2xl bg-surface-1 border border-gold/30 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <ICONS.DNA className="w-3.5 h-3.5 text-gold" />
                    <span>Business Profile: {dna.name}</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1 line-clamp-1">
                    {dna.usp || dna.industry || 'Saved business identity'}
                  </div>
                </div>
                <button
                  onClick={handleAddDna}
                  className="px-3 py-1.5 rounded-xl bg-gold text-black text-xs font-bold hover:bg-gold-light transition-colors"
                >
                  Import DNA
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">
                Import from Past Site Audits ({corpusRecords.length} available)
              </label>
              {corpusRecords.length > 0 ? (
                <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
                  {corpusRecords.slice(0, 10).map(rec => (
                    <div
                      key={rec.id}
                      onClick={() => setSelectedAuditId(rec.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        selectedAuditId === rec.id
                          ? 'bg-gold/15 border-gold text-white shadow-md'
                          : 'bg-surface-1/40 border-white/5 hover:border-white/20 text-gray-300'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold">{rec.domain}</div>
                        <div className="text-[10px] text-gray-400">{rec.vertical} · Citation rate {rec.citationRate}%</div>
                      </div>
                      <span className="text-[10px] text-gold-light font-mono font-bold">
                        {rec.winningSchemaType || 'Audit'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-6 rounded-xl bg-surface-1/30 border border-white/5 text-gray-500 text-xs">
                  No previous audits recorded in this browser yet. Run an audit on the Audit tab to populate this list.
                </div>
              )}
            </div>

            {selectedAuditId && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleAddAudit}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-gold/20"
                >
                  Import Selected Audit
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: File Upload */}
        {tab === 'file' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-white/15 hover:border-gold/50 rounded-2xl p-8 text-center transition-all bg-surface-1/20">
              <ICONS.Document className="w-8 h-8 text-gold mx-auto mb-3 opacity-80" />
              <div className="text-sm font-semibold text-white mb-1">
                Upload Document
              </div>
              <p className="text-xs text-gray-400 mb-4">
                Supports .txt, .md, .json, .csv files up to 10MB
              </p>
              <label className="inline-block px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-white cursor-pointer transition-all border border-white/10">
                <span>Select File</span>
                <input
                  type="file"
                  accept=".txt,.md,.json,.csv,.text,.markdown"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
