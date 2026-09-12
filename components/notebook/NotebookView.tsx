import React, { useState, useEffect, useRef } from 'react';
import {
  Notebook,
  NotebookSource,
  NotebookCitation,
  StudioArtifact,
  StudioArtifactType,
  BusinessDNA,
} from '../../types';
import { notebookService } from '../../services/notebook/notebookService';
import { audioOverviewService } from '../../services/notebook/audioOverviewService';
import { SourceModal } from './SourceModal';
import { CitationPopover } from './CitationPopover';
import { ICONS } from '../../constants';
import { downloadBlob } from '../../utils/download';
import {
  NotebookSourcesPanel,
  NotebookChatPanel,
  NotebookStudioPanel,
} from './panels';

export {
  NotebookSourcesPanel,
  NotebookChatPanel,
  NotebookStudioPanel,
};

interface NotebookViewProps {
  dna: BusinessDNA | null;
}

export const NotebookView: React.FC<NotebookViewProps> = ({ dna }) => {
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => notebookService.listNotebooks());
  const [activeNotebookId, setActiveNotebookId] = useState<string>(() => notebookService.getActiveNotebookId());
  
  // Active Notebook
  const activeNotebook = notebooks.find(n => n.id === activeNotebookId) || notebooks[0] || null;

  // Modals & Drawers
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [inspectedSource, setInspectedSource] = useState<NotebookSource | null>(null);
  const [activeCitation, setActiveCitation] = useState<NotebookCitation | null>(null);

  // Chat Query state
  const [query, setQuery] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Audio Podcast state
  const [isGeneratingPodcast, setIsGeneratingPodcast] = useState(false);

  // Studio Artifacts state
  const [generatingArtifactType, setGeneratingArtifactType] = useState<StudioArtifactType | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<StudioArtifact | null>(null);

  // Responsive Mobile / TMA Tab Switcher ('sources' | 'chat' | 'studio')
  const [mobileTab, setMobileTab] = useState<'sources' | 'chat' | 'studio'>('chat');

  // Sync state
  const refreshNotebooks = () => {
    const list = notebookService.listNotebooks();
    setNotebooks(list);
  };

  useEffect(() => {
    if (activeNotebook && activeNotebook.artifacts.length > 0 && !selectedArtifact) {
      setSelectedArtifact(activeNotebook.artifacts[0]);
    }
  }, [activeNotebook, selectedArtifact]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeNotebook?.messages.length, isQuerying]);

  if (!activeNotebook) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-4">No active notebook found.</p>
          <button
            onClick={() => {
              const nb = notebookService.createNotebook('New Research Dossier');
              refreshNotebooks();
              setActiveNotebookId(nb.id);
            }}
            className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-bold"
          >
            Create Notebook
          </button>
        </div>
      </div>
    );
  }

  // Handlers
  const handleSelectNotebook = (id: string) => {
    notebookService.setActiveNotebookId(id);
    setActiveNotebookId(id);
  };

  const handleCreateNewNotebook = () => {
    const title = prompt('Enter a title for the new notebook:', 'Competitor Intelligence Dossier');
    if (!title) return;
    const nb = notebookService.createNotebook(title);
    refreshNotebooks();
    setActiveNotebookId(nb.id);
  };

  const handleSendMessage = async (userText: string) => {
    if (!userText.trim() || isQuerying) return;
    setIsQuerying(true);
    setQueryError(null);
    setQuery('');

    try {
      await notebookService.queryNotebook(activeNotebook.id, userText);
      refreshNotebooks();
    } catch (err: any) {
      console.error('[Notebook] Query error', err);
      setQueryError(err?.message || 'Failed to generate grounded answer');
    } finally {
      setIsQuerying(false);
    }
  };

  const handleGeneratePodcast = async () => {
    if (isGeneratingPodcast) return;
    setIsGeneratingPodcast(true);
    try {
      await audioOverviewService.generatePodcast(activeNotebook.id);
      refreshNotebooks();
    } catch (err: any) {
      alert(err?.message || 'Failed to generate Audio Overview');
    } finally {
      setIsGeneratingPodcast(false);
    }
  };

  const handleGenerateArtifact = async (type: StudioArtifactType) => {
    if (generatingArtifactType) return;
    setGeneratingArtifactType(type);
    try {
      const art = await notebookService.generateArtifact(activeNotebook.id, type);
      refreshNotebooks();
      setSelectedArtifact(art);
    } catch (err: any) {
      alert(err?.message || 'Failed to generate studio artifact');
    } finally {
      setGeneratingArtifactType(null);
    }
  };

  const handleSaveMessageAsNote = (content: string) => {
    notebookService.addNote(activeNotebook.id, 'Grounded Finding', content);
    refreshNotebooks();
    alert('Answer saved to your Notebook Notes.');
  };

  const handleExport = () => {
    const md = notebookService.exportNotebookMarkdown(activeNotebook.id);
    const blob = new Blob([md], { type: 'text/markdown' });
    downloadBlob(blob, `${activeNotebook.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-black text-white animate-in fade-in duration-300">
      {/* Top Action Bar */}
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 bg-surface-1/60 backdrop-blur-xl z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-gold to-gold-dark text-black flex items-center justify-center shadow-lg shadow-gold/20">
            <ICONS.Notebook className="w-4 h-4 text-black" />
          </div>

          {/* Notebook Selector Dropdown */}
          <div className="relative">
            <select
              value={activeNotebook.id}
              onChange={(e) => handleSelectNotebook(e.target.value)}
              className="appearance-none bg-white/5 hover:bg-white/10 border border-white/15 focus:border-gold rounded-xl px-3 py-1.5 pr-8 text-xs font-bold text-white tracking-wide cursor-pointer focus:outline-none transition-all"
            >
              {notebooks.map(nb => (
                <option key={nb.id} value={nb.id} className="bg-black text-white">
                  {nb.title} ({nb.sources.length} sources)
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gold">
              <ICONS.ChevronDown className="w-3.5 h-3.5" />
            </div>
          </div>

          <button
            onClick={handleCreateNewNotebook}
            className="p-1.5 rounded-lg border border-white/10 hover:border-gold/50 text-gray-400 hover:text-white transition-colors"
            title="Create New Notebook"
          >
            <ICONS.Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-2">
          {/* Mobile Tab Switcher */}
          <div className="flex lg:hidden bg-surface-2 p-0.5 rounded-lg border border-white/10">
            <button
              onClick={() => setMobileTab('sources')}
              className={`px-2 py-1 rounded text-[10px] font-bold ${
                mobileTab === 'sources' ? 'bg-gold text-black' : 'text-gray-400'
              }`}
            >
              Sources ({activeNotebook.sources.length})
            </button>
            <button
              onClick={() => setMobileTab('chat')}
              className={`px-2 py-1 rounded text-[10px] font-bold ${
                mobileTab === 'chat' ? 'bg-gold text-black' : 'text-gray-400'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setMobileTab('studio')}
              className={`px-2 py-1 rounded text-[10px] font-bold ${
                mobileTab === 'studio' ? 'bg-gold text-black' : 'text-gray-400'
              }`}
            >
              Studio
            </button>
          </div>

          <button
            onClick={() => setIsSourceModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-md shadow-gold/20 flex items-center gap-1.5"
          >
            <ICONS.Plus className="w-3.5 h-3.5 text-black" />
            <span className="hidden sm:inline">Add Source</span>
          </button>

          <button
            onClick={handleExport}
            className="p-2 rounded-xl border border-white/10 hover:border-white/25 text-gray-400 hover:text-white transition-colors"
            title="Export Notebook to Markdown"
          >
            <ICONS.Download className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main 3-Column Studio Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* COLUMN 1: Sources Rail (Left) */}
        <NotebookSourcesPanel
          activeNotebook={activeNotebook}
          mobileTab={mobileTab}
          onAddSource={() => setIsSourceModalOpen(true)}
          onInspectSource={(source) => setInspectedSource(source)}
          onRefresh={refreshNotebooks}
        />

        {/* COLUMN 2: Grounded Chat & Citations (Center) */}
        <NotebookChatPanel
          activeNotebook={activeNotebook}
          mobileTab={mobileTab}
          query={query}
          setQuery={setQuery}
          isQuerying={isQuerying}
          queryError={queryError}
          onSendMessage={handleSendMessage}
          onSaveMessageAsNote={handleSaveMessageAsNote}
          onSelectCitation={(citation) => setActiveCitation(citation)}
          messagesEndRef={messagesEndRef}
        />

        {/* COLUMN 3: Studio & Notes Rail (Right) */}
        <NotebookStudioPanel
          activeNotebook={activeNotebook}
          mobileTab={mobileTab}
          isGeneratingPodcast={isGeneratingPodcast}
          onGeneratePodcast={handleGeneratePodcast}
          generatingArtifactType={generatingArtifactType}
          selectedArtifact={selectedArtifact}
          onSelectArtifact={setSelectedArtifact}
          onGenerateArtifact={handleGenerateArtifact}
          onRefresh={refreshNotebooks}
        />
      </div>

      {/* Source Inspector Drawer Modal */}
      {inspectedSource && (
        <div 
          className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) setInspectedSource(null); }}
        >
          <div 
            className="w-full max-w-2xl my-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] flex flex-col glass-morphism rounded-3xl border border-gold/40 p-4 sm:p-6 shadow-2xl bg-black/95 overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={inspectedSource.title}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4 shrink-0">
              <div className="min-w-0 pr-3">
                <span className="text-[10px] font-mono uppercase tracking-widest text-gold-light">
                  {inspectedSource.type} · {inspectedSource.wordCount} words
                </span>
                <h3 className="text-base font-bold text-white truncate">
                  {inspectedSource.title}
                </h3>
              </div>
              <button
                onClick={() => setInspectedSource(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white shrink-0"
                title="Close (Esc)"
                aria-label="Close modal"
              >
                <ICONS.Close className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 bg-surface-1 rounded-2xl border border-white/5 text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
              {inspectedSource.content}
            </div>

            <div className="flex justify-end pt-4 shrink-0">
              <button
                onClick={() => setInspectedSource(null)}
                className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Citation Popover */}
      <CitationPopover
        citation={activeCitation}
        onClose={() => setActiveCitation(null)}
        onViewSource={(srcId) => {
          const s = activeNotebook.sources.find(src => src.id === srcId);
          if (s) setInspectedSource(s);
        }}
      />

      {/* Add Source Modal */}
      <SourceModal
        isOpen={isSourceModalOpen}
        notebookId={activeNotebook.id}
        dna={dna}
        onClose={() => setIsSourceModalOpen(false)}
        onSourceAdded={refreshNotebooks}
      />
    </div>
  );
};
