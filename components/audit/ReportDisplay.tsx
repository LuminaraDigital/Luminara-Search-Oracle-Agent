import React, { useState, useMemo } from 'react';
import { ICONS } from '../../constants';
import { ROICalculator } from './ROICalculator';
import { VisibilityRadar } from './VisibilityRadar';
import { CompetitorMap } from './CompetitorMap';
import { DiffViewerModal } from './DiffViewerModal';
import { CmsDeploymentModal } from './CmsDeploymentModal';
import { EmpiricalEvidenceDrawer } from './EmpiricalEvidenceDrawer';
import { WhiteLabelExportModal } from './WhiteLabelExportModal';
import { EntityAuthorityCard } from './EntityAuthorityCard';
import { TrustPackPanel } from './TrustPackPanel';
import { WritingQualityCard } from './WritingQualityCard';
import { ResultsTrackingCard } from './ResultsTrackingCard';
import { VisibilityTrendsCard } from './VisibilityTrendsCard';
import { ShareOfVoiceCard } from './ShareOfVoiceCard';
import { SourceCitationGraphView } from './SourceCitationGraph';
import { EnterpriseTrustPanel } from './EnterpriseTrustPanel';
import { ShipActionGate } from './ShipActionGate';
import { readShipCommitment, type ShipCommitment } from '../../services/audit/shipCommitmentService';
import { RemediationPayload } from '../../services/deployment/cmsDeploymentService';
import { EmpiricalCitationSummary } from '../../services/audit/empiricalCitationService';
import { EnrichedEntityIntelligence } from '../../services/enrichment/publicApisEnrichmentService';
import type { WritingQualityReport } from '../../services/audit/writingQualityService';
import type { TrafficImpact } from '../../services/analytics/trafficInsightsService';
import type { CitationIntegrityResult } from '../../services/audit/citationIntegrityService';
import type { TrustPackSummary } from '../../services/audit/aeoTrustPackService';
import type { ShareOfVoiceSummary } from '../../services/visibility/shareOfVoiceService';
import type { SourceCitationGraph } from '../../services/visibility/sourceCitationGraphService';
import type { EnterpriseTrustPack } from '../../services/trust/enterpriseTrustPackService';
import { HighlightedText, parseInlineFormatting } from './HighlightedText';
import { MetricModal } from './MetricModal';
import { InteractiveTable } from './InteractiveTable';
import { CollapsibleSection } from './CollapsibleSection';

export { HighlightedText, parseInlineFormatting, MetricModal, InteractiveTable, CollapsibleSection };

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
  shareOfVoice?: ShareOfVoiceSummary;
  sourceGraph?: SourceCitationGraph;
  enterpriseTrust?: EnterpriseTrustPack;
}

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
  shareOfVoice,
  sourceGraph,
  enterpriseTrust,
}) => {
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showEvidenceDrawer, setShowEvidenceDrawer] = useState(false);
  const [showWhiteLabelModal, setShowWhiteLabelModal] = useState(false);
  const [shipCommitment, setShipCommitment] = useState<ShipCommitment | null>(() =>
    readShipCommitment(targetDomain || 'unknown', markdownText),
  );

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
  const sourceCount = validSources?.length || 0;
  const hasEvidence = Boolean(
    (empiricalSummary && empiricalSummary.citationRatePercent != null) || sourceCount > 0,
  );
  const reportUnlocked = Boolean(shipCommitment);

  return (
    <div className="w-full text-gray-200 animate-in fade-in duration-500">
      {!reportUnlocked && (
        <ShipActionGate
          domain={targetDomain}
          markdownText={markdownText}
          hasEvidence={hasEvidence}
          sourceCount={sourceCount}
          onCommitted={setShipCommitment}
          onDeploy={() => setShowDeployModal(true)}
        />
      )}

      {reportUnlocked && (
      <>
      {/* Action bar after ship commitment */}
      <div className="mb-6 glass-morphism rounded-2xl border border-gold/40 p-4 sm:p-5 bg-black/80 shadow-2xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-success-400 animate-pulse"></span>
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-gold-light">
                Committed: {shipCommitment?.label}
              </span>
            </div>
            <p className="text-xs text-gray-300">
              Full report unlocked. Ship the move, then use deploy or export when you need them.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <button
              type="button"
              onClick={() => setShowDeployModal(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gold/20 flex items-center gap-1.5 shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <ICONS.Zap className="w-4 h-4 text-black" />
              <span>1-Click Deploy</span>
            </button>

            <button
              type="button"
              onClick={() => setShowDiffModal(true)}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-gold/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <ICONS.Terminal className="w-4 h-4 text-gold" />
              <span>View Diff</span>
            </button>

            {empiricalSummary && (
              <button
                type="button"
                onClick={() => setShowEvidenceDrawer(true)}
                className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-success-500/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                <ICONS.Radar className="w-4 h-4 text-success-400" />
                <span>Evidence ({empiricalSummary.citationRatePercent}%)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowWhiteLabelModal(true)}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-info-500/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <ICONS.Download className="w-4 h-4 text-info-400" />
              <span>Agency PDF</span>
            </button>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Evidence is always visible (cite-or-silence), even before unlock */}
      {empiricalSummary && !reportUnlocked && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowEvidenceDrawer(true)}
            className="px-3.5 py-2 rounded-xl glass-morphism border border-success-500/30 text-xs font-mono text-success-200 hover:text-white flex items-center gap-1.5 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            <ICONS.Radar className="w-4 h-4 text-success-400" />
            Preview evidence ({empiricalSummary.citationRatePercent}%)
          </button>
        </div>
      )}

      {reportUnlocked && (
      <>
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

      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VisibilityTrendsCard domain={targetDomain || remediationPayload?.domain || ''} />
        <ShareOfVoiceCard summary={shareOfVoice} />
      </div>

      {sourceGraph && (
        <div className="mb-6">
          <SourceCitationGraphView graph={sourceGraph} />
        </div>
      )}

      {enterpriseTrust && (
        <div className="mb-6">
          <EnterpriseTrustPanel pack={enterpriseTrust} />
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
      </>
      )}

      {/* Modals & Drawers (available from gate deploy / evidence preview) */}
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
