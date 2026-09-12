import React from 'react';
import { TrainingStage, TrainingTelemetryPoint, DatasetSample } from '../../../types';
import { ICONS } from '../../../constants';

interface TrainingLabTabProps {
  trainingStage: TrainingStage;
  setTrainingStage: (stage: TrainingStage) => void;
  handleStartTraining: () => void;
  isTraining: boolean;
  trainingTelemetry: TrainingTelemetryPoint[];
  latestPoint: TrainingTelemetryPoint | null;
  lossSvgPath: string;
  datasetSamples: DatasetSample[];
}

export const TrainingLabTab: React.FC<TrainingLabTabProps> = ({
  trainingStage,
  setTrainingStage,
  handleStartTraining,
  isTraining,
  trainingTelemetry,
  latestPoint,
  lossSvgPath,
  datasetSamples,
}) => {
  return (
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
  );
};
