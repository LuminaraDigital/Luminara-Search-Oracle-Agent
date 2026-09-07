import React, { useState, useEffect } from 'react';
import { aiProviderService } from '../../services/aiProviderService';
import { configService } from '../../services/configService';
import { NativeEngineStatus, NativeEngineId } from '../../types';

export const NativeEngineHUD: React.FC = () => {
  const [statuses, setStatuses] = useState<NativeEngineStatus[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [priorityOrder, setPriorityOrder] = useState<NativeEngineId[]>(['groq', 'nim', 'ollama']);
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

    const handleHash = () => {
      if (window.location.hash.toUpperCase().includes('NATIVE')) {
        setIsModalOpen(true);
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);

    window.addEventListener('luminara-llm-active-engine', handleActive);
    return () => {
      window.removeEventListener('luminara-llm-active-engine', handleActive);
      window.removeEventListener('hashchange', handleHash);
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
    configService.setNativePriority(newOrder as Array<'groq' | 'nim' | 'ollama'>);
  };

  const simulateFailover = () => {
    const failedName = activeEngine === 'groq' ? 'Groq Cloud LPU' : 'NVIDIA NIM Enterprise';
    const activeNext = activeEngine === 'groq' ? 'NVIDIA NIM Enterprise' : 'Ollama Sovereign SLM';
    const nextModel = activeEngine === 'groq' ? 'meta/llama-3.1-70b-instruct' : 'llama3.2 (Local Daemon)';

    aiProviderService.dispatchFailover({
      failedProvider: failedName,
      failedModel: activeEngine === 'groq' ? 'openai/gpt-oss-120b' : 'meta/llama-3.1-70b-instruct',
      reason: 'HTTP 429 Rate Limit Exceeded (Simulated Test)',
      activatedProvider: activeNext,
      activatedModel: nextModel,
      latencyMs: 145,
      timestamp: Date.now(),
    });

    setActiveEngine(activeEngine === 'groq' ? 'nim' : 'ollama');
  };

  const getProviderBadge = (id: string) => {
    const s = statuses.find(x => x.id === id);
    const isAvail = s?.isAvailable;
    switch (id) {
      case 'groq':
        return { label: 'GROQ', icon: '⚡', isAvail, sub: '285 tok/s' };
      case 'nim':
        return { label: 'NVIDIA', icon: '🟢', isAvail, sub: 'Enterprise' };
      case 'ollama':
        return { label: 'OLLAMA', icon: '🦙', isAvail, sub: s?.isLocal ? 'Local :11434' : 'Cloud' };
      default:
        return { label: id, icon: '•', isAvail: false, sub: '' };
    }
  };

  return (
    <>
      {/* Top Header Pill */}
      <div 
        onClick={() => { setIsModalOpen(true); probeEngines(); }}
        className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#BF953F]/30 bg-black/60 hover:bg-[#BF953F]/10 hover:border-[#BF953F]/60 cursor-pointer transition-all shadow-[0_0_15px_rgba(191,149,63,0.1)] group"
        title="Native AI Trinity Status: Groq, NVIDIA NIM, Ollama (Click to configure failover order)"
      >
        <span className="text-[8px] font-mono font-bold tracking-widest text-[#FCF6BA] uppercase">
          NATIVE LLM:
        </span>

        {priorityOrder.map((id, idx) => {
          const badge = getProviderBadge(id);
          const isCurrent = activeEngine === id;
          return (
            <div 
              key={id} 
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${
                isCurrent
                  ? 'bg-[#BF953F]/25 text-[#FCF6BA] border border-[#BF953F]/50 font-bold'
                  : badge.isAvail
                  ? 'bg-white/5 text-gray-300 hover:text-white'
                  : 'bg-red-950/20 text-gray-500 line-through'
              }`}
            >
              <span>{badge.icon}</span>
              <span>{badge.label}</span>
              {idx < priorityOrder.length - 1 && <span className="text-gray-600 ml-0.5 font-normal">→</span>}
            </div>
          );
        })}
      </div>

      {/* Modal / Flyout for Topology, Live Search & Failover Configuration */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl rounded-3xl bg-black border border-[#BF953F]/40 shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_40px_rgba(191,149,63,0.2)] p-6 text-[#f1f1f1]">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#BF953F]/20 border border-[#BF953F]/40 flex items-center justify-center text-xl shadow-[0_0_15px_rgba(191,149,63,0.3)]">
                  ⚡
                </div>
                <div>
                  <h3 className="text-lg font-bold gold-text">
                    Native LLM Trinity & Auto-Failover Hub
                  </h3>
                  <p className="text-xs text-gray-400 font-mono">
                    Groq LPU • NVIDIA NIM Enterprise • Ollama Local & Cloud
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full border border-white/10 hover:border-white/30 text-gray-400 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Subheader info banner */}
            <div className="my-4 p-3.5 rounded-2xl bg-[#BF953F]/10 border border-[#BF953F]/20 text-xs text-gray-300 leading-relaxed">
              <span className="text-[#FCF6BA] font-bold">Autonomous Failover Architecture: </span>
              Luminara Search natively prioritizes this trinity. When any provider hits rate limits (429), timeouts, or errors, the next healthy engine 
              <span className="text-[#FCF6BA] font-semibold"> automatically pops up with zero loss of query context</span>.
            </div>

            {/* Providers Status & Priority Order Table */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase text-gray-400 px-1">
                <span>Failover Priority Sequence (Drag / Reorder)</span>
                <button
                  onClick={probeEngines}
                  disabled={isProbing}
                  className="flex items-center gap-1 text-[#FCF6BA] hover:underline disabled:opacity-50"
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
                    className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
                      isCurrent
                        ? 'bg-[#BF953F]/15 border-[#BF953F]/60 shadow-[0_0_15px_rgba(191,149,63,0.15)]'
                        : isAvail
                        ? 'bg-white/5 border-white/10 hover:border-white/20'
                        : 'bg-red-950/10 border-red-500/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-xl bg-black border border-white/10 flex items-center justify-center text-xs font-mono font-bold text-[#FCF6BA]">
                        #{index + 1}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">
                            {id === 'groq' && '⚡ Groq Cloud LPU'}
                            {id === 'nim' && '🟢 NVIDIA NIM Enterprise'}
                            {id === 'ollama' && (s?.isLocal ? '🦙 Ollama (Local Daemon :11434)' : '🦙 Ollama Cloud Gateway')}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-[#BF953F]/30 text-[#FCF6BA] font-bold">
                              ACTIVE NOW
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-gray-400 font-mono mt-0.5 flex items-center gap-3">
                          <span>Model: <span className="text-gray-200">{s?.model || 'auto'}</span></span>
                          <span>•</span>
                          <span>Speed: <span className="text-emerald-400 font-semibold">{s?.tokenSpeed || 'Online'}</span></span>
                          {s?.latencyMs ? <span>• {s.latencyMs}ms</span> : null}
                        </div>
                      </div>
                    </div>

                    {/* Right action & reorder */}
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full border ${
                        isAvail 
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' 
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      }`}>
                        {isAvail ? 'HEALTHY & SEARCHED' : 'AWAITING KEY / DAEMON'}
                      </span>

                      <div className="flex flex-col gap-0.5 ml-2">
                        <button
                          onClick={() => movePriority(index, 'up')}
                          disabled={index === 0}
                          className="px-1.5 py-0.5 text-[9px] rounded bg-white/10 hover:bg-white/20 disabled:opacity-20 text-gray-200"
                          title="Move up in priority"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => movePriority(index, 'down')}
                          disabled={index === priorityOrder.length - 1}
                          className="px-1.5 py-0.5 text-[9px] rounded bg-white/10 hover:bg-white/20 disabled:opacity-20 text-gray-200"
                          title="Move down in priority"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer with Simulate Failover Test Button */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <button
                onClick={simulateFailover}
                className="px-4 py-2 rounded-xl text-xs font-mono font-bold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 hover:text-amber-200 transition-all flex items-center gap-2"
                title="Test simulated 429 failover to see automatic pop-up"
              >
                <span>⚡</span>
                <span>Simulate Failover Test (Pop-up Demo)</span>
              </button>

              <button
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-[#BF953F] hover:bg-[#AA771C] text-black font-mono transition-all"
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
