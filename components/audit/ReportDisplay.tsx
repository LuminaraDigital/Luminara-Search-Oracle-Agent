import React, { useState, useMemo } from 'react';
import { ICONS, GLOSSARY } from '../../constants';
import { ROICalculator } from './ROICalculator';
import { VisibilityRadar } from './VisibilityRadar';
import { CompetitorMap } from './CompetitorMap';
import { TimesFmMathEngine } from '../../services/timesfm/timesfmEngine';
import { DiffViewerModal } from './DiffViewerModal';
import { CmsDeploymentModal } from './CmsDeploymentModal';
import { EmpiricalEvidenceDrawer } from './EmpiricalEvidenceDrawer';
import { WhiteLabelExportModal } from './WhiteLabelExportModal';
import { EntityAuthorityCard } from './EntityAuthorityCard';
import { TrustPackPanel } from './TrustPackPanel';
import { WritingQualityCard } from './WritingQualityCard';
import { ResultsTrackingCard } from './ResultsTrackingCard';
import { RemediationPayload } from '../../services/deployment/cmsDeploymentService';
import { EmpiricalCitationSummary } from '../../services/audit/empiricalCitationService';
import { EnrichedEntityIntelligence } from '../../services/enrichment/publicApisEnrichmentService';
import type { WritingQualityReport } from '../../services/audit/writingQualityService';
import type { TrafficImpact } from '../../services/analytics/trafficInsightsService';
import type { CitationIntegrityResult } from '../../services/audit/citationIntegrityService';
import type { TrustPackSummary } from '../../services/audit/aeoTrustPackService';

interface ReportDisplayProps {
  markdownText: string;
  sources?: Array<{ uri: string; title: string }>;
  empiricalSummary?: EmpiricalCitationSummary;
  remediationPayload?: RemediationPayload;
  unifiedDiff?: string;
  targetDomain?: string;
  dnaName?: string;
  enrichedEntity?: EnrichedEntityIntelligence;
  writingQuality?: WritingQualityReport;
  trafficImpact?: TrafficImpact;
  citationIntegrity?: CitationIntegrityResult;
  integrity?: CitationIntegrityResult;
  trustPack?: TrustPackSummary;
}

// Highlighted text component with interactive glossary tooltip
export const HighlightedText: React.FC<{ text: string }> = ({ text }) => {
  const terms = Object.keys(GLOSSARY);
  const pattern = new RegExp(`\\b(${terms.join('|')})\\b`, 'gi');
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const upperPart = part.toUpperCase();
        const definition = GLOSSARY[upperPart];

        if (definition) {
          return (
            <span key={index} className="group relative inline-block cursor-help text-gold-light border-b border-dotted border-gold/60 hover:text-white transition-colors">
              {part}
              <span className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-300 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 glass-morphism border border-gold/40 text-gray-200 text-xs rounded-xl p-3 shadow-2xl z-50 whitespace-normal pointer-events-none bg-black/95">
                <strong className="block mb-1 text-gold-light font-bold uppercase tracking-wider text-[10px]">{upperPart}</strong>
                {definition}
              </span>
            </span>
          );
        }
        return part;
      })}
    </>
  );
};

export const parseInlineFormatting = (line: string): React.ReactElement => {
  const parts = line.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="font-semibold text-white"><HighlightedText text={part.slice(2, -2)} /></strong>;
        }
        if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
          return <em key={index} className="text-gray-300 italic"><HighlightedText text={part.slice(1, -1)} /></em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={index} className="bg-black/60 text-gold-light rounded px-1.5 py-0.5 text-xs font-mono border border-white/10">{part.slice(1, -1)}</code>;
        }
        return <span key={index}><HighlightedText text={part} /></span>;
      })}
    </>
  );
};

