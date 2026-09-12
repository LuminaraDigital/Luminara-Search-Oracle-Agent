import React from 'react';
import { BenchmarkTestCase } from '../../../types';
import { ICONS } from '../../../constants';

interface AgentBenchmarkTabProps {
  benchmarkSuite: BenchmarkTestCase[];
  handleRunBenchmark: () => void;
  isRunningBench: boolean;
}

export const AgentBenchmarkTab: React.FC<AgentBenchmarkTabProps> = ({
  benchmarkSuite,
  handleRunBenchmark,
  isRunningBench,
}) => {
  return (
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
  );
};
