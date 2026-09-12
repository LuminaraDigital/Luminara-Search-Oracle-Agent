import React from 'react';
import { Notebook, NotebookSource } from '../../../types';
import { notebookService } from '../../../services/notebook/notebookService';
import { ICONS } from '../../../constants';

interface NotebookSourcesPanelProps {
  activeNotebook: Notebook;
  mobileTab: 'sources' | 'chat' | 'studio';
  onAddSource: () => void;
  onInspectSource: (source: NotebookSource) => void;
  onRefresh: () => void;
}

export const NotebookSourcesPanel: React.FC<NotebookSourcesPanelProps> = ({
  activeNotebook,
  mobileTab,
  onAddSource,
  onInspectSource,
  onRefresh,
}) => {
  return (
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
              onRefresh();
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
              onClick={onAddSource}
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
                    onRefresh();
                  }}
                  className="mt-1 w-3.5 h-3.5 rounded border-white/30 text-gold focus:ring-gold bg-black/60 cursor-pointer"
                  title="Toggle source grounding"
                />

                <div 
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => onInspectSource(source)}
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
                      onRefresh();
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
          onClick={onAddSource}
          className="w-full py-2.5 rounded-xl border border-dashed border-white/20 hover:border-gold text-xs font-bold text-gray-300 hover:text-white flex items-center justify-center gap-2 transition-all"
        >
          <ICONS.Plus className="w-3.5 h-3.5 text-gold" />
          <span>Add URL, Doc, or Audit</span>
        </button>
      </div>
    </aside>
  );
};
