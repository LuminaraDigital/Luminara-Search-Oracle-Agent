import React from 'react';
import { ICONS } from '../../../constants';
import { TimesFmForecastResult, TimesFmFrequency } from '../../../types';

export interface TimesFMChartProps {
  seriesName: string;
  frequency: TimesFmFrequency;
  result: TimesFmForecastResult | null;
  chartData: any | null;
  hoverIndex: number | null;
  setHoverIndex: (idx: number | null) => void;
  hoverPoint: any | null;
  kpis: any | null;
  showP10P90: boolean;
  showP25P75: boolean;
  isExecuting: boolean;
  error: string | null;
  onExportCSV: () => void;
  onRunForecast: () => void;
}

const chartWidth = 900;
const chartHeight = 340;
const padding = { top: 30, right: 30, bottom: 40, left: 60 };
const innerWidth = chartWidth - padding.left - padding.right;
const innerHeight = chartHeight - padding.top - padding.bottom;

export const TimesFMChart: React.FC<TimesFMChartProps> = ({
  seriesName,
  frequency,
  result,
  chartData,
  hoverIndex,
  setHoverIndex,
  hoverPoint,
  kpis,
  showP10P90,
  showP25P75,
  isExecuting,
  error,
  onExportCSV,
  onRunForecast,
}) => {
  return (
    <div className="glass-morphism rounded-2xl border border-gold/30 p-6 bg-black/80 shadow-2xl relative overflow-hidden">
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
              <span className="w-3 h-0.5 bg-gold-light"></span>
              <span className="text-gold-light text-[11px] font-bold">TimesFM p50 Median</span>
            </div>
            {showP10P90 && (
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 bg-gold/20 border border-gold/40 rounded-sm"></span>
                <span className="text-gray-400 text-[11px]">p10-p90 Cone</span>
              </div>
            )}
            {result && result.anomalies.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-danger-400"></span>
                <span className="text-danger-400 text-[11px]">Anomalies ({result.anomalies.length})</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions: Export & Re-Run */}
        <div className="flex items-center gap-2">
          <button
            onClick={onExportCSV}
            disabled={!result}
            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-gray-300 hover:text-white transition-all flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:text-gray-300"
            title="Download CSV of Historical & Quantile Predictions"
          >
            <ICONS.FileText className="w-3 h-3 text-gold-light" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={onRunForecast}
            disabled={isExecuting}
            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs uppercase tracking-wider hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
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
        <div className="mb-4 p-3 rounded-xl bg-danger-950/40 border border-danger-500/40 text-danger-300 text-xs flex items-center gap-2">
          <ICONS.AlertTriangle className="w-4 h-4 text-danger-400 shrink-0" />
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
            {chartData.yTicks.map((tick: { y: number; label: string }, i: number) => (
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
            {chartData.anomalyPoints.map((pt: any, i: number) => pt && (
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
            {chartData.allPoints.map((_pt: any, i: number) => {
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
            {chartData.xTicks.map((tick: { x: number; label: string }, i: number) => (
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
          <div className="absolute top-3 right-3 glass-morphism rounded-xl border border-gold/40 p-3 bg-black/95 text-xs shadow-2xl pointer-events-none animate-in fade-in duration-200">
            <div className="flex items-center justify-between gap-4 mb-1 border-b border-white/10 pb-1">
              <span className="font-mono text-gold-light font-bold">{hoverPoint.dateStr}</span>
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
                <div className="flex items-center justify-between gap-3 text-gold-light font-bold">
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
            <p className="text-xl font-bold font-mono text-gold-light flex items-baseline gap-2">
              <span>{kpis.finalP50.toLocaleString()}</span>
              <span className={`text-xs ${kpis.diffPct >= 0 ? 'text-success-400' : 'text-danger-400'}`}>
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
            <p className="text-xl font-bold font-mono text-success-400">
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
            <p className="text-xl font-bold font-mono text-gold">
              {kpis.anomalyCount}
            </p>
            <p className="text-[9px] font-mono text-gray-500 mt-0.5">
              Historical residual outliers
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
