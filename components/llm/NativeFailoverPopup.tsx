import React, { useState, useEffect } from 'react';
import { NativeFailoverEvent } from '../../types';
import { toUserFacingText } from '../../utils/userFacingText';

export const NativeFailoverPopup: React.FC = () => {
  const [currentEvent, setCurrentEvent] = useState<NativeFailoverEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [history, setHistory] = useState<NativeFailoverEvent[]>([]);

  useEffect(() => {
    const handleFailover = (e: Event) => {
      const customEvent = e as CustomEvent<NativeFailoverEvent>;
      if (customEvent.detail) {
        setCurrentEvent(customEvent.detail);
        setHistory(prev => [customEvent.detail, ...prev].slice(0, 5));
        setIsVisible(true);
      }
    };

    const checkHash = () => {
      if (window.location.hash.toUpperCase().includes('FAILOVER')) {
        setCurrentEvent({
          failedProvider: 'Groq Cloud LPU',
          failedModel: 'openai/gpt-oss-120b',
          reason: 'HTTP 429 Rate Limit Exceeded (Auto Key Rotation Exhausted)',
          activatedProvider: 'NVIDIA NIM Enterprise',
          activatedModel: 'meta/llama-3.2-11b-vision-instruct',
          latencyMs: 142,
          timestamp: Date.now()
        });
        setIsVisible(true);
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);

    window.addEventListener('luminara-llm-failover', handleFailover);
    return () => {
      window.removeEventListener('luminara-llm-failover', handleFailover);
      window.removeEventListener('hashchange', checkHash);
    };
  }, []);

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 6000);
    return () => clearTimeout(timer);
  }, [isVisible, currentEvent]);

  if (!isVisible || !currentEvent) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] max-w-md w-full animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="relative rounded-2xl p-4 bg-black/95 border border-gold/60 shadow-[0_10px_40px_rgba(0,0,0,0.8),0_0_25px_rgba(191,149,63,0.3)] backdrop-blur-xl">
        {/* Glowing top line */}
        <div className="absolute top-0 left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-gold-light to-transparent" />

        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning-500"></span>
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold text-gold-light">
              Automatic Failover Activated
            </span>
          </div>

          <button
            onClick={() => setIsVisible(false)}
            className="text-gray-500 hover:text-white text-xs transition-colors p-1"
            title="Dismiss"
          >
            ✕
          </button>
        </div>

        {/* Failover Body */}
        <div className="space-y-2 text-xs">
          <div className="p-2.5 rounded-xl bg-danger-950/30 border border-danger-500/20 flex items-start gap-2">
            <span className="text-danger-400 font-mono text-sm">⚠</span>
            <div className="flex-1">
              <div className="text-[10px] text-danger-300 font-mono uppercase">Interrupted Engine</div>
              <div className="text-gray-200 font-semibold">{currentEvent.failedProvider}</div>
              <div className="text-[10px] text-danger-400/80 font-mono truncate">{toUserFacingText(currentEvent.reason, 'Execution error')}</div>
            </div>
          </div>

          <div className="flex justify-center -my-1 text-gold font-mono text-xs">
            <span>↓ Auto Pop-up Handoff ↓</span>
          </div>

          <div className="p-2.5 rounded-xl bg-success-950/30 border border-success-500/30 flex items-start gap-2">
            <span className="text-success-400 font-mono text-sm">⚡</span>
            <div className="flex-1">
              <div className="text-[10px] text-success-300 font-mono uppercase flex items-center justify-between">
                <span>Active Engine Engaged</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-success-500/20 text-success-300 font-bold">100% ONLINE</span>
              </div>
              <div className="text-gold-light font-bold">{currentEvent.activatedProvider}</div>
              <div className="text-[10px] text-gray-400 font-mono">{currentEvent.activatedModel}</div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-400 font-mono">
          <span>Seamless transition in {currentEvent.latencyMs}ms</span>
          <span className="text-gold font-semibold">Zero Query Loss</span>
        </div>
      </div>
    </div>
  );
};
