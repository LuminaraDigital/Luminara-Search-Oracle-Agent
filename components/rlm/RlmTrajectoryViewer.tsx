/**
 * RLM Trajectory Visualizer Component
 *
 * Adapted from alexzhang13/rlm/visualizer (LogViewer.tsx, IterationTimeline.tsx,
 * TrajectoryPanel.tsx, ExecutionPanel.tsx).
 * MIT License - Copyright (c) 2026 Alex Zhang.
 *
 * Invariant: Never use em dashes (U+2014) in comments or output strings.
 */

import React, { useState } from 'react';
import type { RLMIteration, RLMTrajectoryMetadata } from '../../services/rlm/types';

export interface RlmTrajectoryViewerProps {
  trajectory: RLMTrajectoryMetadata;
  onClose?: () => void;
}

function getIterationStats(iteration: RLMIteration) {
  let subCalls = 0;
  let hasError = false;
  for (const block of iteration.codeBlocks) {
    if (block.result.stderr) hasError = true;
    subCalls += block.result.rlmCalls.length;
  }
  const promptChars = iteration.prompt.reduce((sum, m) => sum + m.content.length, 0);
  return {
    codeBlocks: iteration.codeBlocks.length,
    subCalls,
    execTimeSec: (iteration.iterationTimeMs / 1000).toFixed(2),
    hasError,
    hasFinal: iteration.finalAnswer !== null,
    inputTokensEst: Math.round(promptChars / 4),
    outputTokensEst: Math.round(iteration.response.length / 4),
  };
}

