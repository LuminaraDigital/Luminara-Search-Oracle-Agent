import React from 'react';
import { OracleMindConfig, LoRAAdapter, GenerationResult } from '../../../types';
import { ICONS } from '../../../constants';
import { renderMarkdown } from '../../../utils/markdown';

interface NeuralPlaygroundTabProps {
  presets: OracleMindConfig[];
  selectedPresetId: string;
  onSelectPresetId: (id: string) => void;
  activePreset: OracleMindConfig;
  adapters: LoRAAdapter[];
  selectedLoraId: string;
  onSelectLoraId: (id: string) => void;
  temperature: number;
  setTemperature: (t: number) => void;
  topP: number;
  setTopP: (p: number) => void;
  enableReasoning: boolean;
  setEnableReasoning: (v: boolean) => void;
  promptInput: string;
  setPromptInput: (p: string) => void;
  handleRunInference: () => void;
  isGenerating: boolean;
  lastResult: GenerationResult | null;
  streamedThought: string;
  showThought: boolean;
  setShowThought: (v: boolean) => void;
  streamedText: string;
}

export const NeuralPlaygroundTab: React.FC<NeuralPlaygroundTabProps> = ({
  presets,
  selectedPresetId,
  onSelectPresetId,
  activePreset,
  adapters,
  selectedLoraId,
  onSelectLoraId,
  temperature,
  setTemperature,
  topP,
  setTopP,
  enableReasoning,
  setEnableReasoning,
  promptInput,
  setPromptInput,
  handleRunInference,
  isGenerating,
  lastResult,
  streamedThought,
  showThought,
  setShowThought,
  streamedText,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
      {/* Left Column: Configuration Controls */}
      <div className="lg:col-span-4 space-y-5">
        {/* Architecture Selector */}
        <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
              <ICONS.Cpu className="w-4 h-4 text-gold" />
              <span>Model Architecture</span>
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-300">
              {activePreset.totalParams}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onSelectPresetId(preset.id)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  selectedPresetId === preset.id
                    ? 'border-gold bg-gold/15 text-white shadow-[0_0_15px_rgba(191,149,63,0.15)]'
                    : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between font-bold text-xs">
                  <span className={selectedPresetId === preset.id ? 'text-gold-light' : ''}>
                    {preset.name}
                  </span>
                  <span className="font-mono text-[10px] text-gray-400">
                    {preset.numLayers}L / {preset.numHeads}H
                  </span>
                </div>
                <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">
                  {preset.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* LoRA Adapter Selector */}
        <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
              <ICONS.Layers className="w-4 h-4 text-gold" />
              <span>Domain LoRA Adapters</span>
            </h3>
            <span className="text-[10px] font-mono text-gold">PEFT Hot-Swap</span>
          </div>

          <div className="space-y-2">
            {adapters.map((adapter) => (
              <div
                key={adapter.id}
                onClick={() => onSelectLoraId(adapter.id)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedLoraId === adapter.id
                    ? 'border-gold/60 bg-gold/10 text-white shadow-sm'
                    : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className={selectedLoraId === adapter.id ? 'text-gold-light' : ''}>
                    {adapter.name}
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gold">
                    r={adapter.rank}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {adapter.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Sampling Parameters */}
        <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-gold-light">
            Sampling & Reasoning
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between text-gray-400 mb-1">
                <span>Temperature</span>
                <span className="font-mono text-gold-light">{temperature}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-gold"
              />
            </div>

            <div>
              <div className="flex justify-between text-gray-400 mb-1">
                <span>Top-P (Nucleus)</span>
                <span className="font-mono text-gold-light">{topP}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={topP}
                onChange={(e) => setTopP(parseFloat(e.target.value))}
                className="w-full accent-gold"
              />
            </div>

            {/* Reasoning CoT Toggle */}
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <span className="text-gray-300 font-medium">Chain-of-Thought (&lt;think&gt;)</span>
              <button
                onClick={() => setEnableReasoning(!enableReasoning)}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  enableReasoning ? 'bg-gold' : 'bg-gray-700'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform transform ${
                    enableReasoning ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Playground Interaction & Telemetry */}
      <div className="lg:col-span-8 space-y-5 flex flex-col">
        {/* Prompt Input Box */}
        <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-widest text-gold-light">
              Inference Prompt
            </span>
            <div className="flex gap-1.5 overflow-x-auto">
              {[
                { label: 'Schema JSON-LD', text: 'Generate Schema.org Organization JSON-LD markup and outline our primary AEO citation advantage.' },
                { label: 'AEO Definition', text: 'Define Answer Engine Optimization in under 40 words for featured snippet placement.' },
                { label: 'Plain English', text: 'Translate technical Core Web Vitals into a grade-8 plain-English action summary for the CEO.' }
              ].map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => setPromptInput(preset.text)}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-gold/20 text-gray-300 hover:text-gold-light transition-colors whitespace-nowrap"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            rows={3}
            className="w-full bg-black/80 border border-white/10 rounded-xl p-3 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gold transition-all resize-none"
            placeholder="Enter a prompt for OracleMind..."
          />

          <div className="flex items-center justify-between">
            <div className="text-[11px] text-gray-500 font-mono">
              Active Architecture: <span className="text-gray-300 font-bold">{activePreset.name}</span>
            </div>
            <button
              onClick={handleRunInference}
              disabled={isGenerating || !promptInput.trim()}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black text-xs uppercase tracking-wider hover:opacity-95 active:scale-95 transition-all shadow-[0_0_20px_rgba(191,149,63,0.3)] disabled:opacity-40 flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span>Streaming Tokens...</span>
                </>
              ) : (
                <>
                  <ICONS.Sparkle className="w-3.5 h-3.5 text-black" />
                  <span>Execute Inference</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Streaming Output Display */}
        <div className="flex-1 glass-morphism rounded-2xl border border-white/10 p-5 bg-black/70 flex flex-col min-h-[360px] space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
              <span className="text-xs font-black uppercase tracking-widest text-gold-light">
                Live Output Stream
              </span>
            </div>

            {lastResult && (
              <div className="flex items-center gap-4 text-[10px] font-mono text-gray-400">
                <span>TTFT: <strong className="text-gold-light">{lastResult.timeToFirstTokenMs}ms</strong></span>
                <span>Speed: <strong className="text-success-400">{lastResult.tokensPerSecond} tok/s</strong></span>
                <span>KV-Cache: <strong className="text-sky-400">{lastResult.kvCacheSizeMb} MB</strong></span>
              </div>
            )}
          </div>

          {/* Reasoning Block */}
          {streamedThought && (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-3 space-y-1 text-xs">
              <div
                onClick={() => setShowThought(!showThought)}
                className="flex items-center justify-between cursor-pointer text-[10px] font-bold text-gold-light uppercase tracking-wider"
              >
                <span className="flex items-center gap-1.5">
                  <ICONS.Brain className="w-3.5 h-3.5" />
                  <span>Reasoning Chain (&lt;think&gt;)</span>
                </span>
                <span>{showThought ? '▲ Hide' : '▼ Expand'}</span>
              </div>
              {showThought && (
                <pre className="font-mono text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed mt-2 border-t border-white/5 pt-2">
                  {streamedThought}
                </pre>
              )}
            </div>
          )}

          {/* Markdown Formatted Text */}
          <div className="flex-1 overflow-y-auto text-xs leading-relaxed text-gray-300">
            {streamedText ? (
              <div
                className="prose prose-invert max-w-none text-xs"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(streamedText) }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-600 text-xs italic">
                {isGenerating ? 'Generating response...' : 'Run inference to observe low-latency token streaming.'}
              </div>
            )}
          </div>
        </div>

        {/* Real-time MoE Routing Breakdown */}
        {activePreset.useMoe && lastResult?.expertActivations && (
          <div className="glass-morphism rounded-2xl border border-white/10 p-4 bg-black/60">
            <div className="flex items-center justify-between mb-3 text-xs">
              <span className="font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
                <ICONS.Network className="w-4 h-4 text-gold" />
                <span>MoE Expert Token Routing</span>
              </span>
              <span className="text-[10px] text-gray-500 font-mono">Dynamic Dispatch</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {lastResult.expertActivations.map((exp) => (
                <div key={exp.expertId} className="p-2.5 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="font-bold text-gray-300 truncate">{exp.expertName}</span>
                    <span className="font-mono text-gold-light">{exp.percentage}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-gold to-gold-light rounded-full"
                      style={{ width: `${exp.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
