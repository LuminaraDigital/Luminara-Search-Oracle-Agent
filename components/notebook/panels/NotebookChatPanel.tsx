import React from 'react';
import { Notebook, NotebookMessage, NotebookCitation } from '../../../types';
import { ICONS } from '../../../constants';
import { renderMarkdown } from '../../../utils/markdown';

interface NotebookChatPanelProps {
  activeNotebook: Notebook;
  mobileTab: 'sources' | 'chat' | 'studio';
  query: string;
  setQuery: (q: string) => void;
  isQuerying: boolean;
  queryError: string | null;
  onSendMessage: (text: string) => void;
  onSaveMessageAsNote: (content: string) => void;
  onSelectCitation: (citation: NotebookCitation) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export const NotebookChatPanel: React.FC<NotebookChatPanelProps> = ({
  activeNotebook,
  mobileTab,
  query,
  setQuery,
  isQuerying,
  queryError,
  onSendMessage,
  onSaveMessageAsNote,
  onSelectCitation,
  messagesEndRef,
}) => {
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
                onSelectCitation(found);
              } else {
                const targetSrc = activeNotebook.sources[num - 1] || activeNotebook.sources[0];
                if (targetSrc) {
                  onSelectCitation({
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
                  onClick={() => onSendMessage(starter)}
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
                        onClick={() => onSaveMessageAsNote(msg.content)}
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
                        onClick={() => onSelectCitation(c)}
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
            onKeyDown={(e) => e.key === 'Enter' && onSendMessage(query)}
            placeholder="Ask about your sources (e.g. compare competitors, find schema gaps)..."
            className="flex-1 bg-transparent px-3 text-sm text-white placeholder:text-gray-500 focus:outline-none"
          />
          <button
            onClick={() => onSendMessage(query)}
            disabled={!query.trim() || isQuerying}
            className="p-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black disabled:opacity-30 transition-all hover:scale-105 active:scale-95 shadow-md shadow-gold/20"
            title="Send grounded query"
          >
            <ICONS.Send className="w-4 h-4 text-black" />
          </button>
        </div>
      </div>
    </main>
  );
};
