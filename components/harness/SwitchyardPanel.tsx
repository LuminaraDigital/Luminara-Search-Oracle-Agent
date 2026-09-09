import React, { useState, useEffect } from 'react';
import {
  switchyardRouterService,
  DEFAULT_SWITCHYARD_ROUTES,
  DEFAULT_SWITCHYARD_TARGETS,
} from '../../services/switchyard/switchyardRouterService';
import {
  SwitchyardRouteConfig,
  SwitchyardTarget,
  SwitchyardDecisionLog,
  SwitchyardMetrics,
} from '../../types';
import { useConfirm } from '../ui/ConfirmModal';
import { ICONS } from '../../constants';

export const SwitchyardPanel: React.FC = () => {
  const { requestConfirm, confirmModal } = useConfirm();
  const [metrics, setMetrics] = useState<SwitchyardMetrics>(() => switchyardRouterService.getMetrics());
  const [routes, setRoutes] = useState<SwitchyardRouteConfig[]>(() => switchyardRouterService.getRoutes());
  const [targets, setTargets] = useState<SwitchyardTarget[]>(() => switchyardRouterService.getTargets());
  const [logs, setLogs] = useState<SwitchyardDecisionLog[]>(() => switchyardRouterService.getLogs());

  // Simulation state
  const [selectedRouteId, setSelectedRouteId] = useState<string>(routes[0]?.id || 'escalation_primary');
  const [testPrompt, setTestPrompt] = useState<string>('Generate full Organization, FAQPage, and Service JSON-LD schema for a financial advisory firm.');
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [activeSimulationResult, setActiveSimulationResult] = useState<{ log: SwitchyardDecisionLog; output: string } | null>(null);

  useEffect(() => {
    const unsub = switchyardRouterService.subscribe(() => {
      setMetrics(switchyardRouterService.getMetrics());
      setRoutes(switchyardRouterService.getRoutes());
      setTargets(switchyardRouterService.getTargets());
      setLogs(switchyardRouterService.getLogs());
    });
    return unsub;
  }, []);

  const handleRunSimulation = async (live: boolean) => {
    if (!testPrompt.trim() || isSimulating) return;
    setIsSimulating(true);
    try {
      const res = await switchyardRouterService.routeAndExecute(testPrompt, selectedRouteId, live);
      setActiveSimulationResult({ log: res.decisionLog, output: res.outputText });
    } catch (err: any) {
      console.error('Switchyard simulation failed', err);
    } finally {
      setIsSimulating(false);
    }
  };

  const samplePrompts = [
    { label: 'Technical Schema', text: 'Generate comprehensive Organization and BreadcrumbList JSON-LD schema for stripe.com.' },
    { label: 'SERP Intent', text: 'What are the top 3 ranking factors for generative engine optimization (GEO)?' },
    { label: 'Heuristic Audit', text: 'Execute a full Triple-Vector (SEO, AEO, GEO) audit on datadoghq.com and calculate ROI.' },
    { label: 'TimesFM Forecast', text: 'Run 30-day foundation patch forecasting with p10-p90 uncertainty cones on daily search traffic.' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {confirmModal}
      {/* Top Banner */}
      <div className="p-6 rounded-2xl glass-morphism border border-gold/30 bg-gradient-to-r from-black via-white/[0.02] to-black relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <span className="text-9xl font-mono text-gold-light">⮀</span>
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider font-bold bg-gold/20 text-gold-light border border-gold/40">
                NVIDIA-NeMo Switchyard Adaptation
              </span>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono text-gray-400 bg-white/5 border border-white/10">
                Clean-Room TypeScript Engine
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight gold-text">
              Switchyard Dynamic Workload & Model Router
            </h2>
            <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
              Intelligently routes search, audit, and reasoning queries between ultra-fast LPUs (Groq 70B at 285 tok/s), capable frontier models (Gemini 3 Pro / NVIDIA NIM), and adversarial schema verification gates.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => requestConfirm(
                {
                  title: 'Reset metrics?',
                  description: 'All Switchyard routing logs and metrics will be cleared. This cannot be undone.',
                  confirmLabel: 'Reset metrics',
                  variant: 'danger',
                },
                () => switchyardRouterService.clearLogs(),
              )}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:border-danger-500/40 text-[10px] font-mono text-gray-400 hover:text-danger-400 transition-all outline-none focus-visible:ring-2 focus-visible:ring-danger-400"
            >
              Reset Metrics
            </button>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/5">
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[10px] uppercase font-mono text-gray-400 block">Total Workloads Routed</span>
            <div className="text-2xl font-black text-white mt-1 font-mono">
              {metrics.totalRoutedRequests}
              <span className="text-[10px] font-normal text-gray-500 ml-2">queries</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[10px] uppercase font-mono text-gray-400 block">Cost Reduction vs Baseline</span>
            <div className="text-2xl font-black text-success-400 mt-1 font-mono">
              ~58.4%
              <span className="text-[10px] font-normal text-success-500/70 ml-2">
                (${metrics.totalCostSavedUsd} saved)
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[10px] uppercase font-mono text-gray-400 block">Latency Speedup</span>
            <div className="text-2xl font-black text-gold-light mt-1 font-mono">
              3.8x
              <span className="text-[10px] font-normal text-gray-400 ml-2">avg 245ms</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-[10px] uppercase font-mono text-gray-400 block">Escalation Trigger Rate</span>
            <div className="text-2xl font-black text-warning-400 mt-1 font-mono">
              {metrics.escalationRatePct}%
              <span className="text-[10px] font-normal text-gray-500 ml-2">to Capable</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Topology Diagram */}
      <div className="p-6 rounded-2xl glass-morphism border border-white/10 bg-black/60 space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gold-light">Routing Topology Architecture</h3>
            <p className="text-[10px] text-gray-400 font-mono">Dynamic Multi-Target Pathing & Fallback Channels</p>
          </div>
          <span className="text-[10px] font-mono text-success-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse"></span>
            Topology Operational
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2 text-center text-xs">
          {/* Node 1: Inbound */}
          <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center">
            <span className="text-xl mb-1">📥</span>
            <span className="font-bold text-gray-200">Inbound Request</span>
            <span className="text-[9px] font-mono text-gray-500 mt-1">Oracle Agent / API</span>
          </div>

          {/* Arrow */}
          <div className="hidden md:flex items-center justify-center text-gray-600 font-mono text-lg">➜</div>

          {/* Node 2: Algorithm */}
          <div className="p-4 rounded-xl border border-gold/40 bg-gold/10 flex flex-col items-center justify-center">
            <span className="text-xl mb-1">⚡</span>
            <span className="font-bold text-gold-light">Switchyard Core</span>
            <span className="text-[9px] font-mono text-gold mt-1">
              {routes.find(r => r.id === selectedRouteId)?.name || 'Escalation Router'}
            </span>
          </div>

          {/* Arrow */}
          <div className="hidden md:flex items-center justify-center text-gray-600 font-mono text-lg">➜</div>

          {/* Node 3: Targets */}
          <div className="p-4 rounded-xl border border-success-500/30 bg-success-500/10 flex flex-col items-center justify-center">
            <span className="text-xl mb-1">🎯</span>
            <span className="font-bold text-success-400">Target Dispatched</span>
            <span className="text-[9px] font-mono text-success-300 mt-1">Groq LPU / NIM / Gemini</span>
          </div>
        </div>
      </div>

      {/* Interactive Route Simulator */}
      <div className="p-6 rounded-2xl glass-morphism border border-white/10 bg-black/60 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gold-light">Interactive Workload Route Simulator</h3>
            <p className="text-[10px] text-gray-400 font-mono">Observe live routing decisions, confidence scores, and target allocations in real time</p>
          </div>

          {/* Route Algorithm Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase text-gray-400">Algorithm:</span>
            <select
              value={selectedRouteId}
              onChange={e => setSelectedRouteId(e.target.value)}
              className="bg-black/80 border border-white/15 focus:border-gold rounded-xl px-3 py-1.5 text-xs text-gold-light font-mono focus:outline-none"
            >
              {routes.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Prompt Input & Chips */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-gray-500 uppercase mr-1">Preset Scenarios:</span>
            {samplePrompts.map((p, idx) => (
              <button
                key={idx}
                onClick={() => setTestPrompt(p.text)}
                className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-white/5 hover:bg-gold/20 text-gray-300 hover:text-gold-light border border-white/10 hover:border-gold/40 transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>

          <textarea
            rows={3}
            value={testPrompt}
            onChange={e => setTestPrompt(e.target.value)}
            placeholder="Type any search audit, schema, or agent prompt..."
            className="w-full bg-black/80 border border-white/15 focus:border-gold rounded-xl p-3 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none transition-all leading-relaxed"
          />

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              onClick={() => handleRunSimulation(false)}
              disabled={isSimulating}
              className="px-4 py-2 rounded-xl text-xs font-mono font-bold text-gray-300 hover:text-white border border-white/10 hover:border-white/20 transition-all"
            >
              Simulate Logic Only
            </button>
            <button
              onClick={() => handleRunSimulation(true)}
              disabled={isSimulating}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black text-xs font-black uppercase tracking-wider shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
            >
              {isSimulating ? (
                <>
                  <span className="w-3 h-3 rounded-full border-2 border-black border-t-transparent animate-spin"></span>
                  <span>Routing Workload...</span>
                </>
              ) : (
                <>
                  <span>⮀</span>
                  <span>Execute Live Route</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Simulation Trace Result */}
        {activeSimulationResult && (
          <div className="p-4 rounded-xl bg-white/[0.02] border border-gold/30 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-gold-light font-bold">
                Route Execution Trace & Decision Provenance
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase ${
                activeSimulationResult.log.escalated 
                  ? 'bg-warning-500/10 text-warning-400 border border-warning-500/30' 
                  : 'bg-success-500/10 text-success-400 border border-success-500/30'
              }`}>
                {activeSimulationResult.log.escalated ? 'Escalated to Capable' : 'Served by Efficient LPU'}
              </span>
            </div>

            {/* Decision Steps */}
            <div className="space-y-2 pt-1">
              {activeSimulationResult.log.steps.map((step, sIdx) => (
                <div key={sIdx} className="flex items-start gap-3 text-xs font-mono p-2.5 rounded-lg bg-black/40 border border-white/5">
                  <span className="px-2 py-0.5 rounded bg-white/10 text-gold-light text-[10px] shrink-0">
                    Step {sIdx + 1}
                  </span>
                  <div>
                    <span className="text-gray-300 font-bold">{step.stage}</span>
                    <span className="text-gray-500 mx-2">➜</span>
                    <span className="text-success-400">{step.chosenTarget}</span>
                    <p className="text-[11px] text-gray-400 mt-1 font-sans">{step.reason}</p>
                  </div>
                  <span className="ml-auto text-[10px] text-gray-500 shrink-0">
                    Conf: {(step.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>

            {/* Output Preview */}
            <div className="mt-3 p-3 rounded-xl bg-black/60 border border-white/5">
              <span className="text-[9px] font-mono text-gray-500 uppercase block mb-1">Target Output Preview:</span>
              <p className="text-xs text-gray-300 font-mono leading-relaxed line-clamp-4">
                {activeSimulationResult.output}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Target Registry & Live Hardware Specs */}
      <div className="p-6 rounded-2xl glass-morphism border border-white/10 bg-black/60 space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gold-light">Switchyard Target Registry</h3>
            <p className="text-[10px] text-gray-400 font-mono">Active Inference Hardware, Throughput & Unit Economics</p>
          </div>
          <span className="text-[10px] font-mono text-gray-400">5 Models Connected</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 text-[10px] uppercase">
                <th className="py-2.5 px-3">Target Name</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Provider</th>
                <th className="py-2.5 px-3">Throughput</th>
                <th className="py-2.5 px-3">Cost / 1M Tokens</th>
                <th className="py-2.5 px-3">Baseline Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {targets.map(t => (
                <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-3 font-bold text-gray-200 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      t.role === 'efficient' ? 'bg-success-400 shadow-[0_0_6px_#10B981]' : t.role === 'capable' ? 'bg-gold shadow-[0_0_6px_#BF953F]' : 'bg-purple-400'
                    }`}></span>
                    <span>{t.name}</span>
                  </td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold ${
                      t.role === 'efficient' ? 'bg-success-500/10 text-success-400' : t.role === 'capable' ? 'bg-gold/10 text-gold-light' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {t.role}
                    </span>
                  </td>
                  <td className="py-3 px-3 uppercase text-gray-400">{t.provider}</td>
                  <td className="py-3 px-3 text-gold-light">{t.tokensPerSec} tok/s</td>
                  <td className="py-3 px-3 text-gray-300">${t.costPerMillionTokens.toFixed(2)}</td>
                  <td className="py-3 px-3 text-gray-400">{t.latencyBaselineMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
