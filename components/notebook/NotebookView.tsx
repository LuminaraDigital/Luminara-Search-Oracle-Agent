import React, { useState, useEffect, useRef } from 'react';
import {
  Notebook,
  NotebookSource,
  NotebookMessage,
  NotebookCitation,
  StudioArtifact,
  StudioArtifactType,
  BusinessDNA,
  OracleMode,
} from '../../types';
import { notebookService } from '../../services/notebook/notebookService';
import { audioOverviewService } from '../../services/notebook/audioOverviewService';
import { AudioOverviewPlayer } from './AudioOverviewPlayer';
import { SourceModal } from './SourceModal';
import { CitationPopover } from './CitationPopover';
import { ICONS } from '../../constants';
import { renderMarkdown } from '../../utils/markdown';

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
  const [copiedArtifact, setCopiedArtifact] = useState(false);

  // Notes state
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

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

  const handleSaveNote = () => {
    if (!newNoteContent.trim()) return;
    notebookService.addNote(activeNotebook.id, newNoteTitle, newNoteContent);
    setNewNoteTitle('');
    setNewNoteContent('');
    setIsAddingNote(false);
    refreshNotebooks();
  };

  const handleSaveMessageAsNote = (content: string) => {
    notebookService.addNote(activeNotebook.id, 'Grounded Finding', content);
    refreshNotebooks();
    alert('Answer saved to your Notebook Notes.');
  };

  const handleExport = () => {
    const md = notebookService.exportNotebookMarkdown(activeNotebook.id);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeNotebook.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper to render message with interactive clickable citation badges [1], [2]
  const renderMessageContent = (msg: NotebookMessage) => {
    const rawHtml = renderMarkdown(msg.content);
    // Replace [1], [2] with clickable buttons
    const replaced = rawHtml.replace(/\[(\d+)\]/g, (_match, p1) => {
      const num = parseInt(p1, 10);
      return `<button data-citation-num="${num}" class="inline-citation-pill inline-flex items-center justify-center w-4 h-4 mx-0.5 rounded-full bg-gold/20 hover:bg-gold hover:text-black text-gold-light border border-gold/40 text-[9px] font-mono font-bold transition-all align-baseline cursor-pointer">${num}</button>`;
    });

    return (
      <div
        dangerouslySetInnerHTML={{ __html: replaced }}
        onClick={(e) => {
          const target = (e.target as HTMLElement).closest('.inline-citation-pill');
          if (target) {
            const numAttr = target.getAttribute('data-citation-num');
            if (numAttr) {
              const num = parseInt(numAttr, 10);
              const found = (msg.citations || []).find(c => c.citationNumber === num);
              if (found) {
                setActiveCitation(found);
              } else {
                const targetSrc = activeNotebook.sources[num - 1] || activeNotebook.sources[0];
                if (targetSrc) {
                  setActiveCitation({
                    sourceId: targetSrc.id,
                    sourceTitle: targetSrc.title,
                    citationNumber: num,
                    quote: targetSrc.summary || targetSrc.content.slice(0, 150) + '...',
                  });
                }
              }
            }
          }
        }}
      />
    );
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
        {/* =========================================================================
            COLUMN 1: Sources Rail (Left)
        ========================================================================= */}
        <aside
          className={`w-full lg:w-80 shrink-0 border-r border-white/10 bg-black/40 flex flex-col overflow-hidden ${
            mobileTab === 'sources' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* Sources Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                Sources
              </span>
              <span className="px-1.5 py-0.5 rounded-full bg-gold/15 text-gold-light text-[10px] font-mono font-bold">
                {activeNotebook.sources.length}
              </span>
            </div>

            {activeNotebook.sources.length > 0 && (
              <button
                onClick={() => {
                  const allSelected = activeNotebook.sources.every(s => s.selected);
                  notebookService.toggleAllSources(activeNotebook.id, !allSelected);
                  refreshNotebooks();
                }}
                className="text-[10px] text-gray-400 hover:text-gold-light transition-colors"
              >
                {activeNotebook.sources.every(s => s.selected) ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          {/* Sources List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
            {activeNotebook.sources.length === 0 ? (
              <div className="text-center p-6 border border-dashed border-white/15 rounded-2xl">
                <ICONS.Document className="w-6 h-6 text-gold mx-auto mb-2 opacity-60" />
                <p className="text-xs text-gray-400 mb-3">No sources added yet.</p>
                <button
                  onClick={() => setIsSourceModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-gold/20 text-gold-light text-xs font-bold hover:bg-gold/30 transition-colors"
                >
                  Add your first source
                </button>
              </div>
            ) : (
              activeNotebook.sources.map((source, idx) => (
                <div
                  key={source.id}
                  className={`p-3 rounded-2xl border transition-all ${
                    source.selected
                      ? 'bg-surface-1/90 border-gold/40 shadow-sm'
                      : 'bg-surface-1/30 border-white/5 opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={source.selected}
                      onChange={() => {
                        notebookService.toggleSourceSelection(activeNotebook.id, source.id);
                        refreshNotebooks();
                      }}
                      className="mt-1 w-3.5 h-3.5 rounded border-white/30 text-gold focus:ring-gold bg-black/60 cursor-pointer"
                      title="Toggle source grounding"
                    />

                    <div 
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => setInspectedSource(source)}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-gray-300 font-bold uppercase">
                          [{idx + 1}] {source.type}
                        </span>
                        <span className="text-[9px] text-gray-500 font-mono">
                          {source.wordCount} words
                        </span>
                      </div>
                      <h5 className="text-xs font-bold text-white truncate hover:text-gold-light transition-colors">
                        {source.title}
                      </h5>
                      {source.summary && (
                        <p className="text-[11px] text-gray-400 line-clamp-2 mt-1 leading-normal">
                          {source.summary}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        if (confirm(`Remove "${source.title}" from notebook?`)) {
                          notebookService.removeSource(activeNotebook.id, source.id);
                          refreshNotebooks();
                        }
                      }}
                      className="text-gray-600 hover:text-danger-400 p-1 transition-colors"
                      title="Remove source"
                    >
                      <ICONS.Close className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Bottom Add Source Launcher */}
          <div className="p-3 border-t border-white/10">
            <button
              onClick={() => setIsSourceModalOpen(true)}
              className="w-full py-2.5 rounded-xl border border-dashed border-white/20 hover:border-gold text-xs font-bold text-gray-300 hover:text-white flex items-center justify-center gap-2 transition-all"
            >
              <ICONS.Plus className="w-3.5 h-3.5 text-gold" />
              <span>Add URL, Doc, or Audit</span>
            </button>
          </div>
        </aside>

        {/* =========================================================================
            COLUMN 2: Grounded Chat & Citations (Center)
        ========================================================================= */}
        <main
          className={`flex-1 flex flex-col bg-surface-base overflow-hidden border-r border-white/10 ${
            mobileTab === 'chat' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* Grounding Status Pill */}
          <div className="shrink-0 px-4 py-2 border-b border-white/10 bg-surface-1/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success-400 animate-pulse shadow-[0_0_8px_theme(colors.success.500)]" />
              <span className="text-gray-300 font-mono text-[11px]">
                Grounding active on <strong className="text-gold-light">{activeNotebook.sources.filter(s => s.selected).length}</strong> sources
              </span>
            </div>
            <span className="text-[10px] text-gray-500 font-mono">
              Strict Attribution Standard
            </span>
          </div>

          {/* Conversation Feed */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
            {activeNotebook.messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-12">
                <div className="w-12 h-12 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center mb-4">
                  <ICONS.Brain className="w-6 h-6 text-gold-light" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  What would you like to know from your sources?
                </h3>
                <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                  Luminara Studio answers strictly from your selected sources with numbered interactive citations.
                </p>

                {/* Prompt Starters */}
                <div className="space-y-2 w-full text-left">
                  {[
                    "Summarize the key findings and strategic vulnerabilities across all sources.",
                    "What are the highest-priority schema and entity improvements recommended?",
                    "How do our competitors compare in AI search and citations?"
                  ].map((starter, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(starter)}
                      className="w-full p-3 rounded-xl bg-surface-1/80 hover:bg-surface-2 border border-white/10 hover:border-gold/40 text-xs text-gray-300 hover:text-white transition-all text-left flex items-center justify-between"
                    >
                      <span className="line-clamp-1">{starter}</span>
                      <ICONS.ChevronRight className="w-3.5 h-3.5 text-gold shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeNotebook.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-2xl rounded-2xl p-4 sm:p-5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-gold/15 border border-gold/30 text-white rounded-br-none'
                        : 'glass-morphism bg-surface-1/90 border border-white/10 text-gray-200 rounded-bl-none shadow-xl'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-2 pb-1.5 border-b border-white/5">
                      <span className={`text-[10px] font-black uppercase tracking-wider ${
                        msg.role === 'user' ? 'text-gold-light' : 'text-gray-400'
                      }`}>
                        {msg.role === 'user' ? 'You' : 'Luminara Grounded Oracle'}
                      </span>
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleSaveMessageAsNote(msg.content)}
                            className="p-1 text-gray-400 hover:text-gold-light transition-colors"
                            title="Save to Notebook Notes"
                          >
                            <ICONS.Bookmark className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {msg.role === 'user' ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      renderMessageContent(msg)
                    )}

                    {/* Source Citations summary bar */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest mr-1">
                          Citations:
                        </span>
                        {msg.citations.map(c => (
                          <button
                            key={c.citationNumber}
                            onClick={() => setActiveCitation(c)}
                            className="px-2 py-0.5 rounded-full bg-gold/15 hover:bg-gold hover:text-black border border-gold/40 text-gold-light text-[10px] font-mono font-bold transition-all flex items-center gap-1"
                          >
                            <span>[{c.citationNumber}]</span>
                            <span className="max-w-[120px] truncate">{c.sourceTitle}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {isQuerying && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-surface-1/80 border border-gold/40 max-w-sm animate-pulse">
                <div className="w-5 h-5 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
                <span className="text-xs font-mono text-gold-light tracking-wide">
                  Synthesizing grounded citations…
                </span>
              </div>
            )}

            {queryError && (
              <div className="p-3 rounded-xl bg-danger-500/15 border border-danger-500/40 text-danger-300 text-xs">
                {queryError}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          <div className="p-4 border-t border-white/10 bg-black/60">
            <div className="max-w-3xl mx-auto flex items-center gap-2 bg-surface-1 border border-white/15 focus-within:border-gold rounded-2xl p-2 transition-all shadow-xl">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(query)}
                placeholder="Ask about your sources (e.g. compare competitors, find schema gaps)..."
                className="flex-1 bg-transparent px-3 text-sm text-white placeholder:text-gray-500 focus:outline-none"
              />
              <button
                onClick={() => handleSendMessage(query)}
                disabled={!query.trim() || isQuerying}
                className="p-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black disabled:opacity-30 transition-all hover:scale-105 active:scale-95 shadow-md shadow-gold/20"
                title="Send grounded query"
              >
                <ICONS.Send className="w-4 h-4 text-black" />
              </button>
            </div>
          </div>
        </main>

        {/* =========================================================================
            COLUMN 3: Studio & Notes Rail (Right)
        ========================================================================= */}
        <aside
          className={`w-full lg:w-96 shrink-0 bg-black/40 flex flex-col overflow-y-auto custom-scrollbar p-4 space-y-6 ${
            mobileTab === 'studio' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* Section 1: Audio Overview Podcast */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gold-light flex items-center gap-1.5">
                <ICONS.Podcast className="w-4 h-4" />
                <span>Audio Overview</span>
              </h4>
              <span className="text-[9px] font-mono text-gray-500 uppercase">
                AI Deep Dive
              </span>
            </div>

            {activeNotebook.audioOverview ? (
              <AudioOverviewPlayer
                overview={activeNotebook.audioOverview}
                onRegenerate={handleGeneratePodcast}
                isGenerating={isGeneratingPodcast}
              />
            ) : (
              <div className="p-5 rounded-2xl bg-surface-1 border border-white/10 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-gold/10 text-gold flex items-center justify-center mx-auto">
                  <ICONS.Podcast className="w-5 h-5" />
                </div>
                <div>
                  <h5 className="text-xs font-bold text-white mb-1">
                    Dual-Host Audio Discussion
                  </h5>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Generate an analytical podcast with hosts Alex and Sam breaking down your sources.
                  </p>
                </div>
                <button
                  onClick={handleGeneratePodcast}
                  disabled={isGeneratingPodcast || activeNotebook.sources.length === 0}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs uppercase tracking-wider hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-md shadow-gold/20 flex items-center justify-center gap-2"
                >
                  {isGeneratingPodcast ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                      <span>Recording Podcast…</span>
                    </>
                  ) : (
                    <span>Generate Audio Overview</span>
                  )}
                </button>
              </div>
            )}
          </section>

          {/* Section 2: Studio Artifact Generators */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                Studio Artifacts
              </h4>
              <span className="text-[9px] font-mono text-gray-500 uppercase">
                1-Click Synthesis
              </span>
            </div>

            {/* Quick Generator Buttons */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { type: 'briefing_doc' as StudioArtifactType, label: 'Briefing Doc', icon: ICONS.Document },
                { type: 'study_guide' as StudioArtifactType, label: 'Study Guide', icon: ICONS.BookOpen || ICONS.Document },
                { type: 'faq' as StudioArtifactType, label: 'Strategic FAQ', icon: ICONS.Help || ICONS.Sparkle },
                { type: 'timeline' as StudioArtifactType, label: 'Roadmap', icon: ICONS.Calendar || ICONS.TimeSeries },
                { type: 'comparison_matrix' as StudioArtifactType, label: 'Comparison', icon: ICONS.Table || ICONS.Analyst },
              ].map(item => (
                <button
                  key={item.type}
                  onClick={() => handleGenerateArtifact(item.type)}
                  disabled={Boolean(generatingArtifactType)}
                  className="p-2.5 rounded-xl bg-surface-1 hover:bg-surface-2 border border-white/10 hover:border-gold/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-1.5 mb-1 text-gold-light group-hover:text-white">
                    <item.icon className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold">{item.label}</span>
                  </div>
                  <span className="text-[9px] text-gray-500 block">
                    {generatingArtifactType === item.type ? 'Synthesizing…' : 'Generate'}
                  </span>
                </button>
              ))}
            </div>

            {/* Selected Artifact Viewer */}
            {selectedArtifact && (
              <div className="p-4 rounded-2xl bg-surface-1 border border-white/10 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <h5 className="text-xs font-bold text-white truncate max-w-[180px]">
                    {selectedArtifact.title}
                  </h5>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedArtifact.content);
                      setCopiedArtifact(true);
                      setTimeout(() => setCopiedArtifact(false), 2000);
                    }}
                    className="text-[10px] text-gold-light hover:text-white transition-colors flex items-center gap-1"
                  >
                    <span>{copiedArtifact ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>

                <div 
                  className="max-h-60 overflow-y-auto text-xs text-gray-300 leading-relaxed custom-scrollbar prose prose-invert prose-xs"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedArtifact.content) }}
                />
              </div>
            )}
          </section>

          {/* Section 3: Saved Notes & Scratchpad */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                Notes ({activeNotebook.notes.length})
              </h4>
              <button
                onClick={() => setIsAddingNote(prev => !prev)}
                className="text-[10px] text-gold-light hover:text-white transition-colors"
              >
                {isAddingNote ? 'Cancel' : '+ Add Note'}
              </button>
            </div>

            {isAddingNote && (
              <div className="p-3 rounded-xl bg-surface-1 border border-gold/30 space-y-2">
                <input
                  type="text"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  placeholder="Note title..."
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-gold"
                />
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Write a thought or action item..."
                  rows={3}
                  className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-gold"
                />
                <button
                  onClick={handleSaveNote}
                  className="w-full py-1.5 rounded-lg bg-gold text-black text-xs font-bold hover:bg-gold-light"
                >
                  Save Note
                </button>
              </div>
            )}

            <div className="space-y-2">
              {activeNotebook.notes.map(note => (
                <div
                  key={note.id}
                  className="p-3 rounded-xl bg-surface-1 border border-white/5 space-y-1 group"
                >
                  <div className="flex items-center justify-between">
                    <h6 className="text-xs font-bold text-white truncate">
                      {note.title}
                    </h6>
                    <button
                      onClick={() => {
                        notebookService.deleteNote(activeNotebook.id, note.id);
                        refreshNotebooks();
                      }}
                      className="text-gray-600 hover:text-danger-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ICONS.Close className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed">
                    {note.content}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>
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