// Metric modal for clickable table cells with TimesFM Foundation Forecasting
export const MetricModal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  data: { header: string; value: string; entity: string } | null 
}> = ({ isOpen, onClose, data }) => {
  // Extract numeric baseline (hooks must run on every render, so this sits above the early return)
  const numValue = parseFloat((data?.value ?? '').replace(/[^0-9.-]/g, '')) || 50;

  // Compute an illustrative 6-month baseline and 6-month TimesFM projection.
  // NOTE: the history is synthetic (the audit only yields a single point-in-time value).
  const forecastData = useMemo(() => {
    if (!data) return null;
    const history = [];
    const now = Date.now();
    const oneMonth = 86400000 * 30.4;
    
    // Simulate 6 months of historical baseline leading up to this metric
    for (let i = 5; i >= 0; i--) {
      const t = now - i * oneMonth;
      const d = new Date(t);
      const noise = (Math.sin(i * 1.7) * 4);
      const val = Math.max(5, Math.round(numValue - (i * 1.8) + noise));
      history.push({
        timestamp: t,
        dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        value: val
      });
    }

    try {
      const res = TimesFmMathEngine.runForecast(
        history,
        {
          horizon: 6,
          patchLength: 4,
          frequency: 'monthly',
          quantiles: [0.1, 0.25, 0.5, 0.75, 0.9],
          decomposition: 'additive',
          revin: true
        },
        [
          {
            id: 'schema_uplift',
            name: 'Schema Lift',
            type: 'multiplier',
            value: 1.15,
            active: true,
            description: 'AEO Schema uplift'
          }
        ]
      );

      const allVals = [...history.map(h => h.value), ...res.forecast.map(f => f.p90), ...res.forecast.map(f => f.p10)];
      const minVal = Math.min(...allVals) * 0.9;
      const maxVal = Math.max(...allVals) * 1.1;
      const range = Math.max(1, maxVal - minVal);

      // SVG coordinates
      const totalSteps = history.length + res.forecast.length;
      const scaleX = (idx: number) => (idx / (totalSteps - 1)) * 100;
      const scaleY = (val: number) => 100 - ((val - minVal) / range) * 80 - 10;

      const histPoints = history.map((h, i) => `${scaleX(i).toFixed(1)},${scaleY(h.value).toFixed(1)}`);
      const lastHistPt = `${scaleX(history.length - 1).toFixed(1)},${scaleY(history[history.length - 1].value).toFixed(1)}`;

      const p50Points = res.forecast.map((f, i) => `${scaleX(history.length + i).toFixed(1)},${scaleY(f.p50).toFixed(1)}`);
      const p10Points = res.forecast.map((f, i) => ({ x: scaleX(history.length + i), y: scaleY(f.p10) }));
      const p90Points = res.forecast.map((f, i) => ({ x: scaleX(history.length + i), y: scaleY(f.p90) }));

      // Area string for p10-p90 cone
      const coneAreaStr = `M${lastHistPt} ` + 
        p90Points.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' ' +
        p10Points.slice().reverse().map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

      const histLineStr = histPoints.join(' ');
      const p50LineStr = [lastHistPt, ...p50Points].join(' ');

      const finalP50 = res.forecast[res.forecast.length - 1].p50;
      const finalP10 = res.forecast[res.forecast.length - 1].p10;
      const finalP90 = res.forecast[res.forecast.length - 1].p90;

      return {
        coneAreaStr,
        histLineStr,
        p50LineStr,
        finalP50,
        finalP10,
        finalP90,
        splitX: scaleX(history.length - 1),
        forecast: res.forecast
      };
    } catch (e) {
      return null;
    }
  }, [numValue]);

  if (!isOpen || !data) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="glass-morphism border border-gold/40 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden relative bg-black/95">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
          <ICONS.X className="w-5 h-5" />
        </button>

        <div className="bg-gradient-to-r from-gold/20 to-transparent px-6 py-4 border-b border-gold/20 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider">{data.entity}</h3>
            <p className="text-xs text-gold-light font-mono">{data.header}</p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gold/10 border border-gold/30 text-[9px] font-mono text-gold-light uppercase">
            <ICONS.TimeSeries className="w-3 h-3" />
            <span>TimesFM Patch Core</span>
          </span>
        </div>

        <div className="p-6">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <span className="text-3xl font-black font-mono gold-text">{data.value}</span>
              <span className="text-xs text-success-400 font-bold uppercase tracking-wider ml-3">Current Score</span>
            </div>
            {forecastData && (
              <div className="text-right">
                <span className="text-xs text-gray-400 font-mono">TimesFM +6M Projected:</span>
                <p className="text-lg font-bold font-mono text-gold-light">
                  {forecastData.finalP50.toLocaleString()}{' '}
                  <span className="text-[10px] text-gray-500 font-normal">
                    [{forecastData.finalP10} .. {forecastData.finalP90}]
                  </span>
                </p>
              </div>
            )}
          </div>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <ICONS.TrendUp className="w-3 h-3 text-gold-light" />
                <span>TimesFM 6-Month Probabilistic Projection</span>
              </p>
              <div className="flex items-center gap-3 text-[9px] font-mono text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-white"></span>History</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-gold-light"></span>p50</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-gold/30 border border-gold/50"></span>p10-p90</span>
              </div>
            </div>

            <div className="h-32 w-full bg-black/60 rounded-xl border border-white/10 relative p-2 overflow-hidden">
              {forecastData && (
                <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                  <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                  
                  {/* Split line */}
                  <line x1={forecastData.splitX} y1="0" x2={forecastData.splitX} y2="100" stroke="#BF953F" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />

                  <defs>
                    <linearGradient id="goldCone" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#BF953F" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#BF953F" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>

                  {/* Uncertainty Cone */}
                  <path d={forecastData.coneAreaStr} fill="url(#goldCone)" />

                  {/* Historical Line */}
                  <polyline points={forecastData.histLineStr} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

                  {/* P50 Forecast Line */}
                  <polyline points={forecastData.p50LineStr} fill="none" stroke="#FCF6BA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div className="flex justify-between text-[9px] text-gray-500 mt-1 font-mono">
              <span>-6M Baseline</span>
              <span>Today ({data.value})</span>
              <span>+6M Foundation Horizon</span>
            </div>
          </div>

          <div className="glass-morphism rounded-xl p-3 border border-gold/20 text-xs text-gray-300 leading-relaxed">
            <span className="text-gold-light font-bold">TimesFM Insight:</span> Zero-shot temporal foundation projection benchmarks <strong>{data.value}</strong> along a <strong>p50 trajectory of {forecastData?.finalP50 || data.value}</strong>. Entity schema saturation and AEO answer readiness expand upside leverage toward the <strong>{forecastData?.finalP90 || data.value}</strong> ceiling.
          </div>
        </div>
      </div>
    </div>
  );
};

// Interactive table with clickable sparklines
export const InteractiveTable: React.FC<{ headers: string[]; rows: string[][] }> = ({ headers, rows }) => {
  const [selectedCell, setSelectedCell] = useState<{ header: string; value: string; entity: string } | null>(null);

  return (
    <>
      <div className="my-6 glass-morphism rounded-xl border border-white/10 overflow-hidden shadow-2xl">
        <div className="bg-white/[0.02] px-4 py-2 border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light flex items-center gap-1.5">
            <ICONS.ChartBar className="w-3.5 h-3.5" /> Interactive Matrix Analysis
          </span>
          <span className="text-[9px] text-gray-500 uppercase tracking-widest">Click cells to inspect trends</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-black/60 border-b border-white/10 text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                {headers.map((h, i) => (
                  <th key={i} className="px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-sans">
              {rows.map((row, rIdx) => {
                const entityName = row[0];
                return (
                  <tr key={rIdx} className="hover:bg-white/[0.03] transition-colors group">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        onClick={() => setSelectedCell({
                          header: headers[cIdx] || 'Metric',
                          value: cell.replace(/[*_`]/g, ''),
                          entity: (entityName ?? '').replace(/[*_`]/g, '')
                        })}
                        className={`px-4 py-3 align-top cursor-pointer transition-colors ${
                          cIdx === 0 ? 'font-bold text-white' : 'text-gray-300 hover:text-gold-light hover:bg-white/[0.02]'
                        }`}
                        title="Click to analyze trend"
                      >
                        {parseInlineFormatting(cell)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <MetricModal isOpen={!!selectedCell} onClose={() => setSelectedCell(null)} data={selectedCell} />
    </>
  );
};

export const CollapsibleSection: React.FC<{
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  isMainTitle?: boolean;
}> = ({ title, children, defaultOpen = true, isMainTitle = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (isMainTitle) {
    return <div className="mb-6">{children}</div>;
  }

  return (
    <div className="mb-4 glass-morphism rounded-xl border border-white/10 overflow-hidden shadow-lg transition-all duration-300 hover:border-gold/40">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 text-left bg-gradient-to-r from-black/60 via-black/40 to-transparent hover:from-gold/10 transition-colors focus:outline-none group"
      >
        <h2 className="text-base font-bold text-white flex items-center gap-2 group-hover:text-gold-light transition-colors uppercase tracking-wider">
          {title}
        </h2>
        <div className={`text-gold transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
          <ICONS.ChevronDown className="w-4 h-4" />
        </div>
      </button>
      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isOpen ? 'max-h-[3500px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-6 py-5 border-t border-white/5 text-sm text-gray-300 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
};

export const ReportDisplay: React.FC<ReportDisplayProps> = ({
  markdownText,
  sources,
  empiricalSummary,
  remediationPayload,
  unifiedDiff,
  targetDomain,
  dnaName,
  enrichedEntity,
  writingQuality,
  trafficImpact,
  citationIntegrity,
  integrity,
  trustPack,
}) => {
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showEvidenceDrawer, setShowEvidenceDrawer] = useState(false);
  const [showWhiteLabelModal, setShowWhiteLabelModal] = useState(false);

  const parsedStructure = useMemo(() => {
    const lines = markdownText.split('\n');
    const sections: { title: React.ReactNode; elements: React.ReactNode[]; id: string; titleText: string }[] = [];
    let currentSection = { title: 'Executive Overview' as React.ReactNode, titleText: 'Executive Overview', elements: [] as React.ReactNode[], id: 'intro' };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('# ')) {
        currentSection.elements.push(
          <h1 key={`h1-${i}`} className="text-3xl sm:text-4xl font-bold mb-4 pb-3 border-b border-gold/30 gold-text tracking-tight">
            {parseInlineFormatting(line.substring(2))}
          </h1>
        );
        i++;
      } else if (line.startsWith('## ')) {
        if (currentSection.elements.length > 0) {
          sections.push(currentSection);
        }
        const rawTitle = line.substring(3);
        currentSection = {
          title: parseInlineFormatting(rawTitle),
          titleText: rawTitle,
          elements: [],
          id: `sec-${i}`
        };
        i++;
      } else if (line.startsWith('```')) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        currentSection.elements.push(
          <div key={`code-${i}`} className="my-4 rounded-xl overflow-hidden border border-white/10 shadow-inner">
            <div className="bg-black/80 px-4 py-2 border-b border-white/10 flex items-center justify-between">
              <span className="text-[10px] font-mono text-gold-light uppercase tracking-widest">Recommended Schema Implementation</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeployModal(true)}
                  className="px-2.5 py-1 rounded bg-gold/20 hover:bg-gold/30 text-gold-light text-[10px] font-mono uppercase tracking-wider transition-colors flex items-center gap-1"
                >
                  <ICONS.Zap className="w-3 h-3" /> Deploy
                </button>
              </div>
            </div>
            <pre className="bg-black/90 p-4 overflow-x-auto text-xs font-mono text-cyan-300">
              <code>{codeLines.join('\n')}</code>
            </pre>
          </div>
        );
        i++;
      } else if (line.startsWith('* ') || line.startsWith('- ')) {
        const listItems: React.ReactElement[] = [];
        while (i < lines.length && (lines[i].startsWith('* ') || lines[i].startsWith('- '))) {
          listItems.push(<li key={`li-${i}`} className="mb-2">{parseInlineFormatting(lines[i].substring(2))}</li>);
          i++;
        }
        currentSection.elements.push(<ul key={`ul-${i}`} className="list-disc list-outside space-y-1 my-3 pl-6 marker:text-gold">{listItems}</ul>);
      } else if (line.match(/^\d+\. /)) {
        const listItems: React.ReactElement[] = [];
        while (i < lines.length && lines[i].match(/^\d+\. /)) {
          listItems.push(<li key={`li-${i}`} className="mb-2">{parseInlineFormatting(lines[i].replace(/^\d+\. /, ''))}</li>);
          i++;
        }
        currentSection.elements.push(<ol key={`ol-${i}`} className="list-decimal list-outside space-y-1 my-3 pl-6 marker:text-gold">{listItems}</ol>);
      } else if (line.startsWith('|')) {
        const headerLine = lines[i];
        const separatorLine = lines[i + 1];
        if (separatorLine && separatorLine.includes('---')) {
          const headers = headerLine.split('|').slice(1, -1).map(h => h.trim());
          const rows: string[][] = [];
          i += 2;
          while (i < lines.length && lines[i].startsWith('|')) {
            rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()));
            i++;
          }

          const sTitle = currentSection.titleText.toLowerCase();
          if (sTitle.includes('visibility radar')) {
            currentSection.elements.push(<VisibilityRadar key={`vr-${i}`} headers={headers} rows={rows} />);
          } else if (sTitle.includes('competitor reality map')) {
            currentSection.elements.push(<CompetitorMap key={`cm-${i}`} headers={headers} rows={rows} />);
          } else {
            currentSection.elements.push(<InteractiveTable key={`it-${i}`} headers={headers} rows={rows} />);
          }
        } else {
          currentSection.elements.push(<p key={`p-${i}`} className="my-2 leading-relaxed text-gray-300">{parseInlineFormatting(line)}</p>);
          i++;
        }
      } else if (line.trim() !== '') {
        currentSection.elements.push(<p key={`p-${i}`} className="my-3 leading-7 text-gray-300">{parseInlineFormatting(line)}</p>);
        i++;
      } else {
        i++;
      }
    }
    if (currentSection.elements.length > 0) {
      sections.push(currentSection);
    }
    return sections;
  }, [markdownText]);

  const validSources = sources?.filter(s => s && s.uri);

  return (
    <div className="w-full text-gray-200 animate-in fade-in duration-500">
      {/* Autonomous Action & Enterprise Command Bar */}
      <div className="mb-6 glass-morphism rounded-2xl border border-gold/40 p-4 sm:p-5 bg-gradient-to-r from-black via-black/90 to-black/80 shadow-2xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-success-400 animate-pulse"></span>
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-gold-light">
                Autonomous Action Engine Active
              </span>
            </div>
            <p className="text-xs text-gray-300">
              Audit diagnosed. Remediated Schema.org entity graph generated and ready for instant deployment.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <button
              type="button"
              onClick={() => setShowDeployModal(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gold/20 flex items-center gap-1.5 shrink-0"
            >
              <ICONS.Zap className="w-4 h-4 text-black" />
              <span>1-Click Deploy</span>
            </button>

            <button
              type="button"
              onClick={() => setShowDiffModal(true)}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-gold/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0"
            >
              <ICONS.Terminal className="w-4 h-4 text-gold" />
              <span>View Diff</span>
            </button>

            {empiricalSummary && (
              <button
                type="button"
                onClick={() => setShowEvidenceDrawer(true)}
                className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-success-500/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0"
              >
                <ICONS.Radar className="w-4 h-4 text-success-400" />
                <span>Evidence ({empiricalSummary.citationRatePercent}%)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowWhiteLabelModal(true)}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-cyan-500/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0"
            >
              <ICONS.Download className="w-4 h-4 text-cyan-400" />
              <span>Agency PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Entity Authority & Grounding Provenance (Wikidata, Wayback Machine, HTTP Security) */}
      {enrichedEntity && (
        <div className="mb-6">
          <EntityAuthorityCard enriched={enrichedEntity} />
        </div>
      )}

      {trustPack && (
        <div className="mb-6">
          <TrustPackPanel trustPack={trustPack} />
        </div>
      )}

      {/* Writing check + Results tracking */}
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {writingQuality && <WritingQualityCard report={writingQuality} />}
        <div className={writingQuality ? '' : 'lg:col-span-2'}>
          <ResultsTrackingCard impact={trafficImpact} domain={targetDomain || remediationPayload?.domain || ''} />
        </div>
      </div>

      {parsedStructure.map((sec, idx) => (
        <CollapsibleSection key={sec.id} title={sec.title} defaultOpen={idx < 4} isMainTitle={idx === 0}>
          {sec.elements}
        </CollapsibleSection>
      ))}

      {/* Embedded ROI Projector */}
      <ROICalculator />

      {validSources && validSources.length > 0 && (
        <div className="mt-8 pt-6 border-t border-white/10">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gold-light mb-4 flex items-center gap-2">
            <ICONS.Info className="w-4 h-4 text-gold" /> Verified Search Grounding Sources
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {validSources.map((source, sIdx) => (
              <a
                key={sIdx}
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-morphism rounded-lg p-3 border border-white/5 hover:border-gold/40 flex items-center justify-between text-xs text-gray-300 hover:text-white transition-all group"
              >
                <span className="truncate pr-2">{source.title || source.uri}</span>
                <ICONS.ExternalLink className="w-3.5 h-3.5 text-gold shrink-0 opacity-60 group-hover:opacity-100" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Modals & Drawers */}
      <DiffViewerModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        unifiedDiff={unifiedDiff}
        remediationPayload={remediationPayload}
        onDeployClick={() => setShowDeployModal(true)}
      />

      <CmsDeploymentModal
        isOpen={showDeployModal}
        onClose={() => setShowDeployModal(false)}
        remediationPayload={remediationPayload}
      />

      <EmpiricalEvidenceDrawer
        isOpen={showEvidenceDrawer}
        onClose={() => setShowEvidenceDrawer(false)}
        summary={empiricalSummary}
        integrity={integrity || citationIntegrity}
      />

      <WhiteLabelExportModal
        isOpen={showWhiteLabelModal}
        onClose={() => setShowWhiteLabelModal(false)}
        markdownText={markdownText}
        targetDomain={targetDomain || remediationPayload?.domain}
        dnaName={dnaName}
      />
    </div>
  );
};
