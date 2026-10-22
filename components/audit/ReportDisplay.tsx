import React, { useState, useMemo } from 'react';
import { ICONS } from '../../constants';
import { ROICalculator } from './ROICalculator';
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
import { WeeklyDecisionCard } from './WeeklyDecisionCard';
import { readShipCommitment, type ShipCommitment } from '../../services/audit/shipCommitmentService';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { pickPrimaryFinding } from '../../services/audit/findingBoardService';
import { RemediationPayload } from '../../services/deployment/cmsDeploymentService';
import { EmpiricalCitationSummary } from '../../services/audit/empiricalCitationService';
import { EnrichedEntityIntelligence } from '../../services/enrichment/publicApisEnrichmentService';
import type { WritingQualityReport } from '../../services/audit/writingQualityService';
import type { TrafficImpact } from '../../services/analytics/trafficInsightsService';
import type { CitationIntegrityResult } from '../../services/audit/citationIntegrityService';
import { visibleGroundingSources } from '../../services/audit/unmeasuredClaimGuard';
import type { TrustPackSummary } from '../../services/audit/aeoTrustPackService';
import type { ShareOfVoiceSummary } from '../../services/visibility/shareOfVoiceService';
import type { SourceCitationGraph } from '../../services/visibility/sourceCitationGraphService';
import type { EnterpriseTrustPack } from '../../services/trust/enterpriseTrustPackService';
import { HighlightedText, parseInlineFormatting } from './HighlightedText';
import { MetricModal } from './MetricModal';
import { InteractiveTable } from './InteractiveTable';
import { CollapsibleSection } from './CollapsibleSection';
import { AuditReportArticle } from './AuditReportArticle';
import { canCreateShareLinks, createShareReport } from '../../services/share/shareReportClient';
import { clientHasHostedIdentity, fetchQuotaStatus, getCurrentQuotaSync, loadServerHealth, openPaywallModal } from '../../services/apiClient';
import { entitlementsFor } from '../../services/plans/planEntitlements';
import { UpgradeSurfaces } from '../upgrade/UpgradeSurfaces';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import { liveDataUnavailableCopy } from '../../services/audit/guestScoutSummary';
import { buildAuditDossierHtml } from '../../services/reports/portableDossierService';
import { gateReportText } from '../../services/audit/reportColumnGate';
import type { HostedScoutRail } from '../../services/audit/hostedScoutRail';
import type { RLMTrajectoryMetadata } from '../../services/rlm/types';
import { RlmTrajectoryViewer } from '../rlm/RlmTrajectoryViewer';
import { HEALTH_SITE_NOTE, siteLooksHealthRelated } from '../../services/audit/healthClaimGuard';

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
  rlmTrajectory?: RLMTrajectoryMetadata;
  /** Instant Audit crew findings for Weekly Decision Card (never Oracle validators). */
  boardFindings?: BoardFinding[];
  /** Hide PDF / share / deploy chrome (public share pages). */
  hideAgencyActions?: boolean;
  /** Crew said this run was not measured. Hide numeric citation, share of voice, and health. */
  suppressLiveMetrics?: boolean;
  /** Instant Audit rail. When omitted, a live session still avoids a sign-in CTA. */
  hostedRail?: HostedScoutRail;
  /** True when the fetched page, domain, or saved DNA already looks health-related. */
  healthSite?: boolean;
}

/** "mentioned in N of M sampled queries", or null when the summary holds no such count. */
export function sampledMentionsLabel(summary: EmpiricalCitationSummary | undefined): string | null {
  if (!summary || summary.measurementStatus === 'not_measured' || summary.citationRatePercent == null) return null;
  const mentioned = summary.queriesCitedCount;
  const total = summary.totalQueriesTested;
  if (!Number.isInteger(mentioned) || !Number.isInteger(total) || total <= 0 || mentioned < 0 || mentioned > total) return null;
  return `mentioned in ${mentioned} of ${total} sampled queries`;
}

