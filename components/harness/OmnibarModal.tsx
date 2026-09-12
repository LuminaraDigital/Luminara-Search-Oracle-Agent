import React, { useState, useEffect, useRef, useMemo } from 'react';
import { commandRouterService } from '../../services/harness/commandRouterService';
import { AppView } from '../../types';
import { ICONS } from '../../constants';

interface OmnibarModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  onExecuteCommand?: (cmd: string) => void;
}

interface Destination {
  id: string;
  label: string;
  description: string;
  keywords: string;
  view: AppView;
  icon: React.FC<{ className?: string }>;
  group: 'Start here' | 'Your business' | 'Tools' | 'Labs';
  /** Extra state to set before navigating (harness tabs). */
  harnessTab?: string;
}

const DESTINATIONS: Destination[] = [
  { id: 'audit', label: 'Audit my website', description: 'See whether AI answers mention you, then commit to one fix.', keywords: 'audit seo aeo geo website report check site', view: AppView.INSTANT_AUDIT, icon: ICONS.Radar, group: 'Start here' },
  { id: 'ask', label: 'Ask a question', description: 'Chat with an analyst that checks live search results and remembers your business.', keywords: 'ask chat question oracle agent help', view: AppView.ORACLE_AGENT, icon: ICONS.Sparkle, group: 'Start here' },
  { id: 'notebook', label: 'Intelligence Studio', description: 'Grounded research dossiers, dual-host audio overviews, and executive briefing docs.', keywords: 'notebook studio sources dossier research audio overview briefing guide study faq', view: AppView.NOTEBOOK, icon: ICONS.Notebook, group: 'Start here' },
  { id: 'memory', label: 'Brand Memory', description: 'What changed since last scan: diffs, watchlist, Sentinel.', keywords: 'memory vault brand timeline diff watchlist sentinel', view: AppView.BRAND_MEMORY, icon: ICONS.Shield, group: 'Start here' },
  { id: 'home', label: 'Home', description: 'Ask, Audit, and Memory in one place.', keywords: 'home dashboard start overview', view: AppView.DASHBOARD, icon: ICONS.Shield, group: 'Start here' },
  { id: 'profile', label: 'My business profile', description: 'What you sell, to whom, and who you compete with. Required for a full audit.', keywords: 'profile business dna brand competitors company', view: AppView.BUSINESS_DNA, icon: ICONS.DNA, group: 'Your business' },
  { id: 'stress', label: 'Poke holes in my plan', description: 'A tough second opinion on a strategy or idea before you spend money on it.', keywords: 'stress test red team plan idea risk critique', view: AppView.STRESS_TEST, icon: ICONS.Stress, group: 'Tools' },
  { id: 'research', label: 'Research the market', description: 'Grounded research using live web search and Google Maps.', keywords: 'research market competitors maps local web', view: AppView.RESEARCH, icon: ICONS.Research, group: 'Tools' },
  { id: 'analyse', label: 'Analyse my data', description: 'Paste a spreadsheet or numbers and ask questions about them.', keywords: 'data analyse analyze csv spreadsheet numbers', view: AppView.DATA_ANALYST, icon: ICONS.Analyst, group: 'Tools' },
  { id: 'organise', label: 'Turn notes into a plan', description: 'Messy notes in, a structured business plan, brief or roadmap out.', keywords: 'notes plan organise organizer brief roadmap document', view: AppView.ORGANIZER, icon: ICONS.Organizer, group: 'Tools' },
  { id: 'how', label: 'How Luminara works', description: 'The method behind the audits.', keywords: 'how works method manifesto about', view: AppView.VISION, icon: ICONS.Sparkle, group: 'Tools' },
  { id: 'settings', label: 'Settings and AI keys', description: 'Connect FreeLLMAPI, Groq, NVIDIA or Ollama, and other keys.', keywords: 'settings keys api freellm freellmapi groq nvidia ollama gemini integrations', view: AppView.DASHBOARD, icon: ICONS.Settings, group: 'Tools' },
  { id: 'oraclemind', label: 'OracleMind SLM Studio (Lab)', description: 'Technical preview. Numbers are simulated.', keywords: 'lab slm model training oraclemind', view: AppView.ORACLE_MIND, icon: ICONS.Brain, group: 'Labs' },
  { id: 'timesfm', label: 'TimesFM Forecaster (Lab)', description: 'Technical preview. Numbers are simulated.', keywords: 'lab forecast timesfm time series', view: AppView.TIMESFM_FORECAST, icon: ICONS.TimeSeries, group: 'Labs' },
  { id: 'harness', label: 'Developer harness (Lab)', description: 'Agent matrix, context graph, memory, tests, themes.', keywords: 'lab harness developer agents graph vfs memory cli terminal theme', view: AppView.HARNESS, icon: ICONS.Terminal, group: 'Labs' },
];

