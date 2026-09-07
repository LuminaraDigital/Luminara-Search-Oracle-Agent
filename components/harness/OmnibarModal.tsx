import React, { useState, useEffect, useRef } from 'react';
import { commandRouterService } from '../../services/harness/commandRouterService';
import { HarnessCommandMetadata, AppView } from '../../types';

interface OmnibarModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  onExecuteCommand?: (cmd: string) => void;
}

export const OmnibarModal: React.FC<OmnibarModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onExecuteCommand
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState<HarnessCommandMetadata[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setResults(commandRouterService.getAllMetadata().slice(0, 8));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const matches = commandRouterService.searchCommands(query);
    setResults(matches.slice(0, 10));
    setSelectedIndex(0);
  }, [query, isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        executeSelection(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const executeSelection = (cmd: HarnessCommandMetadata) => {
    const fullCmd = `luminara ${cmd.group} ${cmd.name}`;
    
    // Check if command maps directly to a high-level navigation view
    if (cmd.group === 'audit') {
      onNavigate(AppView.INSTANT_AUDIT);
    } else if (cmd.group === 'agent' && cmd.name === 'run') {
      onNavigate(AppView.ORACLE_AGENT);
    } else if (cmd.group === 'slm') {
      onNavigate(AppView.ORACLE_MIND);
    } else if (cmd.group === 'forecast') {
      onNavigate(AppView.TIMESFM_FORECAST);
    } else if (cmd.group === 'dna') {
      onNavigate(AppView.BUSINESS_DNA);
    } else if (cmd.group === 'kg') {
      try {
        sessionStorage.setItem('luminara_harness_tab', 'graph');
        window.dispatchEvent(new Event('luminara-harness-tab'));
      } catch {
        /* ignore */
      }
      commandRouterService.executeCommandLine(fullCmd);
      if (onExecuteCommand) {
        onExecuteCommand(fullCmd);
      }
      onNavigate(AppView.HARNESS);
    } else {
      // Execute command line directly
      commandRouterService.executeCommandLine(fullCmd);
      if (onExecuteCommand) {
        onExecuteCommand(fullCmd);
      }
      onNavigate(AppView.HARNESS);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl glass-morphism rounded-2xl border border-[#BF953F]/40 bg-black/95 shadow-[0_0_80px_rgba(191,149,63,0.3)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="p-4 border-b border-[#BF953F]/20 flex items-center gap-3">
          <span className="text-[#FCF6BA] text-lg font-mono">⚡</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Type where you want to go: audit, ask, profile, research…'
            className="flex-1 bg-transparent text-white placeholder-gray-500 font-mono text-sm focus:outline-none"
          />
          <span className="px-2 py-0.5 rounded bg-white/10 text-gray-400 font-mono text-[10px]">
            ESC to close
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-gray-500">
              No matching commands or tools found for "{query}".
            </div>
          ) : (
            results.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={`${cmd.group}_${cmd.name}`}
                  onClick={() => executeSelection(cmd)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#BF953F]/20 border border-[#BF953F]/50 shadow-[0_0_15px_rgba(191,149,63,0.15)]'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/5 text-[#FCF6BA] border border-white/10 shrink-0">
                      {cmd.group}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-white font-mono flex items-center gap-2">
                        <span>luminara {cmd.group} {cmd.name}</span>
                        {cmd.args && (
                          <span className="text-[10px] text-gray-500 font-normal">
                            {cmd.args}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">
                        {cmd.summary}
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-gray-500 shrink-0">
                    {isSelected ? '↵ Execute' : ''}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Omnibar Footer Helper */}
        <div className="p-3 bg-black/60 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-gray-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Super+Alt+Space / Cmd+K</span>
          </div>
          <span className="text-[#BF953F]">Luminara Archy Omnibar</span>
        </div>
      </div>
    </div>
  );
};
