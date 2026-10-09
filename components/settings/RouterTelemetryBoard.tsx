import React, { useEffect, useState } from 'react';
import { ICONS } from '../ui/icons';
import { 
  emptyInferenceRouterUsage, 
  USAGE_STORAGE_KEY 
} from '../../services/aiProviderService';
import type { InferenceRouterUsage } from '../../types';

export const RouterTelemetryBoard: React.FC = () => {
  const [usage, setUsage] = useState<InferenceRouterUsage>(() => {
    try {
      const raw = localStorage.getItem(USAGE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : emptyInferenceRouterUsage();
    } catch {
      return emptyInferenceRouterUsage();
    }
  });

  useEffect(() => {
    const handleUpdate = () => {
      try {
        const raw = localStorage.getItem(USAGE_STORAGE_KEY);
        if (raw) setUsage(JSON.parse(raw));
      } catch {
        // ignore
      }
    };

    window.addEventListener('storage', handleUpdate);
    const interval = setInterval(handleUpdate, 3000);
    return () => {
      window.removeEventListener('storage', handleUpdate);
      clearInterval(interval);
    };
  }, []);

  const totalRequests = usage.totals.requests || 0;
  const totalTokens = (usage.totals.inputTokens || 0) + (usage.totals.outputTokens || 0);
  const totalCost = usage.totals.estimatedCostUsd || 0;

  // Provider display config with standard Tailwind semantic classes
  const providerDisplay: Record<string, { label: string; colorClass: string }> = {
    groq: { label: 'Groq LPU (gpt-oss-120b)', colorClass: 'bg-emerald-500' },
    nim: { label: 'NVIDIA NIM Enterprise', colorClass: 'bg-lime-500' },
    ollama: { label: 'Ollama Local / Sovereign', colorClass: 'bg-sky-500' },
    openrouter: { label: 'OpenRouter Multi-Model', colorClass: 'bg-purple-500' },
    freellm: { label: 'FreeLLM BYOK Gateway', colorClass: 'bg-amber-500' },
  };

  const providers = Object.entries(usage.providers).map(([key, data]) => {
    const share = totalRequests > 0 ? (data.requests / totalRequests) * 100 : 0;
    return {
      id: key,
      label: providerDisplay[key]?.label || key,
      colorClass: providerDisplay[key]?.colorClass || 'bg-slate-500',
      requests: data.requests,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.inputTokens + data.outputTokens,
      averageLatencyMs: data.averageLatencyMs,
      estimatedCostUsd: data.estimatedCostUsd,
      share: Number(share.toFixed(1)),
    };
  }).sort((a, b) => b.requests - a.requests);

  // Approximate commercial savings compared to standard proprietary API rates ($5/M tokens)
  const estimatedSavingsUsd = Math.max(0, (totalTokens / 1_000_000) * 5.0 - totalCost);

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-ink backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <ICONS.Cpu className="h-4 w-4 text-emerald-400" />
          <h4 className="text-sm font-semibold text-white">AI Inference Router Board</h4>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-400">
            Telemetry
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Zero-Loss Gateway Protected
          </span>
        </div>
      </div>

      {/* Aggregate Stats */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/5 bg-black/40 p-2.5">
          <span className="text-[11px] text-ink-muted">Total Requests</span>
          <p className="mt-0.5 font-mono text-base font-semibold text-white">{totalRequests.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/40 p-2.5">
          <span className="text-[11px] text-ink-muted">Tokens Processed</span>
          <p className="mt-0.5 font-mono text-base font-semibold text-white">
            {totalTokens >= 1_000_000 
              ? `${(totalTokens / 1_000_000).toFixed(2)}M` 
              : totalTokens >= 1_000 
                ? `${(totalTokens / 1_000).toFixed(1)}k` 
                : totalTokens.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/40 p-2.5">
          <span className="text-[11px] text-ink-muted">Estimated Cost</span>
          <p className="mt-0.5 font-mono text-base font-semibold text-emerald-400">
            ${totalCost.toFixed(4)}
          </p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/40 p-2.5">
          <span className="text-[11px] text-ink-muted">Open-Weights Savings</span>
          <p className="mt-0.5 font-mono text-base font-semibold text-gold">
            ${estimatedSavingsUsd.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Model Share Table */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-ink-muted pb-1 border-b border-white/5">
          <span>Provider / Engine</span>
          <div className="flex items-center gap-6">
            <span className="hidden sm:inline">Latency</span>
            <span>Share</span>
          </div>
        </div>

        <div className="divide-y divide-white/5">
          {providers.map((p) => (
            <div key={p.id} className="py-2 flex items-center justify-between text-xs">
              <div className="flex-1 pr-3">
                <div className="flex items-center gap-2">
                  <span 
                    className={`h-2 w-2 rounded-full shrink-0 ${p.colorClass}`} 
                  />
                  <span className="font-medium text-white truncate">{p.label}</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${p.colorClass}`} 
                    style={{ 
                      width: `${p.share}%` 
                    }} 
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 text-right font-mono">
                <span className="hidden sm:inline text-ink-muted text-[11px]">
                  {p.averageLatencyMs > 0 ? `${p.averageLatencyMs}ms` : '-'}
                </span>
                <span className="font-medium text-white w-10 text-right">
                  {p.share}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