const isAdvanced = () => {
  try { return localStorage.getItem('luminara_advanced_ui') === '1'; } catch { return false; }
};

/**
 * Cmd+K palette. Founders see plain destinations; developer CLI commands are appended only when
 * "Show developer tools" is on in Settings and the query looks like a command.
 */
export const OmnibarModal: React.FC<OmnibarModalProps> = ({ isOpen, onClose, onNavigate, onExecuteCommand }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const advanced = isAdvanced();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const destinations = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = DESTINATIONS.filter((d) => {
      if (!advanced && d.group === 'Labs') return false;
      if (!advanced && d.group === 'Tools' && d.id !== 'how' && d.id !== 'settings') return false;
      return true;
    });
    if (!q) return pool;
    return pool.filter(d => `${d.label} ${d.description} ${d.keywords}`.toLowerCase().includes(q));
  }, [query, advanced]);

  const devCommands = useMemo(() => {
    if (!advanced) return [];
    const q = query.trim();
    if (q.length < 2) return [];
    return commandRouterService.searchCommands(q).slice(0, 5);
  }, [query, advanced]);

  const total = destinations.length + devCommands.length;

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const go = (d: Destination) => {
    if (d.id === 'settings') {
      window.location.hash = '#settings';
      onClose();
      return;
    }
    if (d.harnessTab) {
      try { sessionStorage.setItem('luminara_harness_tab', d.harnessTab); window.dispatchEvent(new Event('luminara-harness-tab')); } catch { /* noop */ }
    }
    onNavigate(d.view);
    onClose();
  };

  const runDev = (cmd: { group: string; name: string }) => {
    const fullCmd = `luminara ${cmd.group} ${cmd.name}`;
    commandRouterService.executeCommandLine(fullCmd).catch(() => {});
    onExecuteCommand?.(fullCmd);
    onNavigate(AppView.HARNESS);
    onClose();
  };

  const activate = (idx: number) => {
    if (idx < destinations.length) go(destinations[idx]);
    else if (devCommands[idx - destinations.length]) runDev(devCommands[idx - destinations.length]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => (total ? (p + 1) % total : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => (total ? (p - 1 + total) % total : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(selectedIndex); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  if (!isOpen) return null;

  const groups = ['Start here', 'Your business', 'Tools', 'Labs'] as const;
  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto flex items-start justify-center pt-6 sm:pt-14 p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="w-full max-w-xl my-auto sm:my-0 max-h-[calc(100vh-3rem)] glass-morphism rounded-2xl border border-gold/40 bg-black/95 shadow-2xl shadow-gold/20 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onKeyDown={handleKeyDown}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a tool"
      >
        <div className="p-4 border-b border-gold/20 flex items-center gap-3 shrink-0">
          <ICONS.Search className="w-4 h-4 text-gold" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Where do you want to go?"
            className="flex-1 bg-transparent text-white placeholder-gray-400 text-sm focus:outline-none"
            aria-label="Search tools"
          />
          <button type="button" onClick={onClose} aria-label="Close dialog" className="px-2 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] hover:text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none" title="Close (Esc)">Esc</button>
        </div>

        <div className="flex-1 min-h-0 max-h-[28rem] overflow-y-auto p-2" role="listbox" aria-label="Tool options">
          {total === 0 && (
            <div className="p-8 text-center text-sm text-gray-400">Nothing matches "{query}". Try "audit", "ask" or "profile".</div>
          )}

          {groups.map(group => {
            const items = destinations.filter(d => d.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mb-2">
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">{group}</div>
                {items.map(d => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const selected = idx === selectedIndex;
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => go(d)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl cursor-pointer flex items-center gap-3 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                        selected ? 'bg-gold/15 border border-gold/40' : 'border border-transparent hover:bg-white/5'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-gold-light" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{d.label}</div>
                        <div className="text-[11px] text-gray-400 truncate">{d.description}</div>
                      </div>
                      {selected && <span className="ml-auto text-[10px] text-gray-400 shrink-0">Enter ↵</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {devCommands.length > 0 && (
            <div className="mb-2">
              <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-warning-400">Developer commands</div>
              {devCommands.map(cmd => {
                runningIndex += 1;
                const idx = runningIndex;
                const selected = idx === selectedIndex;
                return (
                  <button
                    key={`${cmd.group}_${cmd.name}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => runDev(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl cursor-pointer flex items-center gap-3 font-mono focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                      selected ? 'bg-warning-500/10 border border-warning-500/40' : 'border border-transparent hover:bg-white/5'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-white">luminara {cmd.group} {cmd.name} <span className="text-gray-400">{cmd.args}</span></div>
                      <div className="text-[11px] text-gray-400 truncate">{cmd.summary}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 bg-black/60 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-400">
          <span>↑↓ move · Enter open · Esc close</span>
          <span>Ctrl+K anywhere</span>
        </div>
      </div>
    </div>
  );
};
