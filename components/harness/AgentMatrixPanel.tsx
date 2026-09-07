import React, { useState, useEffect } from 'react';
import { AgentRunnerConfig, AgentId, AgentDispatchTask } from '../../types';
import { agentMatrixService } from '../../services/harness/agentMatrixService';

export const AgentMatrixPanel: React.FC = () => {
  const [agents, setAgents] = useState<AgentRunnerConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>('oracle');
  const [promptInput, setPromptInput] = useState('');
  const [executionMode, setExecutionMode] = useState<'auto-approve' | 'plan-first' | 'interactive'>('auto-approve');
  const [isDispatching, setIsDispatching] = useState(false);
  const [tasks, setTasks] = useState<AgentDispatchTask[]>([]);
  const [activeTask, setActiveTask] = useState<AgentDispatchTask | null>(null);

  useEffect(() => {
    const update = () => {
      setAgents(agentMatrixService.getAgents());
      setTasks(agentMatrixService.getTasks());
    };
    update();
    return agentMatrixService.subscribe(update);
  }, []);

  const selectedAgent = agents.find(a => a.id === selectedAgentId) || agents[0];

  const handleSetDefault = (id: AgentId) => {
    agentMatrixService.setDefaultAgent(id);
  };

  const handleModelChange = (model: string) => {
    agentMatrixService.updateAgentModel(selectedAgentId, model);
  };

  const handleRunTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptInput.trim() || isDispatching) return;

    setIsDispatching(true);
    try {
      const task = await agentMatrixService.dispatchPrompt(promptInput, selectedAgentId, executionMode);
      setActiveTask(task);
      setPromptInput('');
    } finally {
      setIsDispatching(false);
    }
  };

  if (!selectedAgent) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Banner: Multi-Agent Fleet Overview */}
      <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-6 relative overflow-hidden bg-black/60">
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-[#BF953F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono uppercase tracking-[0.3em] px-2.5 py-0.5 rounded-full bg-[#BF953F]/20 text-[#FCF6BA] border border-[#BF953F]/40 font-black">
                MULTI-AGENT MATRIX
              </span>
              <span className="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10B981]" />
                Fleet Active ({agents.length} Connected)
              </span>
            </div>
            <h2 className="text-2xl font-bold gold-text tracking-tight mt-2">
              Autonomous Agent Fleet & Quota Orchestrator
            </h2>
            <p className="text-gray-400 text-xs mt-1 max-w-2xl">
              Inspired by Omarchy's lazy-loaded coding agent architecture. Seamlessly route prompts across Gemini Oracle Agent, Claude Code, Codex, Antigravity CLI, Hermes 3, Pi, and local edge SLMs with unified 5-hour rolling session tracking.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="text-[10px] font-mono text-gray-400 uppercase">Default Agent</div>
              <div className="text-sm font-bold text-[#FCF6BA]">{agentMatrixService.getDefaultAgent().name}</div>
            </div>
            <div className="w-10 h-10 rounded-xl glass-morphism border border-[#BF953F]/40 flex items-center justify-center text-[#FCF6BA]">
              ⚡
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Agent Selector + Quota & Runner Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Agent Cards List */}
        <div className="lg:col-span-4 space-y-3">
          <div className="text-xs font-mono uppercase tracking-wider text-gray-400 px-1 flex items-center justify-between">
            <span>Available Harness Runners</span>
            <span className="text-[10px] text-[#BF953F]">{agents.length} Engines</span>
          </div>

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {agents.map(a => {
              const isSelected = a.id === selectedAgentId;
              return (
                <div
                  key={a.id}
                  onClick={() => setSelectedAgentId(a.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? 'bg-[#BF953F]/15 border-[#BF953F] shadow-[0_0_20px_rgba(191,149,63,0.2)]'
                      : 'glass-morphism border-white/5 hover:border-[#BF953F]/30 bg-black/40'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{a.name}</span>
                        {a.isDefault && (
                          <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#BF953F]/30 text-[#FCF6BA] border border-[#BF953F]/50 font-bold">
                            DEFAULT
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5">{a.vendor}</div>
                    </div>
                    <span className={`w-2 h-2 rounded-full ${a.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  </div>

                  {/* Mini Quota Bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[9px] font-mono text-gray-400 mb-1">
                      <span>5h Session Burn</span>
                      <span className="text-[#FCF6BA]">{a.quota.fiveHourPct.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          a.quota.fiveHourPct > 80 ? 'bg-red-400' : a.quota.fiveHourPct > 50 ? 'bg-amber-400' : 'bg-[#BF953F]'
                        }`}
                        style={{ width: `${Math.min(100, a.quota.fiveHourPct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Agent Deep Inspection & Prompt Dispatcher */}
        <div className="lg:col-span-8 space-y-6">
          {/* Agent Spec & Live Quota Dashboard */}
          <div className="glass-morphism rounded-2xl border border-[#BF953F]/25 p-6 bg-black/70 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div>
                <div className="text-xl font-bold text-white flex items-center gap-2">
                  <span>{selectedAgent.name}</span>
                  <span className="text-xs font-mono text-[#FCF6BA] px-2 py-0.5 rounded bg-[#BF953F]/20 border border-[#BF953F]/30">
                    {selectedAgent.quota.planName}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{selectedAgent.description}</p>
              </div>

              <div className="flex items-center gap-2">
                {!selectedAgent.isDefault && (
                  <button
                    onClick={() => handleSetDefault(selectedAgent.id)}
                    className="px-3 py-1.5 rounded-lg border border-[#BF953F]/40 bg-[#BF953F]/10 hover:bg-[#BF953F]/25 text-[10px] font-mono uppercase tracking-wider text-[#FCF6BA] transition-all"
                  >
                    Set as Default
                  </button>
                )}
                <div className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[10px] font-mono text-gray-300">
                  CLI: <code className="text-[#FCF6BA]">{selectedAgent.cliCommand}</code>
                </div>
              </div>
            </div>

            {/* Live Quota Gauges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="glass-morphism rounded-xl border border-white/5 p-3.5 bg-black/40">
                <div className="text-[10px] font-mono text-gray-400 uppercase">5-Hour Window</div>
                <div className="text-lg font-bold text-[#FCF6BA] mt-1 font-mono">
                  {selectedAgent.quota.fiveHourPct.toFixed(1)}%
                </div>
                <div className="text-[9px] font-mono text-gray-500 mt-0.5">
                  {(selectedAgent.quota.fiveHourUsedTokens / 1000).toFixed(0)}k / {(selectedAgent.quota.fiveHourLimitTokens / 1000).toFixed(0)}k tokens
                </div>
              </div>

              <div className="glass-morphism rounded-xl border border-white/5 p-3.5 bg-black/40">
                <div className="text-[10px] font-mono text-gray-400 uppercase">Weekly Quota</div>
                <div className="text-lg font-bold text-white mt-1 font-mono">
                  {selectedAgent.quota.weeklyPct.toFixed(1)}%
                </div>
                <div className="text-[9px] font-mono text-gray-500 mt-0.5">
                  {(selectedAgent.quota.weeklyUsedTokens / 1000000).toFixed(1)}M / {(selectedAgent.quota.weeklyLimitTokens / 1000000).toFixed(1)}M tokens
                </div>
              </div>

              <div className="glass-morphism rounded-xl border border-white/5 p-3.5 bg-black/40">
                <div className="text-[10px] font-mono text-gray-400 uppercase">Burn Rate</div>
                <div className="text-lg font-bold text-emerald-400 mt-1 font-mono">
                  {selectedAgent.quota.tokensPerMin.toLocaleString()}
                </div>
                <div className="text-[9px] font-mono text-gray-500 mt-0.5">tokens / min (live)</div>
              </div>

              <div className="glass-morphism rounded-xl border border-white/5 p-3.5 bg-black/40">
                <div className="text-[10px] font-mono text-gray-400 uppercase">Prepaid Balance</div>
                <div className="text-lg font-bold text-[#FCF6BA] mt-1 font-mono">
                  ${selectedAgent.quota.prepaidBalance.toFixed(2)}
                </div>
                <div className="text-[9px] font-mono text-gray-500 mt-0.5">Unrestricted API credits</div>
              </div>
            </div>

            {/* Model Selection Row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
              <span className="text-xs font-mono text-gray-400">Target Foundation Model:</span>
              <div className="flex flex-wrap gap-2">
                {selectedAgent.supportedModels.map(m => (
                  <button
                    key={m}
                    onClick={() => handleModelChange(m)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-all border ${
                      selectedAgent.defaultModel === m
                        ? 'bg-[#BF953F]/25 text-[#FCF6BA] border-[#BF953F]'
                        : 'bg-black/40 text-gray-400 border-white/10 hover:text-white'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Autonomous Prompt Dispatcher */}
            <form onSubmit={handleRunTask} className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono uppercase tracking-wider text-gray-300">
                  Autonomous Task Dispatcher
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-gray-400">Mode:</span>
                  {(['auto-approve', 'plan-first', 'interactive'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExecutionMode(m)}
                      className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ${
                        executionMode === m
                          ? 'bg-[#BF953F]/20 text-[#FCF6BA] border-[#BF953F]/60 font-bold'
                          : 'bg-white/5 text-gray-400 border-white/5 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <textarea
                  value={promptInput}
                  onChange={e => setPromptInput(e.target.value)}
                  placeholder={`Send instructions to ${selectedAgent.name} (e.g., "Audit JSON-LD schema on https://stripe.com and benchmark competitors")...`}
                  rows={3}
                  className="w-full rounded-xl bg-black/60 border border-[#BF953F]/30 p-3.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#BF953F] transition-all font-mono"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono text-gray-500">
                  Executes in non-blocking mode with zero human interruption in 'auto-approve'.
                </div>
                <button
                  type="submit"
                  disabled={isDispatching || !promptInput.trim()}
                  className="px-5 py-2 rounded-xl bg-[#BF953F] hover:bg-[#AA771C] text-black font-bold text-xs uppercase tracking-widest transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-[#BF953F]/20"
                >
                  {isDispatching ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      <span>Dispatching...</span>
                    </>
                  ) : (
                    <>
                      <span>Dispatch Task</span>
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Active / Recent Task Execution Output */}
          {activeTask && (
            <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-5 bg-black/80 space-y-3 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Execution Result</span>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {activeTask.status.toUpperCase()}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-gray-400">
                  {activeTask.durationMs ? `${(activeTask.durationMs / 1000).toFixed(2)}s` : ''} | {activeTask.tokensBurned || 0} tokens
                </span>
              </div>

              {/* Thought Stream Log */}
              {activeTask.thoughtLog && activeTask.thoughtLog.length > 0 && (
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 space-y-1">
                  {activeTask.thoughtLog.map((log, i) => (
                    <div key={i} className="text-[10px] font-mono text-gray-400">
                      {log}
                    </div>
                  ))}
                </div>
              )}

              {/* Final Output */}
              <div className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto p-3 rounded-lg bg-black/60 border border-white/5">
                {activeTask.result}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
