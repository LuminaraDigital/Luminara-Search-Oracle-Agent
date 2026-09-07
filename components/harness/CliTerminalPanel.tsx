import React, { useState, useRef, useEffect } from 'react';
import { commandRouterService } from '../../services/harness/commandRouterService';
import { CommandExecutionResult } from '../../types';

interface HistoryEntry {
  command: string;
  result: CommandExecutionResult;
}

export const CliTerminalPanel: React.FC = () => {
  const [inputLine, setInputLine] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      command: 'luminara commands',
      result: {
        command: 'commands',
        rawInput: 'commands',
        status: 'success',
        format: 'text',
        executionTimeMs: 4,
        timestamp: Date.now(),
        output: 'Welcome to Luminara Archy Command Terminal (v2.4.0).\nType "luminara commands" to list all groups or click any quick command below.'
      }
    }
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>(['luminara commands']);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleExecute = async (cmdToRun?: string) => {
    const target = (cmdToRun || inputLine).trim();
    if (!target) return;

    setIsExecuting(true);
    try {
      const result = await commandRouterService.executeCommandLine(target);
      setHistory(prev => [...prev, { command: target, result }]);
      setCommandHistory(prev => [target, ...prev]);
      setHistoryIndex(-1);
      setInputLine('');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setInputLine(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputLine(commandHistory[nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputLine('');
      }
    }
  };

  const quickCommands = [
    'luminara commands',
    'luminara agent list --json',
    'luminara slm preset moe-100m',
    'luminara forecast run',
    'luminara theme cycle',
    'luminara reminder list',
    'luminara system stats'
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-6 bg-black/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] px-2.5 py-0.5 rounded-full bg-[#BF953F]/20 text-[#FCF6BA] border border-[#BF953F]/40 font-black">
            CLI RUNNER & ROUTER
          </span>
          <h2 className="text-2xl font-bold gold-text tracking-tight mt-2">
            Hierarchical Command Terminal
          </h2>
          <p className="text-gray-400 text-xs mt-1 max-w-2xl">
            Custom-engineered command dispatcher mirroring the Omarchy CLI standard. Supports command groups (<code>audit</code>, <code>agent</code>, <code>slm</code>, <code>forecast</code>, <code>theme</code>, <code>reminder</code>, <code>system</code>) and machine-readable <code>--json</code> output.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setHistory([])}
            className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-mono uppercase tracking-wider text-gray-400 hover:text-white transition-all"
          >
            Clear Screen
          </button>
        </div>
      </div>

      {/* Quick Launch Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-mono uppercase text-gray-500 mr-1">Quick Run:</span>
        {quickCommands.map(cmd => (
          <button
            key={cmd}
            onClick={() => handleExecute(cmd)}
            className="px-2.5 py-1 rounded-md bg-white/[0.03] hover:bg-[#BF953F]/20 border border-white/5 hover:border-[#BF953F]/40 text-[10px] font-mono text-gray-300 hover:text-[#FCF6BA] transition-all"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Terminal Window */}
      <div className="glass-morphism rounded-2xl border border-[#BF953F]/40 bg-black/90 shadow-2xl overflow-hidden flex flex-col h-[520px]">
        {/* Terminal Header Bar */}
        <div className="px-4 py-2.5 bg-black/80 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            <span className="text-[11px] font-mono text-gray-400 ml-2">luminara-terminal :: zsh</span>
          </div>

          <div className="text-[9px] font-mono text-gray-500">
            Use ↑ / ↓ for command history
          </div>
        </div>

        {/* Output Stream */}
        <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-4 select-text">
          {history.map((entry, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center gap-2 text-[#FCF6BA]">
                <span className="text-gray-500">➜</span>
                <span className="text-emerald-400 font-bold">~</span>
                <span className="font-bold">{entry.command}</span>
                <span className="text-[9px] text-gray-500 ml-auto">
                  {entry.result.executionTimeMs}ms
                </span>
              </div>

              <div
                className={`p-3 rounded-lg border whitespace-pre-wrap leading-relaxed ${
                  entry.result.status === 'error'
                    ? 'bg-red-500/10 border-red-500/30 text-red-300'
                    : entry.result.format === 'json'
                    ? 'bg-white/[0.02] border-white/5 text-cyan-300'
                    : 'bg-white/[0.01] border-white/5 text-gray-300'
                }`}
              >
                {entry.result.output}
              </div>
            </div>
          ))}
          <div ref={terminalEndRef} />
        </div>

        {/* Command Input Prompt Bar */}
        <div className="p-3 bg-black/95 border-t border-[#BF953F]/20 flex items-center gap-2 shrink-0">
          <span className="text-emerald-400 font-mono text-sm font-bold pl-2">➜</span>
          <span className="text-gray-500 font-mono text-xs">luminara</span>
          <input
            type="text"
            value={inputLine}
            onChange={e => setInputLine(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isExecuting}
            placeholder='commands, agent list --json, slm export, forecast run...'
            className="flex-1 bg-transparent text-white font-mono text-xs placeholder-gray-600 focus:outline-none"
            autoFocus
          />
          <button
            onClick={() => handleExecute()}
            disabled={isExecuting || !inputLine.trim()}
            className="px-3 py-1 rounded bg-[#BF953F]/20 hover:bg-[#BF953F]/30 border border-[#BF953F]/50 text-[#FCF6BA] text-[10px] font-mono uppercase tracking-wider transition-all disabled:opacity-30"
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
};
