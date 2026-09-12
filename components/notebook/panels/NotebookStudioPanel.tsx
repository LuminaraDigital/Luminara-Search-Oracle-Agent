import React, { useState } from 'react';
import { Notebook, StudioArtifact, StudioArtifactType } from '../../../types';
import { notebookService } from '../../../services/notebook/notebookService';
import { AudioOverviewPlayer } from '../AudioOverviewPlayer';
import { ICONS } from '../../../constants';
import { renderMarkdown } from '../../../utils/markdown';
import { useClipboard } from '../../../hooks/useClipboard';

interface NotebookStudioPanelProps {
  activeNotebook: Notebook;
  mobileTab: 'sources' | 'chat' | 'studio';
  isGeneratingPodcast: boolean;
  onGeneratePodcast: () => void;
  generatingArtifactType: StudioArtifactType | null;
  selectedArtifact: StudioArtifact | null;
  onSelectArtifact?: (art: StudioArtifact | null) => void;
  onGenerateArtifact: (type: StudioArtifactType) => void;
  onRefresh: () => void;
}

export const NotebookStudioPanel: React.FC<NotebookStudioPanelProps> = ({
  activeNotebook,
  mobileTab,
  isGeneratingPodcast,
  onGeneratePodcast,
  generatingArtifactType,
  selectedArtifact,
  onSelectArtifact,
  onGenerateArtifact,
  onRefresh,
}) => {
  const { copied: copiedArtifact, copy: copyArtifact } = useClipboard();

  // Notes state
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  const handleSaveNote = () => {
    if (!newNoteContent.trim()) return;
    notebookService.addNote(activeNotebook.id, newNoteTitle, newNoteContent);
    setNewNoteTitle('');
    setNewNoteContent('');
    setIsAddingNote(false);
    onRefresh();
  };

  return (
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
            onRegenerate={onGeneratePodcast}
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
              onClick={onGeneratePodcast}
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
              onClick={() => onGenerateArtifact(item.type)}
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
                onClick={() => copyArtifact(selectedArtifact.content)}
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
                    onRefresh();
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
  );
};
