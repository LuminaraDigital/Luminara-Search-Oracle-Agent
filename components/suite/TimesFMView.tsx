import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  BusinessDNA, 
  TimesFmPoint, 
  TimesFmConfig, 
  TimesFmCovariate, 
  TimesFmForecastResult, 
  TimesFmFrequency 
} from '../../types';
import { ICONS } from '../../constants';
import { timesfmService } from '../../services/timesfm/timesfmService';
import { renderMarkdown } from '../../utils/markdown';
import { copyToClipboard } from '../../utils/clipboard';
import { downloadBlob } from '../../utils/download';
import { TimesFMChart, TimesFMCovariatesPanel, TimesFMUploadModal } from './timesfm';

interface TimesFMViewProps {
  dna: BusinessDNA | null;
  initialData?: TimesFmPoint[];
  initialName?: string;
}

export const TimesFMView: React.FC<TimesFMViewProps> = ({ dna, initialData, initialName }) => {
  const benchmarks = useMemo(() => timesfmService.getBenchmarks(), []);
  
  // State
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>(benchmarks[0].id);
  const [seriesName, setSeriesName] = useState<string>(initialName || benchmarks[0].name);
  const [historyData, setHistoryData] = useState<TimesFmPoint[]>(() => {
    if (initialData && initialData.length > 0) return initialData;
    return benchmarks[0].generateData();
  });

  const [frequency, setFrequency] = useState<TimesFmFrequency>(benchmarks[0].frequency);
  const [horizon, setHorizon] = useState<number>(benchmarks[0].defaultHorizon);
  const [patchLength, setPatchLength] = useState<number>(8);
  const [revin, setRevin] = useState<boolean>(true);
  const [executionMode, setExecutionMode] = useState<'edge' | 'neural'>('edge');

  // Quantile Visibility Toggles
  const [showP10P90, setShowP10P90] = useState<boolean>(true);
  const [showP25P75, setShowP25P75] = useState<boolean>(true);

  // Covariates
  const [covariates, setCovariates] = useState<TimesFmCovariate[]>(() => timesfmService.getDefaultCovariates());

  // Forecast Execution State
  const [result, setResult] = useState<TimesFmForecastResult | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Hover Crosshair on Chart
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Custom Upload Modal / Drawer
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Handle benchmark switch
  const handleSelectBenchmark = (benchId: string) => {
    const bench = benchmarks.find(b => b.id === benchId);
    if (!bench) return;
    setSelectedBenchmarkId(bench.id);
    setSeriesName(bench.name);
    setFrequency(bench.frequency);
    setHorizon(bench.defaultHorizon);
    const newData = bench.generateData();
    setHistoryData(newData);
  };

  // Each run gets a ticket; only the newest run may commit its result (prevents out-of-order overwrites).
  const runTicketRef = useRef(0);

  // Run Forecast function
  const runForecast = async () => {
    if (historyData.length === 0) return;
    const ticket = ++runTicketRef.current;
    setIsExecuting(true);
    setError(null);
    try {
      const config: TimesFmConfig = {
        horizon,
        patchLength,
        frequency,
        quantiles: [0.1, 0.25, 0.5, 0.75, 0.9],
        decomposition: 'additive',
        revin
      };

      const res = await timesfmService.executeForecast(
        seriesName,
        historyData,
        config,
        covariates,
        executionMode,
        dna
      );
      if (ticket !== runTicketRef.current) return;
      setResult(res);
    } catch (err: any) {
      if (ticket !== runTicketRef.current) return;
      console.error("TimesFM Forecast error:", err);
      setError(err?.message || "Failed to execute TimesFM forecasting model.");
    } finally {
      if (ticket === runTicketRef.current) setIsExecuting(false);
    }
  };

  // Re-run whenever any input the forecast reads changes (mode/frequency/name included).
  useEffect(() => {
    runForecast();
    return () => { runTicketRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyData, horizon, patchLength, revin, covariates, frequency, executionMode, seriesName, dna]);

  // Toggle Covariate
  const toggleCovariate = (id: string) => {
    setCovariates(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));
  };

  // Update Covariate Value
  const updateCovariateValue = (id: string, val: number) => {
    setCovariates(prev => prev.map(c => c.id === id ? { ...c, value: val } : c));
  };

  // Copy Briefing to Clipboard
  const handleCopyReport = async () => {
    if (!result?.executiveSummary) return;
    const ok = await copyToClipboard(result.executiveSummary);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Export Forecast to CSV
  const handleExportCSV = () => {
    if (!result) return;
    const headers = ["Timestamp", "Date", "Actual_Historical", "Forecast_p10", "Forecast_p25", "Forecast_p50", "Forecast_p75", "Forecast_p90"];
    const rows: string[] = [];

    // Historical rows
    result.history.forEach(h => {
      rows.push([h.timestamp, h.dateStr, h.value, "", "", "", "", ""].join(","));
    });

    // Forecast rows
    result.forecast.forEach(f => {
      rows.push([f.timestamp, f.dateStr, "", f.p10, f.p25, f.p50, f.p75, f.p90].join(","));
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `timesfm_forecast_${seriesName.replace(/\s+/g, '_').toLowerCase()}.csv`);
  };

  // -------------------------------------------------------------
  // Chart Geometry & Calculations
  // -------------------------------------------------------------
  const chartWidth = 900;
  const chartHeight = 340;
  const padding = { top: 30, right: 30, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const chartData = useMemo(() => {
    if (!result) return null;

    const allPoints = [
      ...result.history.map((h, i) => ({ type: 'history' as const, index: i, dateStr: h.dateStr, val: h.value })),
      ...result.forecast.map((f, i) => ({ 
        type: 'forecast' as const, 
        index: result.history.length + i, 
        dateStr: f.dateStr, 
        p10: f.p10, 
        p25: f.p25, 
        p50: f.p50, 
        p75: f.p75, 
        p90: f.p90 
      }))
    ];

    const totalSteps = allPoints.length;
    if (totalSteps <= 1) return null;

    // Determine value bounds
    let minY = Infinity;
    let maxY = -Infinity;

    result.history.forEach(h => {
      if (h.value < minY) minY = h.value;
      if (h.value > maxY) maxY = h.value;
    });

    result.forecast.forEach(f => {
      if (f.p10 < minY) minY = f.p10;
      if (f.p90 > maxY) maxY = f.p90;
    });

    // Add 10% breathing room
    const range = Math.max(1, maxY - minY);
    minY = Math.max(0, minY - range * 0.08);
    maxY = maxY + range * 0.08;

    const scaleX = (idx: number) => padding.left + (idx / (totalSteps - 1)) * innerWidth;
    const scaleY = (val: number) => padding.top + innerHeight - ((val - minY) / (maxY - minY)) * innerHeight;

    // History path
    const historyPoints = result.history.map((h, idx) => ({
      x: scaleX(idx),
      y: scaleY(h.value),
      data: h
    }));
    const historyPathStr = historyPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    // Connect last history point to forecast start for continuity
    const lastHistPoint = historyPoints[historyPoints.length - 1];

    // P50 forecast path
    const forecastPoints = result.forecast.map((f, idx) => ({
      x: scaleX(result.history.length + idx),
      y: scaleY(f.p50),
      data: f
    }));
    const p50PathStr = `M${lastHistPoint.x.toFixed(1)},${lastHistPoint.y.toFixed(1)} ` + 
      forecastPoints.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    // P10-P90 outer cone polygon
    const p10Points = result.forecast.map((f, idx) => ({ x: scaleX(result.history.length + idx), y: scaleY(f.p10) }));
    const p90Points = result.forecast.map((f, idx) => ({ x: scaleX(result.history.length + idx), y: scaleY(f.p90) }));

    const p10p90AreaStr = `M${lastHistPoint.x.toFixed(1)},${lastHistPoint.y.toFixed(1)} ` +
      p90Points.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' ' +
      p10Points.slice().reverse().map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

    // P25-P75 inner ribbon polygon
    const p25Points = result.forecast.map((f, idx) => ({ x: scaleX(result.history.length + idx), y: scaleY(f.p25) }));
    const p75Points = result.forecast.map((f, idx) => ({ x: scaleX(result.history.length + idx), y: scaleY(f.p75) }));

    const p25p75AreaStr = `M${lastHistPoint.x.toFixed(1)},${lastHistPoint.y.toFixed(1)} ` +
      p75Points.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' ' +
      p25Points.slice().reverse().map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

    // Anomaly points
    const anomalyPoints = result.anomalies.map(anom => {
      const idx = result.history.findIndex(h => h.timestamp === anom.timestamp);
      if (idx === -1) return null;
      return {
        x: scaleX(idx),
        y: scaleY(anom.actual),
        anom
      };
    }).filter(Boolean);

    // X-axis label ticks (5-6 evenly spaced)
    const tickInterval = Math.max(1, Math.floor(totalSteps / 5));
    const xTicks = [];
    for (let i = 0; i < totalSteps; i += tickInterval) {
      xTicks.push({
        x: scaleX(i),
        label: allPoints[i].dateStr.slice(5) // MM-DD or MM
      });
    }
    // Always include last tick
    if (xTicks.length > 0 && xTicks[xTicks.length - 1].x < innerWidth + padding.left - 40) {
      xTicks.push({
        x: scaleX(totalSteps - 1),
        label: allPoints[totalSteps - 1].dateStr.slice(5)
      });
    }

    // Y-axis label ticks (4 ticks)
    const yTicks = [0, 0.33, 0.66, 1].map(pct => {
      const val = minY + pct * (maxY - minY);
      return {
        y: scaleY(val),
        label: val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val).toString()
      };
    });

    const splitX = scaleX(result.history.length - 1);

    return {
      minY,
      maxY,
      scaleX,
      scaleY,
      historyPoints,
      forecastPoints,
      historyPathStr,
      p50PathStr,
      p10p90AreaStr,
      p25p75AreaStr,
      anomalyPoints,
      xTicks,
      yTicks,
      splitX,
      allPoints,
      lastHistPoint
    };
  }, [result]);

  // Current hovered point info
  const hoverPoint = useMemo(() => {
    if (hoverIndex === null || !chartData) return null;
    return chartData.allPoints[hoverIndex] || null;
  }, [hoverIndex, chartData]);

  // Key KPI calculations
  const kpis = useMemo(() => {
    if (!result || result.forecast.length === 0 || result.history.length === 0) return null;
    const lastHist = result.history[result.history.length - 1].value;
    const finalP50 = result.forecast[result.forecast.length - 1].p50;
    const finalP10 = result.forecast[result.forecast.length - 1].p10;
    const finalP90 = result.forecast[result.forecast.length - 1].p90;

    const diff = finalP50 - lastHist;
    const diffPct = lastHist !== 0 ? Math.round((diff / lastHist) * 100) : 0;
    const uncertaintyPct = finalP50 !== 0 ? Math.round(((finalP90 - finalP10) / (2 * finalP50)) * 100) : 0;

    return {
      lastHist,
      finalP50,
      finalP10,
      finalP90,
      diffPct,
      uncertaintyPct,
      mape: result.metrics.mape,
      directionalAccuracy: result.metrics.directionalAccuracy,
      anomalyCount: result.anomalies.length
    };
  }, [result]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      {/* Header Section */}
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="w-8 h-[1px] bg-gold"></span>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gold-light">
              Forecasting
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight flex items-center gap-3">
            <span>TimesFM Horizon Forecaster</span>
            <span className="px-2.5 py-0.5 rounded-full bg-gold/10 border border-gold/40 text-[10px] font-mono text-gold-light uppercase tracking-wider font-normal">
              Patch Tokenizer • RevIN
            </span>
          </h1>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
            Forecast search traffic, citation trajectories, and metrics with multi-quantile uncertainty bounds (<code className="text-gold-light font-mono">p10..p90</code>).
          </p>
        </div>

        {/* Right Status & DNA Link */}
        <div className="flex items-center gap-3 shrink-0">
          {dna && (
            <div className="glass-morphism rounded-xl px-3.5 py-2 border border-success-500/30 flex items-center gap-2.5 bg-success-950/20 text-xs">
              <span className="w-2 h-2 rounded-full bg-success-400 shadow-sm shadow-success-500/30"></span>
              <span className="text-gray-300">DNA Linked: <strong className="text-white">{dna.name}</strong></span>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center bg-black/60 rounded-xl p-1 border border-white/10">
            <button
              type="button"
              aria-pressed={executionMode === 'edge'}
              onClick={() => setExecutionMode('edge')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                executionMode === 'edge'
                  ? 'bg-gradient-to-r from-gold to-gold-dark text-black shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Instant local browser calculation"
            >
              <ICONS.Zap className="w-3 h-3" />
              <span>Edge Foundation</span>
            </button>
            <button
              type="button"
              aria-pressed={executionMode === 'neural'}
              onClick={() => setExecutionMode('neural')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                executionMode === 'neural'
                  ? 'bg-gradient-to-r from-gold to-gold-dark text-black shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Neural foundation synthesis"
            >
              <ICONS.Sparkle className="w-3 h-3" />
              <span>Neural Foundation</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dataset Benchmark Bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2 pb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mr-2">Benchmarks:</span>
        {benchmarks.map(b => (
          <button
            key={b.id}
            type="button"
            aria-pressed={selectedBenchmarkId === b.id}
            onClick={() => handleSelectBenchmark(b.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
              selectedBenchmarkId === b.id
                ? 'bg-gold/20 text-gold-light border border-gold/50 shadow-lg'
                : 'bg-black/40 text-gray-400 border border-white/5 hover:border-white/20 hover:text-gray-200'
            }`}
          >
            <span>{b.name}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setIsUploadOpen(true)}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
            selectedBenchmarkId === 'custom'
              ? 'bg-gold/20 text-gold-light border border-gold/50 shadow-lg'
              : 'bg-white/5 text-gray-300 border border-white/10 hover:border-gold/40'
          }`}
        >
          <ICONS.FileText className="w-3.5 h-3.5 text-gold-light" />
          <span>Upload CSV / Ingest</span>
        </button>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {/* Left Column: Model Hyperparameters & Covariates (1 col) */}
        <div className="lg:col-span-1 space-y-6">
          {/* Foundation Model Hyperparameters */}
          <div className="glass-morphism rounded-2xl border border-gold/30 p-5 bg-black/60 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-light">
                <ICONS.Settings className="w-3.5 h-3.5" />
                <span>Foundation Parameters</span>
              </div>
              <span className="text-[10px] font-mono text-gray-400">v1.2</span>
            </div>

            {/* Horizon Selector */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label htmlFor="forecast-horizon-slider" className="text-[11px] font-bold uppercase tracking-wider text-gray-300">
                  Forecast Horizon
                </label>
                <span className="text-xs font-mono text-gold-light font-bold">{horizon} {frequency}</span>
              </div>
              <input
                id="forecast-horizon-slider"
                type="range"
                min="7"
                max="180"
                step="1"
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              />
              <div className="flex justify-between text-[9px] font-mono text-gray-400 mt-1">
                <button type="button" onClick={() => setHorizon(7)} className="hover:text-white focus-visible:ring-1 focus-visible:ring-gold rounded">7d</button>
                <button type="button" onClick={() => setHorizon(14)} className="hover:text-white focus-visible:ring-1 focus-visible:ring-gold rounded">14d</button>
                <button type="button" onClick={() => setHorizon(30)} className="hover:text-white focus-visible:ring-1 focus-visible:ring-gold rounded">30d</button>
                <button type="button" onClick={() => setHorizon(60)} className="hover:text-white focus-visible:ring-1 focus-visible:ring-gold rounded">60d</button>
                <button type="button" onClick={() => setHorizon(90)} className="hover:text-white focus-visible:ring-1 focus-visible:ring-gold rounded">90d</button>
                <button type="button" onClick={() => setHorizon(180)} className="hover:text-white focus-visible:ring-1 focus-visible:ring-gold rounded">180d</button>
              </div>
            </div>

            {/* Patch Length */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                Patch Length (P)
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[4, 8, 16, 32].map(p => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={patchLength === p}
                    onClick={() => setPatchLength(p)}
                    className={`py-1 rounded-lg text-xs font-mono font-bold transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                      patchLength === p
                        ? 'bg-gold text-black'
                        : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-gray-400 mt-1">Chunk size for temporal attention.</p>
            </div>

            {/* Normalization & Decomp */}
            <div className="pt-2 border-t border-white/5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="revin-checkbox" className="text-gray-300 text-[11px] cursor-pointer">Reversible Instance Norm (RevIN)</label>
                <input
                  id="revin-checkbox"
                  type="checkbox"
                  checked={revin}
                  onChange={(e) => setRevin(e.target.checked)}
                  className="w-4 h-4 accent-gold rounded cursor-pointer focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <label htmlFor="risk-cone-checkbox" className="text-gray-300 text-[11px] cursor-pointer">Show p10-p90 Risk Cone</label>
                <input
                  id="risk-cone-checkbox"
                  type="checkbox"
                  checked={showP10P90}
                  onChange={(e) => setShowP10P90(e.target.checked)}
                  className="w-4 h-4 accent-gold rounded cursor-pointer focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <label htmlFor="ribbon-checkbox" className="text-gray-300 text-[11px] cursor-pointer">Show p25-p75 Quartile Ribbon</label>
                <input
                  id="ribbon-checkbox"
                  type="checkbox"
                  checked={showP25P75}
                  onChange={(e) => setShowP25P75(e.target.checked)}
                  className="w-4 h-4 accent-gold rounded cursor-pointer focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Exogenous Covariates & Shocks */}
          <TimesFMCovariatesPanel
            covariates={covariates}
            onToggleCovariate={toggleCovariate}
            onUpdateCovariateValue={updateCovariateValue}
          />
        </div>

        {/* Center/Right Column: Luxury SVG Forecaster Canvas (3 cols) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Main Visualizer Card */}
          <TimesFMChart
            seriesName={seriesName}
            frequency={frequency}
            result={result}
            chartData={chartData}
            hoverIndex={hoverIndex}
            setHoverIndex={setHoverIndex}
            hoverPoint={hoverPoint}
            kpis={kpis}
            showP10P90={showP10P90}
            showP25P75={showP25P75}
            isExecuting={isExecuting}
            error={error}
            onExportCSV={handleExportCSV}
            onRunForecast={runForecast}
          />

          {/* Executive Strategic Takeaways / Synthesis */}
          {result?.executiveSummary && (
            <div className="glass-morphism rounded-2xl border border-gold/40 p-6 sm:p-8 bg-black/90 shadow-2xl animate-in fade-in duration-500">
              <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-gold shadow-sm shadow-gold/30"></div>
                  <h3 className="text-base font-bold uppercase tracking-widest text-gold-light">
                    TimesFM Executive Intelligence Briefing
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={handleCopyReport}
                  className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition-all flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  <ICONS.Share className="w-3.5 h-3.5 text-gold-light" />
                  <span>{copied ? 'Copied!' : 'Copy Briefing'}</span>
                </button>
              </div>

              <div 
                className="markdown-content max-w-none text-sm leading-relaxed space-y-4 text-gray-300"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(result.executiveSummary) }}
              />
            </div>
          )}
        </div>
      </div>

      {/* CSV / Data Upload Modal */}
      <TimesFMUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onApplyData={(parsed, name) => {
          setSelectedBenchmarkId('custom');
          setSeriesName(name);
          setHistoryData(parsed);
        }}
        onError={(msg) => setError(msg)}
      />
    </div>
  );
};