export const ReportDisplay: React.FC<ReportDisplayProps> = ({
  markdownText: rawMarkdownText,
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
  rlmTrajectory,
  boardFindings: boardFindingsProp,
  hideAgencyActions = false,
  suppressLiveMetrics = false,
  hostedRail,
  healthSite = false,
}) => {
  const showHealthNote = healthSite || siteLooksHealthRelated({ domain: targetDomain, title: dnaName });
  const hideLiveNumbers = suppressLiveMetrics || empiricalSummary?.measurementStatus === 'not_measured';
  // Every reader of this screen gets the gated text: the cards, the share link, the PDF and the dossier.
  // A stored or shared report was gated when it was made only if it was made after the gate existed.
  // No table in the report text is measured: the model writes its rows. Measured
  // traffic is drawn by ResultsTrackingCard from the analytics data, not from this text.
  const markdownText = useMemo(() => gateReportText(rawMarkdownText || ''), [rawMarkdownText]);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showEvidenceDrawer, setShowEvidenceDrawer] = useState(false);
  const [showWhiteLabelModal, setShowWhiteLabelModal] = useState(false);
  const [whiteLabelAsk, setWhiteLabelAsk] = useState(false);
  const [showRlmModal, setShowRlmModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shipCommitment, setShipCommitment] = useState<ShipCommitment | null>(() =>
    readShipCommitment(targetDomain || 'unknown', rawMarkdownText),
  );
  const [boardFindings, setBoardFindings] = useState<BoardFinding[]>(boardFindingsProp || []);

  React.useEffect(() => {
    if (boardFindingsProp) setBoardFindings(boardFindingsProp);
  }, [boardFindingsProp]);

  const primaryFinding = useMemo(() => pickPrimaryFinding(boardFindings), [boardFindings]);

  const handleCopyShareLink = async () => {
    productTelemetry.track('share_cta_clicked', { domain: targetDomain || null });
    await loadServerHealth().catch(() => undefined);
    await fetchQuotaStatus().catch(() => null);
    if (!canCreateShareLinks()) {
      // Soft-gate: guests need sign-in first; signed-in free/starter see Growth paywall.
      if (!getCurrentQuotaSync()) {
        setShareMessage('Sign in to create share links. Growth and Agency include share and MCP.');
        return;
      }
      openPaywallModal('Share links are included on Growth and Agency plans.');
      return;
    }
    setShareBusy(true);
    setShareMessage(null);
    try {
      let branding: Record<string, string> | undefined;
      try {
        const saved = JSON.parse(localStorage.getItem('luminara_whitelabel_config') || '{}') as Record<string, string>;
        if (saved.agencyName || saved.agencyLogoUrl) {
          branding = {
            agencyName: saved.agencyName,
            logoUrl: saved.agencyLogoUrl,
            accentColor: saved.primaryColor,
            preparedBy: saved.preparedBy,
            clientName: dnaName || targetDomain || '',
          };
        }
      } catch { /* ignore */ }

      const res = await createShareReport({
        markdownText,
        domain: targetDomain,
        dnaName,
        sources,
        branding,
      });
      if (!res.ok || !res.url) {
        setShareMessage(res.error || 'Could not create share link');
        return;
      }
      productTelemetry.track('share_link_created', { domain: targetDomain || null });
      try {
        await navigator.clipboard.writeText(res.url);
        setShareMessage('Share link copied');
      } catch {
        setShareMessage(res.url);
      }
      window.setTimeout(() => setShareMessage(null), 4000);
    } finally {
      setShareBusy(false);
    }
  };

  const handleDownloadDossier = () => {
    const domain = targetDomain || 'audit-target';
    const html = buildAuditDossierHtml({
      domain,
      markdownText: markdownText || '',
      generatedAt: Date.now(),
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${domain.replace(/[^a-z0-9.-]/gi, '_')}-dossier.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const validSources = visibleGroundingSources(sources);
  const sourceCount = validSources?.length || 0;
  const hasEvidence = Boolean(
    (!hideLiveNumbers && empiricalSummary && empiricalSummary.citationRatePercent != null) || sourceCount > 0,
  );
  const reportUnlocked = hideAgencyActions || Boolean(shipCommitment);
  // The two counts the search sample gave, not a percentage of them.
  const evidenceLabel = (hideLiveNumbers ? null : sampledMentionsLabel(empiricalSummary)) || 'not measured';
  const unavailableCopy = liveDataUnavailableCopy(
    hostedRail ?? (clientHasHostedIdentity() ? 'signed_in_hosted' : 'byok_or_signin'),
  );

  return (
    <div className="w-full text-gray-200 animate-in fade-in duration-500">
      {hideLiveNumbers && (
        <p role="status" className="mb-4 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm leading-relaxed text-gray-200">
          {unavailableCopy}
        </p>
      )}
      {!hideAgencyActions && (
        <div className="mb-6 rounded-2xl border border-gold/40 p-4 sm:p-5 bg-black/80 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold-light mb-1">
                Next step
              </p>
              <p className="text-sm text-gray-100 font-medium">
                Share this audit with a teammate or client
              </p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Growth and Agency include public share links. Free insight stays free; share is a paid unlock.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyShareLink()}
              disabled={shareBusy}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-wider hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-gold/20 flex items-center justify-center gap-1.5 shrink-0 w-full sm:w-auto focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:opacity-50"
            >
              <ICONS.Share className="w-4 h-4 text-black" />
              <span>{shareBusy ? 'Sharing...' : 'Copy share link'}</span>
            </button>
          </div>
          {shareMessage && (
            <p className="text-[10px] font-mono text-gold-light mt-3 break-all" role="status">
              {shareMessage}
            </p>
          )}
        </div>
      )}

      {showHealthNote && (
        <p className="mb-6 text-sm leading-relaxed text-gray-300 max-w-2xl" role="note">
          {HEALTH_SITE_NOTE}
        </p>
      )}

      <AuditReportArticle
        markdown={markdownText}
        measured={!hideLiveNumbers}
        findings={boardFindings}
        domain={targetDomain}
        clientName={dnaName}
        sources={sources}
        showActions={!hideAgencyActions}
        onShare={hideAgencyActions ? undefined : () => void handleCopyShareLink()}
        onFindings={setBoardFindings}
      />

      <UpgradeSurfaces
        domain={targetDomain}
        findings={boardFindings}
        whiteLabelAsk={whiteLabelAsk}
        onCloseWhiteLabel={() => setWhiteLabelAsk(false)}
        measured={!hideLiveNumbers}
        reportText={markdownText}
        showWin={!hideAgencyActions}
      />

      {!reportUnlocked && !hideAgencyActions && (
        <ShipActionGate
          domain={targetDomain}
          markdownText={rawMarkdownText}
          hasEvidence={hasEvidence}
          sourceCount={sourceCount}
          onCommitted={setShipCommitment}
          onDeploy={() => setShowDeployModal(true)}
        />
      )}

      {!hideAgencyActions && (
        <WeeklyDecisionCard
          domain={targetDomain || 'unknown'}
          primary={primaryFinding}
          findings={boardFindings}
          commitment={shipCommitment}
          evidence={empiricalSummary?.evidenceList}
          rawSources={sources}
          onFindingUpdated={(f) => {
            setBoardFindings((prev) => {
              const i = prev.findIndex((x) => x.id === f.id || x.stableKey === f.stableKey);
              if (i < 0) return [f, ...prev];
              const next = [...prev];
              next[i] = f;
              return next;
            });
          }}
        />
      )}

      {reportUnlocked && !hideAgencyActions && (
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
              onClick={() => void handleCopyShareLink()}
              disabled={shareBusy}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gold/20 flex items-center gap-1.5 shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:opacity-50"
            >
              <ICONS.Share className="w-4 h-4 text-black" />
              <span>{shareBusy ? 'Sharing...' : 'Copy share link'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowDeployModal(true)}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-gold/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <ICONS.Zap className="w-4 h-4 text-gold" />
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
                <span>Evidence ({evidenceLabel})</span>
              </button>
            )}

            {rlmTrajectory && (
              <button
                type="button"
                onClick={() => setShowRlmModal(true)}
                className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-gold/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                <ICONS.Terminal className="w-4 h-4 text-gold" />
                <span>RLM Trace ({rlmTrajectory.iterations.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (entitlementsFor(getCurrentQuotaSync()?.plan).whiteLabelPdf) setShowWhiteLabelModal(true);
                else setWhiteLabelAsk(true);
              }}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-info-500/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <ICONS.Download className="w-4 h-4 text-info-400" />
              <span>Agency PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadDossier}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 hover:border-blue-500/50 text-xs font-mono text-gray-200 hover:text-white flex items-center gap-1.5 transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <ICONS.FileText className="w-4 h-4 text-blue-400" />
              <span>Dossier HTML</span>
            </button>
          </div>
          {shareMessage && (
            <p className="text-[10px] font-mono text-gold-light mt-2 break-all" role="status">
              {shareMessage}
              {getCurrentQuotaSync()?.plan ? ` · plan ${getCurrentQuotaSync()?.plan}` : ''}
            </p>
          )}
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
            Preview evidence ({evidenceLabel})
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
        {hideLiveNumbers ? null : <ShareOfVoiceCard summary={shareOfVoice} />}
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

      {/* Embedded ROI Projector */}
      <ROICalculator />

      {validSources && validSources.length > 0 && (
        <div className="mt-8 pt-6 border-t border-white/10">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gold-light mb-4 flex items-center gap-2">
            <ICONS.Info className="w-4 h-4 text-gold" /> Search Grounding Sources
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
        measured={!hideLiveNumbers}
        findings={boardFindings}
      />

      {showRlmModal && rlmTrajectory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="RLM Execution Trajectory"
          onClick={() => setShowRlmModal(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 print:hidden"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-6xl h-[82vh]"
          >
            <RlmTrajectoryViewer
              trajectory={rlmTrajectory}
              onClose={() => setShowRlmModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
