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
  const [pasteText, setPasteText] = useState<string>('');
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

  // Handle custom data submission
  const handleApplyCustomData = () => {
    if (!pasteText.trim()) return;
    const parsed = timesfmService.parseTimeSeriesData(pasteText);
    if (parsed.length < 5) {
      setError("Parsed fewer than 5 data points. Please ensure valid CSV, TSV, or numeric sequence.");
      return;
    }
    setSelectedBenchmarkId('custom');
    setSeriesName('Custom Ingested Sequence');
    setHistoryData(parsed);
    setIsUploadOpen(false);
    setPasteText('');
  };

  // Handle file input
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const parsed = timesfmService.parseTimeSeriesData(text);
        if (parsed.length >= 5) {
          setSelectedBenchmarkId('custom');
          setSeriesName(file.name.replace(/\.[^/.]+$/, ""));
          setHistoryData(parsed);
          setIsUploadOpen(false);
        } else {
          setError("File contains insufficient valid data points (minimum 5 required).");
        }
      }
    };
    reader.readAsText(file);
  };

  // Toggle Covariate
  const toggleCovariate = (id: string) => {
    setCovariates(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));
  };

  // Update Covariate Value
  const updateCovariateValue = (id: string, val: number) => {
    setCovariates(prev => prev.map(c => c.id === id ? { ...c, value: val } : c));
  };

  // Copy Briefing to Clipboard
  const handleCopyReport = () => {
    if (!result?.executiveSummary) return;
    navigator.clipboard.writeText(result.executiveSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `timesfm_forecast_${seriesName.replace(/\s+/g, '_').toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
            <span className="w-8 h-[1px] bg-[#BF953F]"></span>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#FCF6BA]">
              Zero-Shot Time-Series Foundation Model
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight flex items-center gap-3">
            <span>TimesFM Horizon Forecaster</span>
            <span className="px-2.5 py-0.5 rounded-full bg-[#BF953F]/10 border border-[#BF953F]/40 text-[10px] font-mono text-[#FCF6BA] uppercase tracking-wider font-normal">
              Patch Tokenizer • RevIN
            </span>
          </h1>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
            Proprietary clean-room time-series foundation harness forecasting search traffic, AEO citations, and sovereign economics with multi-quantile probabilistic uncertainty bounds (<code className="text-[#FCF6BA] font-mono">p10..p90</code>).
          </p>
        </div>

        {/* Right Status & DNA Link */}
        <div className="flex items-center gap-3 shrink-0">
          {dna && (
            <div className="glass-morphism rounded-xl px-3.5 py-2 border border-emerald-500/30 flex items-center gap-2.5 bg-emerald-950/20 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10B981]"></span>
              <span className="text-gray-300">DNA Linked: <strong className="text-white">{dna.name}</strong></span>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center bg-black/60 rounded-xl p-1 border border-white/10">
            <button
              onClick={() => setExecutionMode('edge')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                executionMode === 'edge'
                  ? 'bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Instant local browser tensor-patch calculation"
            >
              <ICONS.Zap className="w-3 h-3" />
              <span>Edge Foundation</span>
            </button>
            <button
              onClick={() => setExecutionMode('neural')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                executionMode === 'neural'
                  ? 'bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Deep Gemini foundation synthesis with Code Execution"
            >
              <ICONS.Sparkle className="w-3 h-3" />
              <span>Neural Foundation</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dataset Benchmark Bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2 pb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mr-2">Benchmarks:</span>
        {benchmarks.map(b => (
          <button
            key={b.id}
            onClick={() => handleSelectBenchmark(b.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-2 ${
              selectedBenchmarkId === b.id
                ? 'bg-[#BF953F]/20 text-[#FCF6BA] border border-[#BF953F]/50 shadow-lg'
                : 'bg-black/40 text-gray-400 border border-white/5 hover:border-white/20 hover:text-gray-200'
            }`}
          >
            <span>{b.name}</span>
          </button>
        ))}

        <button
          onClick={() => setIsUploadOpen(true)}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-2 ${
            selectedBenchmarkId === 'custom'
              ? 'bg-[#BF953F]/20 text-[#FCF6BA] border border-[#BF953F]/50 shadow-lg'
              : 'bg-white/5 text-gray-300 border border-white/10 hover:border-[#BF953F]/40'
          }`}
        >
          <ICONS.FileText className="w-3.5 h-3.5 text-[#FCF6BA]" />
          <span>Upload CSV / Ingest</span>
        </button>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {/* Left Column: Model Hyperparameters & Covariates (1 col) */}
        <div className="lg:col-span-1 space-y-6">
          {/* Foundation Model Hyperparameters */}
          <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-5 bg-black/60 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#FCF6BA]">
                <ICONS.Settings className="w-3.5 h-3.5" />
                <span>Foundation Parameters</span>
              </div>
              <span className="text-[10px] font-mono text-gray-500">v1.2</span>
            </div>

            {/* Horizon Selector */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-300">
                  Forecast Horizon
                </label>
                <span className="text-xs font-mono text-[#FCF6BA] font-bold">{horizon} {frequency}</span>
              </div>
              <input
                type="range"
                min="7"
                max="180"
                step="1"
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#BF953F]"
              />
              <div className="flex justify-between text-[9px] font-mono text-gray-500 mt-1">
                <button onClick={() => setHorizon(7)} className="hover:text-white">7d</button>
                <button onClick={() => setHorizon(14)} className="hover:text-white">14d</button>
                <button onClick={() => setHorizon(30)} className="hover:text-white">30d</button>
                <button onClick={() => setHorizon(60)} className="hover:text-white">60d</button>
                <button onClick={() => setHorizon(90)} className="hover:text-white">90d</button>
                <button onClick={() => setHorizon(180)} className="hover:text-white">180d</button>
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
                    onClick={() => setPatchLength(p)}
                    className={`py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                      patchLength === p
                        ? 'bg-[#BF953F] text-black'
                        : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-gray-500 mt-1">Tokenization chunk width for temporal attention.</p>
            </div>

            {/* Normalization & Decomp */}
            <div className="pt-2 border-t border-white/5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 text-[11px]">Reversible Instance Norm (RevIN)</span>
                <input
                  type="checkbox"
                  checked={revin}
                  onChange={(e) => setRevin(e.target.checked)}
                  className="w-4 h-4 accent-[#BF953F] rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 text-[11px]">Show p10-p90 Risk Cone</span>
                <input
                  type="checkbox"
                  checked={showP10P90}
                  onChange={(e) => setShowP10P90(e.target.checked)}
                  className="w-4 h-4 accent-[#BF953F] rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 text-[11px]">Show p25-p75 Quartile Ribbon</span>
                <input
                  type="checkbox"
                  checked={showP25P75}
                  onChange={(e) => setShowP25P75(e.target.checked)}
                  className="w-4 h-4 accent-[#BF953F] rounded cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Exogenous Covariates & Shocks */}
          <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#FCF6BA]">
                <ICONS.Sliders className="w-3.5 h-3.5" />
                <span>Exogenous Covariates</span>
              </div>
              <span className="text-[9px] font-mono text-emerald-400 uppercase">Scenario Alpha</span>
            </div>

            <div className="space-y-4">
              {covariates.map(cov => (
                <div key={cov.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-200 cursor-pointer flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cov.active}
                        onChange={() => toggleCovariate(cov.id)}
                        className="w-3.5 h-3.5 accent-[#BF953F] rounded cursor-pointer"
                      />
                      <span>{cov.name}</span>
                    </label>
                    <span className="text-[10px] font-mono text-[#FCF6BA]">
                      {cov.type === 'multiplier' ? `x${cov.value.toFixed(2)}` : `${(cov.value * 100).toFixed(0)}%`}
                    </span>
                  </div>

                  <p className="text-[10px] text-gray-500 leading-tight">
                    {cov.description}
                  </p>

                  {cov.active && cov.type === 'multiplier' && (
                    <input
                      type="range"
                      min="1.05"
                      max="2.00"
                      step="0.05"
                      value={cov.value}
                      onChange={(e) => updateCovariateValue(cov.id, Number(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#BF953F]"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center/Right Column: Luxury SVG Forecaster Canvas (3 cols) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Main Visualizer Card */}
          <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-6 bg-black/80 shadow-2xl relative overflow-hidden">
            {/* Top Chart Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">{seriesName}</span>
                  <span className="text-[10px] font-mono text-gray-400">({frequency})</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-white"></span>
                    <span className="text-gray-400 text-[11px]">Historical Context</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-[#FCF6BA]"></span>
                    <span className="text-[#FCF6BA] text-[11px] font-bold">TimesFM p50 Median</span>
                  </div>
                  {showP10P90 && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-2 bg-[#BF953F]/20 border border-[#BF953F]/40 rounded-sm"></span>
                      <span className="text-gray-400 text-[11px]">p10-p90 Cone</span>
                    </div>
                  )}
                  {result && result.anomalies.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-400"></span>
                      <span className="text-red-400 text-[11px]">Anomalies ({result.anomalies.length})</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions: Export & Re-Run */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  disabled={!result}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-gray-300 hover:text-white transition-all flex items-center gap-1.5"
                  title="Download CSV of Historical & Quantile Predictions"
                >
                  <ICONS.FileText className="w-3 h-3 text-[#FCF6BA]" />
                  <span>Export CSV</span>
                </button>

                <button
                  onClick={runForecast}
                  disabled={isExecuting}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black font-bold text-xs uppercase tracking-wider hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isExecuting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-black/40 border-t-black rounded-full animate-spin"></div>
                      <span>Synthesizing...</span>
                    </>
                  ) : (
                    <>
                      <ICONS.Refresh className="w-3.5 h-3.5" />
                      <span>Re-Forecast</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Error banner if any */}
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
                <ICONS.AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* SVG Forecaster Canvas */}
            <div className="relative w-full h-[340px] bg-black/60 rounded-2xl border border-white/10 overflow-hidden select-none">
              {chartData && (
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-full"
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <defs>
                    {/* Outer p10-p90 gradient */}
                    <linearGradient id="p10p90Grad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#BF953F" stopOpacity="0.35" />
                      <stop offset="50%" stopColor="#BF953F" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="#BF953F" stopOpacity="0.35" />
                    </linearGradient>

                    {/* Inner p25-p75 gradient */}
                    <linearGradient id="p25p75Grad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#FCF6BA" stopOpacity="0.45" />
                      <stop offset="50%" stopColor="#BF953F" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#FCF6BA" stopOpacity="0.45" />
                    </linearGradient>

                    {/* Glowing trajectory filter */}
                    <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {chartData.yTicks.map((tick, i) => (
                    <g key={i}>
                      <line
                        x1={padding.left}
                        y1={tick.y}
                        x2={chartWidth - padding.right}
                        y2={tick.y}
                        stroke="rgba(255,255,255,0.06)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={padding.left - 10}
                        y={tick.y + 3}
                        fill="#6B7280"
                        fontSize="9"
                        fontFamily="monospace"
                        textAnchor="end"
                      >
                        {tick.label}
                      </text>
                    </g>
                  ))}

                  {/* Vertical Horizon Boundary Line */}
                  <line
                    x1={chartData.splitX}
                    y1={padding.top}
                    x2={chartData.splitX}
                    y2={chartHeight - padding.bottom}
                    stroke="#BF953F"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                    opacity="0.6"
                  />
                  <text
                    x={chartData.splitX + 6}
                    y={padding.top + 14}
                    fill="#FCF6BA"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                    opacity="0.8"
                  >
                    HORIZON &rarr;
                  </text>

                  {/* Shaded Confidence Bands */}
                  {showP10P90 && (
                    <path d={chartData.p10p90AreaStr} fill="url(#p10p90Grad)" />
                  )}

                  {showP25P75 && (
                    <path d={chartData.p25p75AreaStr} fill="url(#p25p75Grad)" />
                  )}

                  {/* Historical Trajectory Path */}
                  <path
                    d={chartData.historyPathStr}
                    fill="none"
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* P50 Forecast Trajectory Path */}
                  <path
                    d={chartData.p50PathStr}
                    fill="none"
                    stroke="#FCF6BA"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#goldGlow)"
                  />

                  {/* Anomaly Highlight Circles */}
                  {chartData.anomalyPoints.map((pt, i) => pt && (
                    <g key={i}>
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="5"
                        fill={pt.anom.type === 'spike' ? '#10B981' : '#EF4444'}
                        stroke="#000"
                        strokeWidth="1.5"
                        className="animate-pulse"
                      />
                    </g>
                  ))}

                  {/* Interactive Crosshair Hover Area */}
                  {chartData.allPoints.map((pt, i) => {
                    const x = chartData.scaleX(i);
                    const widthPerStep = innerWidth / Math.max(1, chartData.allPoints.length);
                    return (
                      <rect
                        key={i}
                        x={x - widthPerStep / 2}
                        y={padding.top}
                        width={widthPerStep}
                        height={innerHeight}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoverIndex(i)}
                      />
                    );
                  })}

                  {/* Active Hover Crosshair Line & Dot */}
                  {hoverIndex !== null && chartData.allPoints[hoverIndex] && (() => {
                    const x = chartData.scaleX(hoverIndex);
                    const pt = chartData.allPoints[hoverIndex];
                    const y = pt.type === 'history' ? chartData.scaleY(pt.val) : chartData.scaleY(pt.p50);
                    return (
                      <g>
                        <line
                          x1={x}
                          y1={padding.top}
                          x2={x}
                          y2={chartHeight - padding.bottom}
                          stroke="#FCF6BA"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r="5"
                          fill="#FCF6BA"
                          stroke="#000"
                          strokeWidth="2"
                        />
                      </g>
                    );
                  })()}

                  {/* X-axis Date Ticks */}
                  {chartData.xTicks.map((tick, i) => (
                    <text
                      key={i}
                      x={tick.x}
                      y={chartHeight - padding.bottom + 18}
                      fill="#6B7280"
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {tick.label}
                    </text>
                  ))}
                </svg>
              )}

              {/* Hover Floating Tooltip */}
              {hoverPoint && (
                <div className="absolute top-3 right-3 glass-morphism rounded-xl border border-[#BF953F]/40 p-3 bg-black/95 text-xs shadow-2xl pointer-events-none animate-in fade-in duration-200">
                  <div className="flex items-center justify-between gap-4 mb-1 border-b border-white/10 pb-1">
                    <span className="font-mono text-[#FCF6BA] font-bold">{hoverPoint.dateStr}</span>
                    <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/10 text-gray-300">
                      {hoverPoint.type === 'history' ? 'Historical' : 'TimesFM Projected'}
                    </span>
                  </div>

                  {hoverPoint.type === 'history' ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-gray-400">Actual:</span>
                      <span className="text-base font-bold font-mono text-white">
                        {hoverPoint.val.toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1 font-mono text-[11px]">
                      <div className="flex items-center justify-between gap-3 text-[#FCF6BA] font-bold">
                        <span>p50 (Median):</span>
                        <span>{hoverPoint.p50?.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-gray-400">
                        <span>p10 - p90:</span>
                        <span>{hoverPoint.p10?.toLocaleString()} — {hoverPoint.p90?.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-gray-500 text-[10px]">
                        <span>p25 - p75:</span>
                        <span>{hoverPoint.p25?.toLocaleString()} — {hoverPoint.p75?.toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom KPI Metrics Ribbon */}
            {kpis && (
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="glass-morphism rounded-xl p-3.5 border border-white/10 bg-black/40">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Horizon Median (p50)
                  </p>
                  <p className="text-xl font-bold font-mono text-[#FCF6BA] flex items-baseline gap-2">
                    <span>{kpis.finalP50.toLocaleString()}</span>
                    <span className={`text-xs ${kpis.diffPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {kpis.diffPct >= 0 ? '+' : ''}{kpis.diffPct}%
                    </span>
                  </p>
                </div>

                <div className="glass-morphism rounded-xl p-3.5 border border-white/10 bg-black/40">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Uncertainty Cone Spread
                  </p>
                  <p className="text-xl font-bold font-mono text-white">
                    &plusmn;{kpis.uncertaintyPct}%
                  </p>
                  <p className="text-[9px] font-mono text-gray-500 mt-0.5">
                    [{kpis.finalP10.toLocaleString()} .. {kpis.finalP90.toLocaleString()}]
                  </p>
                </div>

                <div className="glass-morphism rounded-xl p-3.5 border border-white/10 bg-black/40">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Directional Fit Score
                  </p>
                  <p className="text-xl font-bold font-mono text-emerald-400">
                    {kpis.directionalAccuracy}%
                  </p>
                  <p className="text-[9px] font-mono text-gray-500 mt-0.5">
                    Backtest MAPE: {kpis.mape}%
                  </p>
                </div>

                <div className="glass-morphism rounded-xl p-3.5 border border-white/10 bg-black/40">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Detected Structural Breaks
                  </p>
                  <p className="text-xl font-bold font-mono text-[#BF953F]">
                    {kpis.anomalyCount}
                  </p>
                  <p className="text-[9px] font-mono text-gray-500 mt-0.5">
                    Historical residual outliers
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Executive Strategic Takeaways / Synthesis */}
          {result?.executiveSummary && (
            <div className="glass-morphism rounded-2xl border border-[#BF953F]/40 p-6 sm:p-8 bg-black/90 shadow-2xl animate-in fade-in duration-500">
              <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#BF953F] shadow-[0_0_8px_#BF953F]"></div>
                  <h3 className="text-base font-bold uppercase tracking-widest text-[#FCF6BA]">
                    TimesFM Executive Intelligence Briefing
                  </h3>
                </div>
                <button
                  onClick={handleCopyReport}
                  className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition-all flex items-center gap-1.5"
                >
                  <ICONS.Share className="w-3.5 h-3.5 text-[#FCF6BA]" />
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
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="glass-morphism border border-[#BF953F]/40 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden relative bg-black/95">
            <div className="bg-gradient-to-r from-[#BF953F]/20 to-transparent px-6 py-4 border-b border-[#BF953F]/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ICONS.FileText className="w-4 h-4 text-[#FCF6BA]" />
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Ingest Time-Series Dataset</h3>
              </div>
              <button onClick={() => setIsUploadOpen(false)} className="text-gray-400 hover:text-white">
                <ICONS.X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
                  Upload CSV or TSV File
                </label>
                <label className="border-2 border-dashed border-white/15 hover:border-[#BF953F]/60 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors group">
                  <ICONS.FileText className="w-8 h-8 text-[#FCF6BA]/60 group-hover:text-[#FCF6BA] mb-2" />
                  <span className="text-xs text-gray-300 group-hover:text-white font-medium">Click to browse file (.csv, .tsv, .txt)</span>
                  <span className="text-[10px] text-gray-500 mt-1">Columns: Date/Timestamp, Metric Value</span>
                  <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-300 mb-2">
                  Or Paste Raw Numbers / CSV Lines
                </label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="2026-01-01, 1420&#10;2026-01-02, 1490&#10;2026-01-03, 1510..."
                  rows={5}
                  className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl p-3 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setIsUploadOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyCustomData}
                  disabled={!pasteText.trim()}
                  className="px-6 py-2 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black font-bold text-xs uppercase tracking-wider disabled:opacity-30"
                >
                  Load & Ingest
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
