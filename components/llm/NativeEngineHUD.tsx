import React, { useState, useEffect } from 'react';
import { aiProviderService } from '../../services/aiProviderService';
import { configService } from '../../services/configService';
import { NativeEngineStatus, NativeEngineId } from '../../types';

export const NativeEngineHUD: React.FC = () => {
  const [statuses, setStatuses] = useState<NativeEngineStatus[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [priorityOrder, setPriorityOrder] = useState<NativeEngineId[]>(['groq', 'nim', 'openrouter', 'ollama', 'freellm']);
  const [activeEngine, setActiveEngine] = useState<string>('groq');

  const probeEngines = async () => {
    setIsProbing(true);
    try {
      const results = await aiProviderService.searchAndProbeNativeProviders();
      setStatuses(results);
    } catch (e) {
      console.warn('Probe error', e);
    } finally {
      setIsProbing(false);
    }
  };

  useEffect(() => {
    setPriorityOrder(configService.getNativePriority());
    probeEngines();

    const handleActive = (e: Event) => {
      const customEvent = e as CustomEvent<{ providerId: string; model: string }>;
      if (customEvent.detail) {
        setActiveEngine(customEvent.detail.providerId);
      }
    };

    const handlePriority = () => {
      setPriorityOrder(configService.getNativePriority());
    };

    const handleHash = () => {
      if (window.location.hash.toUpperCase().includes('NATIVE')) {
        setIsModalOpen(true);
      }
    };
    handleHash();

    const handleOpenHub = () => {
      setIsModalOpen(true);
      probeEngines();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('hashchange', handleHash);
    window.addEventListener('luminara-open-native-hub', handleOpenHub);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('luminara-llm-active-engine', handleActive);
    window.addEventListener('luminara-native-priority-change', handlePriority);
    return () => {
      window.removeEventListener('luminara-llm-active-engine', handleActive);
      window.removeEventListener('luminara-native-priority-change', handlePriority);
      window.removeEventListener('hashchange', handleHash);
      window.removeEventListener('luminara-open-native-hub', handleOpenHub);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const movePriority = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...priorityOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;
    setPriorityOrder(newOrder);
    configService.setNativePriority(newOrder);
  };

  const simulateFailover = () => {
    const failedName = activeEngine === 'groq' ? 'Groq Cloud LPU' : 'NVIDIA NIM Enterprise';
    const activeNext = activeEngine === 'groq' ? 'OpenRouter Frontier Intelligence' : 'Ollama Sovereign SLM';
    const nextModel = activeEngine === 'groq' ? 'openai/gpt-4o' : 'llama3.2 (Local Daemon)';

    aiProviderService.dispatchFailover({
      failedProvider: failedName,
      failedModel: activeEngine === 'groq' ? 'openai/gpt-oss-120b' : 'meta/llama-3.2-11b-vision-instruct',
      reason: 'HTTP 429 Rate Limit Exceeded (Simulated Test)',
      activatedProvider: activeNext,
      activatedModel: nextModel,
      latencyMs: 145,
      timestamp: Date.now(),
    });

    setActiveEngine(activeEngine === 'groq' ? 'openrouter' : 'ollama');
  };

  const getProviderBadge = (id: string) => {
    const s = statuses.find(x => x.id === id);
    const isAvail = s?.isAvailable;
    switch (id) {
      case 'groq':
        return { label: 'GROQ', icon: '⚡', isAvail, sub: '~500 tok/s' };
      case 'nim':
        return { label: 'NVIDIA', icon: '🟢', isAvail, sub: 'Enterprise' };
      case 'openrouter':
        return { label: 'OPENROUTER', icon: '🌐', isAvail, sub: 'Frontier 120 tok/s' };
      case 'ollama':
        return { label: 'OLLAMA', icon: '🦙', isAvail, sub: s?.isLocal ? 'Local :11434' : 'Cloud' };
      case 'freellm':
        return { label: 'FREELLM', icon: '∞', isAvail, sub: s?.isLocal ? 'Local gateway' : 'Remote gateway' };
      default:
        return { label: id, icon: '•', isAvail: false, sub: '' };
    }
  };

  return (
    <>
      {/* Top Header Pill - Compact on desktop/laptop, extended on 2xl */}
      <div 
        onClick={() => { setIsModalOpen(true); probeEngines(); }}
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gold/30 bg-black/60 hover:bg-gold/10 hover:border-gold/60 cursor-pointer transition-all shadow-[0_0_15px_rgba(191,149,63,0.1)] group shrink-0"
        title="Native AI engines: FreeLLMAPI, Groq, NVIDIA NIM, OpenRouter, Ollama (Click to configure failover hub)"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        <span className="text-[9px] font-mono font-bold tracking-wider text-gold-light uppercase flex items-center gap-1">
          <span>{getProviderBadge(activeEngine).icon}</span>
          <span>{getProviderBadge(activeEngine).label}</span>
        </span>
        <span className="hidden xl:inline 2xl:hidden text-[9px] font-mono text-gray-400">
          +{priorityOrder.length - 1} standby
        </span>
        <span className="2xl:hidden text-[9px] text-gold/60 group-hover:text-gold font-mono ml-0.5">⚙</span>

        {/* Extended chain on ultra-wide 2xl screens */}
        <div className="hidden 2xl:flex items-center gap-1 ml-1 border-l border-white/10 pl-2">
          {priorityOrder.map((id, idx) => {
            const badge = getProviderBadge(id);
            const isCurrent = activeEngine === id;
            return (
              <div 
                key={id} 
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${
                  isCurrent
                    ? 'bg-gold/25 text-gold-light border border-gold/50 font-bold'
                    : badge.isAvail
                    ? 'bg-white/5 text-gray-300 hover:text-white'
                    : 'bg-danger-950/20 text-gray-500 line-through'
                }`}
              >
                <span>{badge.icon}</span>
                <span>{badge.label}</span>
                {idx < priorityOrder.length - 1 && <span className="text-gray-600 ml-0.5 font-normal">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal / Flyout for Topology, Live Search & Failover Configuration */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 overflow-y-auto p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setIsModalOpen(false); }}
        >
          <div 
            className="relative w-full max-w-2xl my-auto rounded-3xl bg-black border border-gold/40 shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_40px_rgba(191,149,63,0.2)] flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] overflow-hidden text-ink"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Native LLM Engines & Auto-Failover Hub"
          >
            {/* Header (shrink-0) */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10 bg-black/90 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gold/20 border border-gold/40 flex items-center justify-center text-xl shadow-[0_0_15px_rgba(191,149,63,0.3)]">
                  ⚡
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold gold-text">
                    Native LLM Engines & Auto-Failover Hub
                  </h3>
                  <p className="text-[11px] sm:text-xs text-gray-400 font-mono">
                    FreeLLMAPI · Groq LPU · NVIDIA NIM · OpenRouter · Ollama
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full border border-white/10 hover:border-gold/50 text-gray-400 hover:text-white flex items-center justify-center transition-colors text-base"
                title="Close (Esc)"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Body (overflow-y-auto flex-1 min-h-0) */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-4">
              {/* Subheader info banner */}
              <div className="p-3.5 rounded-2xl bg-gold/10 border border-gold/20 text-xs text-gray-300 leading-relaxed">
                <span className="text-gold-light font-bold">Autonomous Failover Architecture: </span>
                When any provider hits rate limits (429), timeouts, or errors, it cools down for 60s and the next healthy engine
                <span className="text-gold-light font-semibold"> automatically continues the run</span>. FreeLLMAPI (when preferred) stacks free tiers behind one key.
              </div>

              {/* Providers Status & Priority Order Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase text-gray-400 px-1">
                  <span>Failover Priority Sequence (Drag / Reorder)</span>
                  <button
                    onClick={probeEngines}
                    disabled={isProbing}
                    className="flex items-center gap-1 text-gold-light hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    <span>{isProbing ? 'Probing...' : '↻ Search & Probe Engines'}</span>
                  </button>
                </div>

                {priorityOrder.map((id, index) => {
                  const s = statuses.find(x => x.id === id);
                  const isAvail = s?.isAvailable;
                  const isCurrent = activeEngine === id;

                  return (
                    <div
                      key={id}
                      className={`p-3 sm:p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 sm:gap-4 ${
                        isCurrent
                          ? 'bg-gold/15 border-gold/60 shadow-[0_0_15px_rgba(191,149,63,0.15)]'
                          : isAvail
                          ? 'bg-white/5 border-white/10 hover:border-white/20'
                          : 'bg-danger-950/10 border-danger-500/20'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-7 h-7 shrink-0 rounded-xl bg-black border border-white/10 flex items-center justify-center text-xs font-mono font-bold text-gold-light">
                          #{index + 1}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-white truncate">
                              {id === 'groq' && '⚡ Groq Cloud LPU'}
                              {id === 'nim' && '🟢 NVIDIA NIM Enterprise'}
                              {id === 'openrouter' && '🌐 OpenRouter Frontier'}
                              {id === 'ollama' && (s?.isLocal ? '🦙 Ollama (Local :11434)' : '🦙 Ollama Cloud Gateway')}
                              {id === 'freellm' && '∞ FreeLLMAPI Gateway'}
                            </span>
                            {isCurrent && (
                              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-gold/30 text-gold-light font-bold">
                                ACTIVE NOW
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-gray-400 font-mono mt-0.5 flex items-center gap-2 sm:gap-3 flex-wrap">
                            <span>Model: <span className="text-gray-200">{s?.model || 'auto'}</span></span>
                            <span>•</span>
                            <span>Speed: <span className="text-success-400 font-semibold">{s?.tokenSpeed || 'Online'}</span></span>
                            {s?.latencyMs ? <span>• {s.latencyMs}ms</span> : null}
                          </div>
                        </div>
                      </div>

                      {/* Right action & reorder */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`hidden sm:inline text-[10px] font-mono px-2.5 py-1 rounded-full border ${
                          isAvail 
                            ? 'border-success-500/30 bg-success-500/10 text-success-300' 
                            : 'border-warning-500/30 bg-warning-500/10 text-warning-300'
                        }`}>
                          {isAvail ? 'HEALTHY' : 'AWAITING KEY'}
                        </span>

                        <div className="flex flex-col gap-0.5 ml-1">
                          <button
                            onClick={() => movePriority(index, 'up')}
                            disabled={index === 0}
                            className="px-1.5 py-0.5 text-[9px] rounded bg-white/10 hover:bg-white/20 disabled:opacity-20 text-gray-200"
                            title="Move up in priority"
                            aria-label={`Move provider ${id} up`}
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => movePriority(index, 'down')}
                            disabled={index === priorityOrder.length - 1}
                            className="px-1.5 py-0.5 text-[9px] rounded bg-white/10 hover:bg-white/20 disabled:opacity-20 text-gray-200"
                            title="Move down in priority"
                            aria-label={`Move provider ${id} down`}
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer with Simulate Failover Test Button (shrink-0) */}
            <div className="p-4 sm:p-5 border-t border-white/10 flex items-center justify-between bg-black/90 shrink-0">
              <button
                onClick={simulateFailover}
                className="px-3.5 sm:px-4 py-2 rounded-xl text-xs font-mono font-bold bg-warning-500/20 hover:bg-warning-500/30 border border-warning-500/40 text-warning-300 hover:text-warning-200 transition-all flex items-center gap-2"
                title="Test simulated 429 failover to see automatic pop-up"
              >
                <span>⚡</span>
                <span className="hidden sm:inline">Simulate Failover Test (Pop-up Demo)</span>
                <span className="sm:hidden">Test Failover</span>
              </button>

              <button
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-gold hover:bg-gold-dark text-black font-mono transition-all shadow-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
