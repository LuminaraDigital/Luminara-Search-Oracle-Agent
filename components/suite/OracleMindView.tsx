import React, { useState, useEffect, useMemo } from 'react';
import {
  BusinessDNA,
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
import { OracleMindCodeExporter } from '../../services/oracleMind/oracleMindCodeExporter';
import {
  NeuralPlaygroundTab,
  TrainingLabTab,
  GrpoReasoningTab,
  AgentBenchmarkTab,
  CodeExportTab
} from './oracleMind';

export {
  NeuralPlaygroundTab,
  TrainingLabTab,
  GrpoReasoningTab,
  AgentBenchmarkTab,
  CodeExportTab
};

interface OracleMindViewProps {
  dna: BusinessDNA | null;
  onRouteToDNA?: () => void;
  onRouteToOracle?: (prompt: string) => void;
}

type TabType = 'PLAYGROUND' | 'TRAINING_LAB' | 'GRPO_REASONING' | 'BENCHMARK' | 'CODE_EXPORT';

export const OracleMindView: React.FC<OracleMindViewProps> = ({ dna, onRouteToDNA }) => {
  const [activeTab, setActiveTab] = useState<TabType>('PLAYGROUND');

  // Architecture & Adapters
  const presets = useMemo(() => oracleMindService.getModelPresets(), []);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(presets[1].id); // Pro 64M default
  const activePreset = useMemo(() => presets.find(p => p.id === selectedPresetId) || presets[0], [presets, selectedPresetId]);

  const [adapters] = useState<LoRAAdapter[]>(() => oracleMindService.getDefaultLoRAAdapters());
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
  const [learningRate] = useState<number>(2e-4);
  const [batchSize] = useState<number>(8);
  const [loraRank] = useState<number>(16);
  const [grpoGroupSize] = useState<number>(4);

  // GRPO Lab State
  const [grpoPrompt] = useState<string>('How does Luminara achieve zero-click search supremacy?');
  const [grpoRollout, setGrpoRollout] = useState<GRPORolloutItem | null>(() =>
    oracleMindService.executeGRPORollout('How does Luminara achieve zero-click search supremacy?', dna)
  );

  // Benchmark State
  const [benchmarkSuite, setBenchmarkSuite] = useState<BenchmarkTestCase[]>(() => oracleMindService.getBenchmarkSuite());
  const [isRunningBench, setIsRunningBench] = useState<boolean>(false);

  // Code Export State
  const exportedFiles = useMemo(() => OracleMindCodeExporter.getExportedFiles(), []);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);

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
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-gold/30 to-gold-dark/10 border border-gold/40 flex items-center justify-center shadow-sm shadow-gold/30">
                <ICONS.Brain className="w-4 h-4 text-gold-light" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-light">
                Domain Model Studio
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-success-500/10 border border-success-500/30 text-success-400 font-mono">
                Clean-Room Architecture
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold gold-text tracking-tight">
              OracleMind SLM Studio
            </h1>
            <p className="text-xs text-gray-400 max-w-2xl mt-1 leading-relaxed">
              Train, evaluate, and export specialized domain SLMs with full LoRA and GRPO reasoning workflows.
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
                type="button"
                onClick={onRouteToDNA}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-morphism border border-gold/30 hover:border-gold text-gold-light text-xs transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
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
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                  isActive
                    ? 'bg-gold/20 text-gold-light border border-gold/50 shadow-sm shadow-gold/20'
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
        {activeTab === 'PLAYGROUND' && (
          <NeuralPlaygroundTab
            presets={presets}
            selectedPresetId={selectedPresetId}
            onSelectPresetId={setSelectedPresetId}
            activePreset={activePreset}
            adapters={adapters}
            selectedLoraId={selectedLoraId}
            onSelectLoraId={setSelectedLoraId}
            temperature={temperature}
            setTemperature={setTemperature}
            topP={topP}
            setTopP={setTopP}
            enableReasoning={enableReasoning}
            setEnableReasoning={setEnableReasoning}
            promptInput={promptInput}
            setPromptInput={setPromptInput}
            handleRunInference={handleRunInference}
            isGenerating={isGenerating}
            lastResult={lastResult}
            streamedThought={streamedThought}
            showThought={showThought}
            setShowThought={setShowThought}
            streamedText={streamedText}
          />
        )}

        {activeTab === 'TRAINING_LAB' && (
          <TrainingLabTab
            trainingStage={trainingStage}
            setTrainingStage={setTrainingStage}
            handleStartTraining={handleStartTraining}
            isTraining={isTraining}
            trainingTelemetry={trainingTelemetry}
            latestPoint={latestPoint}
            lossSvgPath={lossSvgPath}
            datasetSamples={datasetSamples}
          />
        )}

        {activeTab === 'GRPO_REASONING' && (
          <GrpoReasoningTab
            handleRunGRPO={handleRunGRPO}
            grpoRollout={grpoRollout}
          />
        )}

        {activeTab === 'BENCHMARK' && (
          <AgentBenchmarkTab
            benchmarkSuite={benchmarkSuite}
            handleRunBenchmark={handleRunBenchmark}
            isRunningBench={isRunningBench}
          />
        )}

        {activeTab === 'CODE_EXPORT' && (
          <CodeExportTab
            exportedFiles={exportedFiles}
            selectedFileIndex={selectedFileIndex}
            setSelectedFileIndex={setSelectedFileIndex}
          />
        )}
      </div>
    </div>
  );
};
