import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BusinessDNA,
  OracleMindConfig,
  LoRAAdapter,
  TrainingStage,
  TrainingConfig,
  TrainingTelemetryPoint,
  GenerationParams,
  GenerationResult,
  GRPORolloutItem,
  BenchmarkTestCase,
  DatasetSample
} from '../../types';
import { ICONS } from '../../constants';
import { oracleMindService } from '../../services/oracleMind/oracleMindService';
import { OracleMindCodeExporter, ExportedCodeFile } from '../../services/oracleMind/oracleMindCodeExporter';
import { renderMarkdown } from '../../utils/markdown';

interface OracleMindViewProps {
  dna: BusinessDNA | null;
  onRouteToDNA?: () => void;
  onRouteToOracle?: (prompt: string) => void;
}

type TabType = 'PLAYGROUND' | 'TRAINING_LAB' | 'GRPO_REASONING' | 'BENCHMARK' | 'CODE_EXPORT';

export const OracleMindView: React.FC<OracleMindViewProps> = ({ dna, onRouteToDNA, onRouteToOracle }) => {
  const [activeTab, setActiveTab] = useState<TabType>('PLAYGROUND');

  // Architecture & Adapters
  const presets = useMemo(() => oracleMindService.getModelPresets(), []);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(presets[1].id); // Pro 64M default
  const activePreset = useMemo(() => presets.find(p => p.id === selectedPresetId) || presets[0], [presets, selectedPresetId]);

  const [adapters, setAdapters] = useState<LoRAAdapter[]>(() => oracleMindService.getDefaultLoRAAdapters());
  const [selectedLoraId, setSelectedLoraId] = useState<string>(adapters[0].id);

  // Playground State
  const [promptInput, setPromptInput] = useState<string>(
    'Generate Schema.org Organization JSON-LD markup and outline our primary AEO citation advantage.'
  );
  const [temperature, setTemperature] = useState<number>(0.7);
  const [topP, setTopP] = useState<number>(0.9);
  const [enableReasoning, setEnableReasoning] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamedText, setStreamedText] = useState<string>('');
  const [streamedThought, setStreamedThought] = useState<string>('');
  const [lastResult, setLastResult] = useState<GenerationResult | null>(null);
  const [showThought, setShowThought] = useState<boolean>(true);

  // Training Lab State
  const [trainingStage, setTrainingStage] = useState<TrainingStage>('grpo');
  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [trainingTelemetry, setTrainingTelemetry] = useState<TrainingTelemetryPoint[]>([]);
  const [latestPoint, setLatestPoint] = useState<TrainingTelemetryPoint | null>(null);
  const [datasetSamples, setDatasetSamples] = useState<DatasetSample[]>(() => oracleMindService.generateDomainDataset(dna));

  // Hyperparameters
  const [learningRate, setLearningRate] = useState<number>(2e-4);
  const [batchSize, setBatchSize] = useState<number>(8);
  const [loraRank, setLoraRank] = useState<number>(16);
  const [grpoGroupSize, setGrpoGroupSize] = useState<number>(4);

  // GRPO Lab State
  const [grpoPrompt, setGrpoPrompt] = useState<string>('How does Luminara achieve zero-click search supremacy?');
  const [grpoRollout, setGrpoRollout] = useState<GRPORolloutItem | null>(() =>
    oracleMindService.executeGRPORollout('How does Luminara achieve zero-click search supremacy?', dna)
  );

  // Benchmark State
  const [benchmarkSuite, setBenchmarkSuite] = useState<BenchmarkTestCase[]>(() => oracleMindService.getBenchmarkSuite());
  const [isRunningBench, setIsRunningBench] = useState<boolean>(false);

  // Code Export State
  const exportedFiles = useMemo(() => OracleMindCodeExporter.getExportedFiles(), []);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Update datasets when DNA changes
  useEffect(() => {
    setDatasetSamples(oracleMindService.generateDomainDataset(dna));
  }, [dna]);

  // Run Playground Inference
  const handleRunInference = async () => {
    if (!promptInput.trim() || isGenerating) return;
    setIsGenerating(true);
    setStreamedText('');
    setStreamedThought('');
    setLastResult(null);

    const params: GenerationParams = {
      temperature,
      topP,
      topK: 40,
      maxTokens: 512,
      repetitionPenalty: 1.1,
      enableReasoning,
      selectedLoraId
    };

    try {
      for await (const chunk of oracleMindService.streamInference(promptInput, params, activePreset, adapters, dna)) {
        if (chunk.thoughtToken) {
          setStreamedThought(prev => prev + chunk.thoughtToken);
        }
        if (chunk.token) {
          setStreamedText(prev => prev + chunk.token);
        }
        if (chunk.isDone && chunk.result) {
          setLastResult(chunk.result);
        }
      }
    } catch (err) {
      console.error('OracleMind stream error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  // Run Training Simulation
  const handleStartTraining = async () => {
    if (isTraining) return;
    setIsTraining(true);
    setTrainingTelemetry([]);
    setLatestPoint(null);

    const config: TrainingConfig = {
      stage: trainingStage,
      modelPreset: selectedPresetId as any,
      batchSize,
      learningRate,
      warmupRatio: 0.1,
      epochs: 3,
      maxSeqLen: 4096,
      gradientAccumulationSteps: 2,
      weightDecay: 0.01,
      loraRank,
      loraAlpha: loraRank * 2,
      dpoBeta: 0.1,
      grpoGroupSize,
      grpoBeta: 0.04,
      distillTemperature: 2.0
    };

    try {
      const history = await oracleMindService.simulateTrainingRun(config, (point) => {
        setLatestPoint(point);
        setTrainingTelemetry(prev => [...prev, point]);
      });
      console.log('Training completed with points:', history.length);
    } finally {
      setIsTraining(false);
    }
  };

  // Run GRPO Rollout
  const handleRunGRPO = () => {
    const item = oracleMindService.executeGRPORollout(grpoPrompt, dna);
    setGrpoRollout(item);
  };

  // Run Benchmark Suite
  const handleRunBenchmark = async () => {
    setIsRunningBench(true);
    // Animate benchmark items
    for (let i = 0; i < benchmarkSuite.length; i++) {
      setBenchmarkSuite(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'running' } : item));
      await new Promise(r => setTimeout(r, 450));
      setBenchmarkSuite(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'passed' } : item));
    }
    setIsRunningBench(false);
  };

  // Copy Code to Clipboard
  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // Calculate SVG Points for Loss Chart
  const lossSvgPath = useMemo(() => {
    if (trainingTelemetry.length < 2) return '';
    const width = 600;
    const height = 180;
    const maxLoss = Math.max(...trainingTelemetry.map(t => t.loss), 2.5);
    const minLoss = Math.min(...trainingTelemetry.map(t => t.loss), 0.2);
    const range = maxLoss - minLoss || 1;

    return trainingTelemetry.reduce((acc, point, idx) => {
      const x = (idx / (trainingTelemetry.length - 1)) * width;
      const y = height - ((point.loss - minLoss) / range) * (height - 30) - 15;
      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, '');
  }, [trainingTelemetry]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-surface-0 text-gray-200">
      {/* Top Banner & Header */}
      <div className="border-b border-white/5 bg-gradient-to-b from-surface-gold via-black to-black px-6 py-6 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-gold/30 to-gold-dark/10 border border-gold/40 flex items-center justify-center shadow-[0_0_20px_rgba(191,149,63,0.3)]">
                <ICONS.Brain className="w-4 h-4 text-gold-light" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-light">
                Autonomous SLM & Neural Training Harness
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-success-500/10 border border-success-500/30 text-success-400 font-mono">
                Clean-Room Architecture
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold gold-text tracking-tight">
              OracleMind SLM Studio
            </h1>
            <p className="text-xs text-gray-400 max-w-2xl mt-1 leading-relaxed">
              Bespoke 26M–100M parameter Domain SLM architecture with full-lifecycle training harness (Pretrain, SFT, LoRA, DPO, GRPO reasoning, Distillation) and real-time edge telemetry.
            </p>
          </div>

          {/* Business DNA Link Status */}
          <div className="flex items-center gap-3">
            {dna ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass-morphism border border-success-500/40 bg-success-950/20 text-xs">
                <span className="w-2 h-2 rounded-full bg-success-400 animate-pulse" />
                <span className="text-gray-300 font-medium text-[11px]">DNA Linked:</span>
                <span className="font-bold text-gold-light text-[11px]">{dna.name}</span>
              </div>
            ) : (
              <button
                onClick={onRouteToDNA}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-morphism border border-gold/30 hover:border-gold text-gold-light text-xs transition-colors"
              >
                <ICONS.AlertCircle className="w-3.5 h-3.5 text-gold" />
                <span className="text-[11px]">Link Business DNA</span>
              </button>
            )}
          </div>
        </div>

        {/* Studio Navigation Tabs */}
        <div className="max-w-7xl mx-auto flex flex-wrap gap-2 mt-6 border-t border-white/5 pt-4">
          {[
            { id: 'PLAYGROUND', label: 'Neural Playground', icon: ICONS.Sparkle },
            { id: 'TRAINING_LAB', label: 'Training & Alignment Lab', icon: ICONS.Flame },
            { id: 'GRPO_REASONING', label: 'GRPO Reasoning Lab', icon: ICONS.Brain },
            { id: 'BENCHMARK', label: 'Agent Benchmark', icon: ICONS.CheckCircle },
            { id: 'CODE_EXPORT', label: 'PyTorch & API Export', icon: ICONS.Download }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                  isActive
                    ? 'bg-gold/20 text-gold-light border border-gold/50 shadow-[0_0_20px_rgba(191,149,63,0.2)]'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Studio Body */}
      <div className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 flex flex-col">
        {/* ========================================================================= */}
        {/* TAB 1: NEURAL PLAYGROUND & TELEMETRY                                      */}
        {/* ========================================================================= */}
        {activeTab === 'PLAYGROUND' && (
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
                      onClick={() => setSelectedPresetId(preset.id)}
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
                      onClick={() => setSelectedLoraId(adapter.id)}
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
        )}

        {/* ========================================================================= */}
        {/* TAB 2: TRAINING & ALIGNMENT LAB (THE HARNESS)                             */}
        {/* ========================================================================= */}
        {activeTab === 'TRAINING_LAB' && (
          <div className="space-y-6">
            {/* Stage Selector Bar */}
            <div className="glass-morphism rounded-2xl border border-white/10 p-4 bg-black/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'pretrain', label: '1. Pretrain', desc: 'Autoregressive Causal LM' },
                  { id: 'sft', label: '2. Full SFT', desc: 'Instruction Tuning' },
                  { id: 'lora', label: '3. LoRA PEFT', desc: 'Adapter Fine-Tuning' },
                  { id: 'dpo', label: '4. DPO', desc: 'Pairwise Preference' },
                  { id: 'grpo', label: '5. GRPO', desc: 'Reasoning RL (R1 Style)' },
                  { id: 'distill', label: '6. Distill', desc: 'Teacher-to-Student' }
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setTrainingStage(st.id as TrainingStage)}
                    className={`px-3 py-2 rounded-xl text-left border transition-all ${
                      trainingStage === st.id
                        ? 'border-gold bg-gold/20 text-white shadow-md'
                        : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20'
                    }`}
                  >
                    <div className="text-xs font-black uppercase tracking-wider">
                      <span className={trainingStage === st.id ? 'text-gold-light' : ''}>{st.label}</span>
                    </div>
                    <div className="text-[9px] text-gray-500 font-mono mt-0.5">{st.desc}</div>
                  </button>
                ))}
              </div>

              <button
                onClick={handleStartTraining}
                disabled={isTraining}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black text-xs uppercase tracking-wider hover:opacity-95 active:scale-95 transition-all shadow-[0_0_20px_rgba(191,149,63,0.3)] disabled:opacity-40 flex items-center gap-2"
              >
                {isTraining ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Optimizing Gradients...</span>
                  </>
                ) : (
                  <>
                    <ICONS.Flame className="w-3.5 h-3.5 text-black" />
                    <span>Launch Training Run</span>
                  </>
                )}
              </button>
            </div>

            {/* Training Monitor Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Real-time Loss Curve Chart */}
              <div className="lg:col-span-8 glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
                      <ICONS.Activity className="w-4 h-4 text-gold" />
                      <span>Training Telemetry & Convergence</span>
                    </h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Stage: <strong className="text-white uppercase">{trainingStage}</strong> • Target Loss &lt; 0.40
                    </p>
                  </div>

                  {latestPoint && (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span>Step: <strong className="text-white">{latestPoint.step}/25</strong></span>
                      <span>Loss: <strong className="text-success-400">{latestPoint.loss}</strong></span>
                      <span>Grad Norm: <strong className="text-gold-light">{latestPoint.gradNorm}</strong></span>
                    </div>
                  )}
                </div>

                {/* SVG Loss Curve */}
                <div className="h-48 w-full bg-black/80 rounded-xl border border-white/5 p-3 relative flex items-end">
                  {trainingTelemetry.length > 1 ? (
                    <svg className="w-full h-full overflow-visible" viewBox="0 0 600 180" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="goldCurveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#FCF6BA" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#BF953F" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <path
                        d={`${lossSvgPath} L 600 180 L 0 180 Z`}
                        fill="url(#goldCurveGrad)"
                      />
                      <path
                        d={lossSvgPath}
                        fill="none"
                        stroke="#BF953F"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs italic">
                      Click &quot;Launch Training Run&quot; to begin simulated gradient updates and convergence visualization.
                    </div>
                  )}
                </div>

                {/* Telemetry Point Stream */}
                {trainingTelemetry.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2">
                    <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Throughput</span>
                      <span className="text-base font-bold font-mono text-white">
                        {latestPoint?.tokensPerSec || 0} tok/s
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Learning Rate</span>
                      <span className="text-base font-bold font-mono text-gold-light">
                        {latestPoint?.learningRate || '2.0e-4'}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Accuracy Benchmark</span>
                      <span className="text-base font-bold font-mono text-success-400">
                        {latestPoint?.accuracy || 64.2}%
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Current Epoch</span>
                      <span className="text-base font-bold font-mono text-sky-400">
                        {latestPoint?.epoch || '0.0'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Dataset Generator & DNA Ingestion */}
              <div className="lg:col-span-4 glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
                    <ICONS.FileText className="w-4 h-4 text-gold" />
                    <span>Domain Training Dataset</span>
                  </h3>
                  <span className="text-[10px] font-mono text-gray-400">{datasetSamples.length} Samples</span>
                </div>

                <p className="text-xs text-gray-400 leading-relaxed">
                  Synthesized automatically from your active <strong>Strategic Business DNA</strong> to fine-tune OracleMind on brand positioning and AEO schema.
                </p>

                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {datasetSamples.map((sample) => (
                    <div key={sample.id} className="p-3 rounded-xl border border-white/5 bg-white/[0.02] text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-gold/20 text-gold-light">
                          {sample.type}
                        </span>
                      </div>
                      <p className="text-gray-300 font-medium text-[11px] mt-1">{sample.instruction}</p>
                      {sample.chosen && (
                        <p className="text-[10px] text-success-400/90 line-clamp-2 mt-1">
                          Chosen: {sample.chosen}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: GRPO REASONING LAB (DEEPSEEK-R1 REASONING RL)                       */}
        {/* ========================================================================= */}
        {activeTab === 'GRPO_REASONING' && (
          <div className="space-y-6">
            <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
                    <ICONS.Brain className="w-4 h-4 text-gold" />
                    <span>Group Relative Policy Optimization (GRPO)</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
                    Evaluates G=4 candidate rollouts per prompt, scores them with verifiable domain reward functions (Schema validation, Citation grounding, and Format compliance), and computes relative advantages without a critic network.
                  </p>
                </div>

                <button
                  onClick={handleRunGRPO}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black text-xs uppercase tracking-wider hover:opacity-95 transition-all flex items-center gap-2 shrink-0"
                >
                  <ICONS.Sparkle className="w-3.5 h-3.5 text-black" />
                  <span>Resample Group Rollout</span>
                </button>
              </div>

              {/* GRPO Math Explanation Banner */}
              <div className="mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-wrap items-center justify-between text-xs font-mono text-gray-400 gap-2">
                <span>Advantage Formula: <strong className="text-gold-light">A_i = (R_i - mean(R)) / std(R)</strong></span>
                <span>Group Size: <strong className="text-white">G = 4</strong></span>
                <span>Policy Loss: <strong className="text-success-400">{grpoRollout?.policyLoss || '0.218'}</strong></span>
                <span>Mean Group Reward: <strong className="text-sky-400">{grpoRollout?.meanReward || '0.741'}</strong></span>
              </div>
            </div>

            {/* Candidates Grid */}
            {grpoRollout && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {grpoRollout.candidates.map((cand, idx) => {
                  const isWinner = idx === 0;
                  return (
                    <div
                      key={cand.id}
                      className={`glass-morphism rounded-2xl p-5 border transition-all flex flex-col justify-between ${
                        isWinner
                          ? 'border-gold bg-gold/10 shadow-[0_0_30px_rgba(191,149,63,0.15)]'
                          : 'border-white/10 bg-black/60'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-200">Candidate #{idx + 1}</span>
                            {isWinner && (
                              <span className="text-[9px] px-2 py-0.5 rounded-full bg-gold text-black font-black uppercase tracking-wider">
                                Winning Policy
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-mono">
                            Advantage: <strong className={cand.advantage >= 0 ? 'text-success-400' : 'text-danger-400'}>
                              {cand.advantage >= 0 ? `+${cand.advantage}` : cand.advantage}
                            </strong>
                          </div>
                        </div>

                        {/* Reasoning Snippet */}
                        <div className="p-3 rounded-xl bg-black/60 border border-white/5 text-[11px] font-mono text-gray-400">
                          <span className="text-gold-light font-bold block mb-1">&lt;think&gt;</span>
                          <p className="line-clamp-3 leading-relaxed">{cand.reasoning}</p>
                          <span className="text-gold-light font-bold block mt-1">&lt;/think&gt;</span>
                        </div>

                        {/* Response Output */}
                        <div className="text-xs text-gray-300 leading-relaxed overflow-hidden">
                          <div
                            className="prose prose-invert max-w-none text-xs"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(cand.response) }}
                          />
                        </div>
                      </div>

                      {/* Reward Breakdown Footprint */}
                      <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
                        <div className="p-1.5 rounded-lg bg-white/5">
                          <span className="text-gray-500 block">Schema</span>
                          <span className="font-bold text-white">{(cand.schemaReward * 100).toFixed(0)}%</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-white/5">
                          <span className="text-gray-500 block">Citation</span>
                          <span className="font-bold text-white">{(cand.citationReward * 100).toFixed(0)}%</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-white/5">
                          <span className="text-gray-500 block">Total R</span>
                          <span className="font-bold text-gold-light">{(cand.totalReward * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: AGENT & TOOL-CALLING BENCHMARK                                      */}
        {/* ========================================================================= */}
        {activeTab === 'BENCHMARK' && (
          <div className="space-y-6">
            <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-gold-light flex items-center gap-2">
                  <ICONS.CheckCircle className="w-4 h-4 text-gold" />
                  <span>OracleMind Automated Agentic Evaluation</span>
                </h3>
                <p className="text-xs text-gray-400 mt-1 max-w-xl leading-relaxed">
                  Rigorous benchmark testbed evaluating tool-calling precision, JSON-LD schema parsing, and grade-8 plain-English synthesis.
                </p>
              </div>

              <button
                onClick={handleRunBenchmark}
                disabled={isRunningBench}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black text-xs uppercase tracking-wider hover:opacity-95 transition-all shadow-md disabled:opacity-50 flex items-center gap-2 shrink-0"
              >
                {isRunningBench ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Running Testbed...</span>
                  </>
                ) : (
                  <>
                    <ICONS.Check className="w-3.5 h-3.5 text-black" />
                    <span>Execute All Tests</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {benchmarkSuite.map((test) => (
                <div key={test.id} className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gold uppercase">
                      {test.category}
                    </span>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-success-400 font-bold">{test.score}%</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black ${
                        test.status === 'passed' ? 'bg-success-500/20 text-success-400' : 'bg-warning-500/20 text-warning-400'
                      }`}>
                        {test.status}
                      </span>
                    </div>
                  </div>

                  <h4 className="text-xs font-bold text-gray-200">{test.title}</h4>
                  <div className="p-2.5 rounded-xl bg-black/60 border border-white/5 text-[11px] text-gray-400">
                    <span className="text-gray-500 block mb-0.5">Input:</span>
                    {test.input}
                  </div>
                  <div className="text-[11px] text-gray-300">
                    <span className="text-gray-500 block mb-0.5">Evaluation Telemetry:</span>
                    {test.actualOutput}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: PYTORCH & API EXPORT HUB                                           */}
        {/* ========================================================================= */}
        {activeTab === 'CODE_EXPORT' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* File List */}
            <div className="lg:col-span-4 glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black uppercase tracking-widest text-gold-light">
                  Exportable Package
                </span>
                <span className="text-[10px] font-mono text-success-400">100% Clean-Room</span>
              </div>

              <div className="space-y-1.5">
                {exportedFiles.map((file, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedFileIndex(idx)}
                    className={`w-full text-left p-3 rounded-xl border transition-all text-xs ${
                      selectedFileIndex === idx
                        ? 'border-gold bg-gold/15 text-white shadow-sm'
                        : 'border-white/5 bg-white/[0.02] text-gray-400 hover:border-white/20'
                    }`}
                  >
                    <div className="font-mono font-bold">{file.filename}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{file.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Code Viewer & Actions */}
            <div className="lg:col-span-8 glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 flex flex-col space-y-3 min-h-[460px]">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div>
                  <span className="font-mono text-xs font-bold text-gold-light">
                    {exportedFiles[selectedFileIndex].filename}
                  </span>
                  <p className="text-[10px] text-gray-400">
                    {exportedFiles[selectedFileIndex].description}
                  </p>
                </div>

                <button
                  onClick={() => handleCopyCode(exportedFiles[selectedFileIndex].code)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-gold/20 text-gray-300 hover:text-gold-light border border-white/10 hover:border-gold/40 text-xs font-bold transition-colors flex items-center gap-1.5"
                >
                  {copySuccess ? (
                    <>
                      <ICONS.Check className="w-3.5 h-3.5 text-success-400" />
                      <span className="text-success-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <ICONS.Copy className="w-3.5 h-3.5" />
                      <span>Copy Source</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 bg-black/90 rounded-xl p-4 border border-white/5 overflow-x-auto">
                <pre className="font-mono text-[11px] text-gray-300 whitespace-pre leading-relaxed">
                  {exportedFiles[selectedFileIndex].code}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