export const RlmTrajectoryViewer: React.FC<RlmTrajectoryViewerProps> = ({
  trajectory,
  onClose,
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<'code' | 'sublm'>('code');

  React.useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const { iterations, config, contextQuestion, finalAnswer, totalExecutionTimeMs, hasErrors } =
    trajectory;
  const safeIdx = Math.min(selectedIdx, Math.max(0, iterations.length - 1));
  const current = iterations[safeIdx] ?? null;
  const currentStats = current ? getIterationStats(current) : null;

  const totalCodeBlocks = iterations.reduce((s, it) => s + it.codeBlocks.length, 0);
  const totalSubCalls = iterations.reduce(
    (s, it) => s + it.codeBlocks.reduce((acc, b) => acc + b.result.rlmCalls.length, 0),
    0
  );

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 border border-slate-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/70">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-cyan-400 font-mono text-xs font-bold">RLM TRACE</span>
            <span className="text-xs text-slate-400 font-mono">
              {config.rootModel} (sub: {config.subModel})
            </span>
            {hasErrors && (
              <span className="px-2 py-0.5 text-[10px] rounded bg-red-500/20 text-red-300 border border-red-500/30">
                REPL Errors
              </span>
            )}
            {finalAnswer && (
              <span className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Verified Answer
              </span>
            )}
          </div>
          <p className="text-xs text-slate-300 mt-1 line-clamp-1">{contextQuestion}</p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400">Turns: </span>
            <span className="text-cyan-300 font-bold">{iterations.length}</span>
          </div>
          <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400">REPL: </span>
            <span className="text-emerald-300 font-bold">{totalCodeBlocks}</span>
          </div>
          <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400">Sub-LM: </span>
            <span className="text-fuchsia-300 font-bold">{totalSubCalls}</span>
          </div>
          <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400">Time: </span>
            <span className="text-amber-300 font-bold">
              {(totalExecutionTimeMs / 1000).toFixed(2)}s
            </span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Horizontal Iteration Timeline */}
      <div className="flex gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900/40 overflow-x-auto">
        {iterations.map((iter, idx) => {
          const st = getIterationStats(iter);
          const isSelected = idx === safeIdx;
          return (
            <button
              key={iter.iteration}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={`flex-shrink-0 w-56 text-left p-2.5 rounded-lg border transition-all ${
                isSelected
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : st.hasFinal
                    ? 'border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-400'
                    : st.hasError
                      ? 'border-red-500/40 bg-red-500/5 hover:border-red-400'
                      : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                <span className="font-bold text-slate-200">Turn #{iter.iteration}</span>
                <span className="text-slate-400">{st.execTimeSec}s</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono mb-1">
                <span className="text-emerald-400">{st.codeBlocks} repl</span>
                <span className="text-slate-600">:</span>
                <span className="text-fuchsia-400">{st.subCalls} sub</span>
                {st.hasFinal && (
                  <span className="ml-auto px-1 rounded bg-emerald-500/20 text-emerald-300">
                    FINAL
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 truncate">
                {iter.response.replace(/\s+/g, ' ').slice(0, 60)}
              </p>
            </button>
          );
        })}
      </div>

      {/* Split View: Left = Root Model Turn, Right = REPL & Sub-LM Calls */}
      {current && currentStats ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 flex-1 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 overflow-hidden">
          {/* Left Panel: Trajectory Prompt & Root Model Response */}
          <div className="flex flex-col min-h-0 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Root Orchestrator Turn #{current.iteration}
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                ~{currentStats.inputTokensEst} in / ~{currentStats.outputTokensEst} out tokens
              </span>
            </div>

            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
              <div className="text-[11px] font-mono text-sky-300 mb-1.5">
                Root Model Response
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap text-slate-200 overflow-x-auto">
                {current.response}
              </pre>
            </div>

            {current.finalAnswer && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                <div className="text-[11px] font-mono font-bold text-emerald-300 mb-1">
                  Submitted Answer (ready=true)
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap text-emerald-100">
                  {current.finalAnswer}
                </pre>
              </div>
            )}
          </div>

          {/* Right Panel: REPL Blocks & Sub-LM Calls */}
          <div className="flex flex-col min-h-0 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('code')}
                className={`px-3 py-1 rounded text-xs font-mono ${
                  activeTab === 'code'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                REPL Execution ({current.codeBlocks.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sublm')}
                className={`px-3 py-1 rounded text-xs font-mono ${
                  activeTab === 'sublm'
                    ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                Sub-LM Calls ({currentStats.subCalls})
              </button>
            </div>

            {activeTab === 'code' ? (
              current.codeBlocks.length > 0 ? (
                current.codeBlocks.map((block, bIdx) => (
                  <div
                    key={bIdx}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-emerald-400">REPL Block #{bIdx + 1}</span>
                      <span className="text-slate-400">
                        {block.result.executionTimeMs.toFixed(1)}ms
                      </span>
                    </div>
                    <pre className="text-xs font-mono bg-slate-950 p-2.5 rounded border border-slate-800 overflow-x-auto text-slate-200">
                      {block.code}
                    </pre>
                    {block.result.stdout && (
                      <div>
                        <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
                          stdout
                        </div>
                        <pre className="text-xs font-mono bg-slate-950/80 p-2.5 rounded border border-slate-800/80 whitespace-pre-wrap text-emerald-200 max-h-56 overflow-y-auto">
                          {block.result.stdout}
                        </pre>
                      </div>
                    )}
                    {block.result.stderr && (
                      <div>
                        <div className="text-[10px] font-mono uppercase text-red-400 mb-1">
                          stderr
                        </div>
                        <pre className="text-xs font-mono bg-red-950/30 p-2.5 rounded border border-red-500/30 whitespace-pre-wrap text-red-200">
                          {block.result.stderr}
                        </pre>
                      </div>
                    )}
                    {Object.keys(block.result.locals).length > 0 && (
                      <div className="text-[10px] font-mono text-slate-400">
                        Variables: {JSON.stringify(block.result.locals)}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 font-mono py-8 text-center">
                  No REPL blocks executed in this turn.
                </div>
              )
            ) : currentStats.subCalls > 0 ? (
              current.codeBlocks
                .flatMap((block, bIdx) =>
                  block.result.rlmCalls.map((call, cIdx) => ({
                    call,
                    bIdx,
                    cIdx,
                  }))
                )
                .map(({ call, bIdx, cIdx }, flatIdx) => (
                  <div
                    key={`${bIdx}-${cIdx}`}
                    className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-fuchsia-300 font-bold">
                        Sub-LM Call #{flatIdx + 1} (Block #{bIdx + 1} : {call.rootModel})
                      </span>
                      <span className="text-slate-400">
                        {call.executionTimeMs.toFixed(0)}ms
                      </span>
                    </div>
                    {call.error && (
                      <div className="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                        Error: {call.error}
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
                        Sub-Prompt
                      </div>
                      <pre className="text-xs font-mono bg-slate-950 p-2 rounded border border-slate-800 whitespace-pre-wrap max-h-36 overflow-y-auto text-slate-300">
                        {typeof call.prompt === 'string'
                          ? call.prompt
                          : JSON.stringify(call.prompt, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase text-fuchsia-300 mb-1">
                        Sub-Response
                      </div>
                      <pre className="text-xs font-mono bg-slate-950 p-2 rounded border border-fuchsia-500/20 whitespace-pre-wrap max-h-44 overflow-y-auto text-fuchsia-200">
                        {call.response}
                      </pre>
                    </div>
                  </div>
                ))
            ) : (
              <div className="text-xs text-slate-500 font-mono py-8 text-center">
                No sub-LM calls dispatched in this turn.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-8 text-xs font-mono text-slate-500">
          No RLM turns recorded in this trajectory.
        </div>
      )}
    </div>
  );
};
