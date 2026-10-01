import React, { useState, useRef, useEffect } from 'react';
import { ReportFocus, BusinessDNA } from '../../types';
import { geminiService } from '../../services/geminiService';
import { AUDIT_LENSES, inferLenses, type AuditLens } from '../../services/skills/seoPlaybooks';
import { contextGraphService } from '../../services/contextGraph/contextGraphService';
import { freeLlmModalitiesService } from '../../services/freellm/modalitiesService';
import { ICONS } from '../../constants';
import { ReportDisplay } from './ReportDisplay';
import { WeeklyDecisionCard } from './WeeklyDecisionCard';
import { PageSpeedPanel } from './PageSpeedPanel';
import { GscPanel } from './GscPanel';
import { pickPrimaryFinding, readLastBoardDomain } from '../../services/audit/findingBoardService';
import { useConfirm } from '../ui/ConfirmModal';
import { AgentMissionControl } from './AgentMissionControl';
import { ProofOfAuditBadgeModal } from './ProofOfAuditBadgeModal';
import { PROOF_BADGE_ENABLED } from '../../services/agentCore/tonAttestationService';
import { crewOrchestrator } from '../../services/agentCore/crewOrchestrator';
import { AgentActivityEvent, AuditAttestation, AuditStateGraphContext } from '../../services/agentCore/types';
import { toUserFacingText } from '../../utils/userFacingText';
import { draftPersistenceService, DRAFT_KEYS } from '../../services/state/draftPersistenceService';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import { AuditReportSkeleton } from '../ui/Skeleton';
import { apiBase, getCurrentQuotaSync, hasActivePaidPlanSync, workerFetchWithAuthRetry } from '../../services/apiClient';
import { entitlementsFor } from '../../services/plans/planEntitlements';
import { buildCursorMcpServersJson, mcpHttpUrlFromApiBase } from '../../services/mcp/cursorMcpSnippet';
import { Button } from '../ui/Button';
import { GuestScoutSummaryPanel } from './GuestScoutSummaryPanel';
import { SuiteCitabilityChecklist } from './SuiteCitabilityChecklist';
import { buildGuestScoutSummary, isDegradedScout, shouldGenerateAuditReport, type GuestScoutSummary } from '../../services/audit/guestScoutSummary';
import { validateAuditTargetUrl } from '../../services/audit/auditTargetUrl';
import { hostedScoutPreRunCopy, type HostedScoutRail } from '../../services/audit/hostedScoutRail';
import { canMintTeaserShare, createShareTeaser } from '../../services/share/shareReportClient';
import { shareExternalLink } from '../../services/telegram/tma';
import { TELEGRAM_MINI_APP_URL } from '../paywall/paymentOptions';
import { qualifyHonestScout } from '../../services/referrals/referralClient';
import { clearScoutReceipt, takeScoutReceipt } from '../../services/referrals/scoutReceiptCapture';
import { linkIdeaScout } from '../../services/ideaScout/ideaScoutClient';
import { takeContinuumLink } from '../../services/ideaScout/continuum';

export function instantAuditPrimaryLabel(crewRunning: boolean, isFullAudit: boolean): string {
  if (crewRunning) return 'Scanning...';
  return isFullAudit ? 'Run full audit' : 'Run quick scout';
}

export async function generateAuditReportUnlessDegraded(input: {
  isGuest: boolean;
  summary: GuestScoutSummary;
  measurementStatus: 'measured' | 'not_measured';
  formattedUrl: string;
  targetFocus: ReportFocus;
  dna: BusinessDNA | null;
  lenses: AuditLens[];
}): Promise<Awaited<ReturnType<typeof geminiService.generateAuditReport>> | null> {
  if (!shouldGenerateAuditReport(input.isGuest, input.summary, input.measurementStatus)) {
    return null;
  }
  return geminiService.generateAuditReport(input.formattedUrl, input.targetFocus, input.dna, input.lenses);
}

function summaryFromCrew(crew: AuditStateGraphContext, hostedRail: HostedScoutRail): GuestScoutSummary {
  return buildGuestScoutSummary({
    targetUrl: crew.targetUrl,
    measurementStatus: crew.measurementStatus,
    measurementReason: crew.measurementReason,
    citationRatePercent: crew.citationRatePercent,
    shareOfVoiceScore: crew.shareOfVoiceScore,
    healthScore: crew.healthScore,
    scrapedPageCount: crew.scrapedPages.length,
    serpCount: crew.serpEvidence.length,
    findings: crew.findings.map((finding) => ({ title: finding.title })),
    errors: crew.errors,
    plainEnglishBrief: crew.plainEnglishBrief,
    llmCrawler: crew.llmCrawlerReadiness,
    hostedRail,
  });
}

interface InstantAuditViewProps {
  dna: BusinessDNA | null;
  onNavigateDNA?: () => void;
  initialUrl?: string;
  initialFocus?: ReportFocus;
  /** Guest / unsigned scout: web guests stay on BYOK. Telegram initData may use capped hosted spend. */
  isGuest?: boolean;
  /** Came from labeled Sample Probe / landing scout. */
  sampleSource?: boolean;
  onSeePricing?: () => void;
  hostedRail?: HostedScoutRail;
  /** Idea Scout card to attach when this scout finishes. Cleared after one successful link. */
  ideaScoutId?: string;
  onContinuumSettled?: (ok: boolean) => void;
}

function canMintMcpKeys(): boolean {
  const quota = getCurrentQuotaSync();
  if (!quota) return false;
  const plan = quota.plan || 'free';
  if (plan !== 'free' && plan !== 'active') {
    return entitlementsFor(plan).mcpAccess;
  }
  if (hasActivePaidPlanSync()) {
    return entitlementsFor('growth').mcpAccess;
  }
  return false;
}

export const InstantAuditView: React.FC<InstantAuditViewProps> = ({
  dna,
  onNavigateDNA,
  initialUrl,
  initialFocus,
  isGuest = false,
  sampleSource = false,
  onSeePricing,
  hostedRail = 'byok_or_signin',
  ideaScoutId,
  onContinuumSettled,
}) => {
  const [url, setUrl] = useState(
    () => initialUrl || draftPersistenceService.getDraft(DRAFT_KEYS.AUDIT_URL) || readLastBoardDomain(),
  );
  const [focus, setFocus] = useState<ReportFocus>(() => initialFocus || 'AEO');
  const [lenses, setLenses] = useState<AuditLens[]>(() => inferLenses(dna));
  const toggleLens = (id: AuditLens) => setLenses(prev => (prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]));

  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setUrl(initialUrl);
      draftPersistenceService.setDraft(DRAFT_KEYS.AUDIT_URL, initialUrl);
    }
  }, [initialUrl]);

  useEffect(() => {
    if (initialFocus) {
      setFocus(initialFocus);
    }
  }, [initialFocus]);
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [report, setReport] = useState<Awaited<ReturnType<typeof geminiService.generateAuditReport>> | null>(null);
  const [boardFindings, setBoardFindings] = useState<
    import('../../services/audit/findingBoardService').BoardFinding[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [inlineValidationError, setInlineValidationError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [crewEvents, setCrewEvents] = useState<AgentActivityEvent[]>([]);
  const [crewMeasurement, setCrewMeasurement] = useState<'measured' | 'not_measured' | null>(null);
  const [scoutSummary, setScoutSummary] = useState<GuestScoutSummary | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [attestation, setAttestation] = useState<AuditAttestation | null>(null);
  const [showAttestationModal, setShowAttestationModal] = useState(false);
  const [persistHint, setPersistHint] = useState<string | null>(null);
  const [strategySaved, setStrategySaved] = useState(false);
  const [mcpMinting, setMcpMinting] = useState(false);
  const [mcpKey, setMcpKey] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpCopied, setMcpCopied] = useState<'key' | 'snippet' | null>(null);
  const isFullAudit = Boolean(dna);

  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runSeq = useRef(0);
  const continuumRef = useRef<string | undefined>(ideaScoutId);
  useEffect(() => { continuumRef.current = ideaScoutId; }, [ideaScoutId]);
  useEffect(() => () => { if (stageTimerRef.current) clearInterval(stageTimerRef.current); }, []);

  // Hydrate Decision Card from session board when revisiting a domain (always swap domain).
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setBoardFindings([]);
      return;
    }
    let cancelled = false;
    void import('../../services/audit/findingBoardService').then(({ listLocalFindings }) => {
      if (cancelled) return;
      setBoardFindings(listLocalFindings(trimmed));
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    draftPersistenceService.setDraft(DRAFT_KEYS.AUDIT_URL, value);
    if (inlineValidationError) setInlineValidationError(null);
  };

  const handleExecuteAudit = async (targetUrl: string, targetFocus: ReportFocus) => {
    if (loading) return;
    const validationErr = validateAuditTargetUrl(targetUrl);
    if (validationErr) {
      setInlineValidationError(validationErr);
      productTelemetry.recordError('InstantAuditView', validationErr);
      return;
    }

    const seq = ++runSeq.current;
    setInlineValidationError(null);
    setError(null);
    setPersistHint(null);
    clearScoutReceipt();
    const taken = takeContinuumLink(continuumRef.current);
    continuumRef.current = taken.next;
    const linkId = taken.linkId;
    let linkedOk = false;
    const restoreContinuum = () => {
      if (linkId && !linkedOk && continuumRef.current == null) continuumRef.current = linkId;
    };
    setLoading(true);
    setCrewEvents([]);
    setCrewMeasurement(null);
    setScoutSummary(null);
    setShareNote(null);
    setAttestation(null);
    setProgressStage('Starting audit…');
    productTelemetry.recordOnboardingStep('quick_scout');

    try {
      const formattedUrl = targetUrl.includes('://') ? targetUrl : `https://${targetUrl}`;

      // 1. Run the Autonomous Multi-Agent Search Crew with real-time streaming
      const crewResult = await crewOrchestrator.runAuditCrew(
        formattedUrl,
        targetFocus,
        dna,
        (ev) => {
          setCrewEvents((prev) => [...prev, ev]);
          setProgressStage(ev.message);
        }
      );
      if (seq !== runSeq.current) return;

      const summary = summaryFromCrew(crewResult, hostedRail);
      const degraded = isDegradedScout({
        measurementStatus: crewResult.measurementStatus,
        evidenceEmpty: summary.evidenceEmpty,
        failureCodes: summary.failureCodes,
      });
      // Crew is terminal. Re-enable Retry / New domain before any report enrichment.
      setLoading(false);
      setProgressStage('');
      setCrewMeasurement(crewResult.measurementStatus);
      setScoutSummary(summary);
      if (linkId && summary.domain) {
        const measured = !isGuest && crewResult.measurementStatus === 'measured' && !summary.evidenceEmpty;
        try {
          const linked = await linkIdeaScout({
            id: linkId,
            domain: summary.domain,
            measurementStatus: measured ? 'measured' : 'not_measured',
            evidencePresent: measured,
          });
          if (linked.ok) {
            linkedOk = true;
            onContinuumSettled?.(true);
          } else {
            restoreContinuum();
            onContinuumSettled?.(false);
          }
        } catch {
          restoreContinuum();
          onContinuumSettled?.(false);
        }
      } else if (linkId) {
        restoreContinuum();
      }
      if (seq !== runSeq.current) return;

      let inviteNote = '';
      if (!isGuest && !summary.evidenceEmpty && (crewResult.measurementStatus === 'measured' || crewResult.measurementStatus === 'not_measured')) {
        const qualified = await qualifyHonestScout({
          domain: summary.domain,
          measurementStatus: crewResult.measurementStatus,
          completed: true,
          evidencePresent: true,
          receipt: takeScoutReceipt(),
        });
        if (qualified.rewardsGranted) {
          inviteNote = 'Invite credit unlocked for you and the person who invited you. Extra hosted scouts were added. No citation score was invented.';
        }
      }
      if (seq !== runSeq.current) return;
      const withInvite = (message: string) => (inviteNote ? `${message} ${inviteNote}` : message);
      if (crewResult.attestation && !degraded) {
        setAttestation(crewResult.attestation);
      }

      // A run that did not measure the site must not feed the findings board or the Weekly Decision card.
      if (degraded) {
        setBoardFindings([]);
      } else {
        try {
          const { ingestCrewFindings } = await import('../../services/audit/findingBoardService');
          const boarded = await ingestCrewFindings({
            domain: formattedUrl,
            findings: crewResult.findings || [],
            auditRunId: `crew_${Date.now().toString(36)}`,
          });
          setBoardFindings(boarded);
        } catch {
          setBoardFindings([]);
        }
      }

      if (seq !== runSeq.current) return;

      // 2. Generate full enriched report.
      // Guest degraded runs stay on the honest summary. The full report model
      // can still invent citation language when providers returned nothing.
      const result = await generateAuditReportUnlessDegraded({
        isGuest,
        summary,
        measurementStatus: crewResult.measurementStatus,
        formattedUrl,
        targetFocus,
        dna,
        lenses,
      });
      if (seq !== runSeq.current) return;
      if (!result) {
        setStrategySaved(false);
        setPersistHint(withInvite(
          'Scout finished. Use the summary above. This run did not measure the site, so no full report was generated. Sign in to save a project. Full branded share links stay on Growth and Agency.',
        ));
        return;
      }
      if (crewResult.plainEnglishBrief && !result.plainEnglishBrief) {
        result.plainEnglishBrief = crewResult.plainEnglishBrief;
      }
      setReport(result);
      draftPersistenceService.clearDraft(DRAFT_KEYS.AUDIT_URL);
      productTelemetry.recordFirstValue('audit');
      productTelemetry.track('instant_audit_completed', {
        focus: targetFocus,
        guest: Boolean(isGuest),
      });

      try {
        const { saveAuditStrategyToProject } = await import('../../services/projects/projectClient');
        const saved = await saveAuditStrategyToProject({
          domain: formattedUrl,
          dna,
          plainEnglishBrief: result.plainEnglishBrief || result.text?.slice(0, 2000),
          focus: targetFocus,
        });
        if (saved) {
          productTelemetry.recordOnboardingStep('strategy_saved');
          productTelemetry.track('strategy_saved', { projectIdPrefix: saved.projectId.slice(0, 8) });
          setStrategySaved(true);
          setPersistHint(withInvite(`Strategy saved to project ${saved.projectId.slice(0, 12)}…`));
        } else if (isGuest) {
          setStrategySaved(false);
          setPersistHint(withInvite(
            'Scout finished. Use the summary above. Sign in to save a project. Full branded share links stay on Growth and Agency.',
          ));
        } else {
          setStrategySaved(false);
          setPersistHint(withInvite(
            'Audit complete. Sign in to save strategy to a project, create share links, or connect MCP.',
          ));
        }
      } catch {
        setStrategySaved(false);
        setPersistHint(withInvite(
          isGuest
            ? 'Scout finished. Use the summary above. Sign in to save a project. Full branded share links stay on Growth and Agency.'
            : 'Audit complete. Sign in to save strategy to a project, create share links, or connect MCP.',
        ));
      }

      try {
        const payload = {
          url: formattedUrl,
          focus: targetFocus,
          text: result.text,
          sources: result.sources,
          dnaName: dna?.name
        };
        contextGraphService.saveLastAudit(payload);
        contextGraphService.ingestAudit(payload);
      } catch {
        /* graph ingest is best-effort */
      }
    } catch (err: any) {
      restoreContinuum();
      const userErr = toUserFacingText(err, 'Failed to complete the audit. Check your AI keys in Settings and try again.');
      setError(userErr);
      productTelemetry.recordError('InstantAuditView', userErr);
    } finally {
      if (seq === runSeq.current) {
        setLoading(false);
        setProgressStage('');
      }
    }
  };

  const { requestConfirm, confirmModal } = useConfirm();

  const shareTeaser = async (mode: 'share' | 'copy') => {
    if (!scoutSummary || sharing) return;
    setSharing(true);
    setShareNote(null);
    try {
      let url = `${TELEGRAM_MINI_APP_URL}?startapp=${encodeURIComponent(`audit_${scoutSummary.domain}`)}`;
      if (canMintTeaserShare()) {
        const minted = await createShareTeaser({
          domain: scoutSummary.domain,
          verdict: scoutSummary.verdict,
          topFix: scoutSummary.topFix,
          evidenceNote: scoutSummary.evidenceUsed,
          badges: scoutSummary.badges.map((badge) => ({
            label: badge.label,
            status: 'not_measured' as const,
          })),
          crawlerChecks: scoutSummary.crawlerChecks.map((check) => ({
            id: check.id,
            label: check.label,
            status: 'not_measured' as const,
            detail: check.detail,
          })),
          failed: scoutSummary.failureCodes,
        });
        if (minted.ok && minted.url) url = minted.url;
        else if (mode === 'share') {
          setShareNote(minted.error || 'Public teaser needs a Telegram or signed-in session. Sharing the Mini App link instead.');
        }
      } else if (mode === 'share') {
        setShareNote('Public teaser links need Telegram or a signed-in session. Sharing the Mini App link instead.');
      }
      const text = `${scoutSummary.verdict} Next: ${scoutSummary.topFix}`;
      if (mode === 'copy') {
        try {
          await navigator.clipboard.writeText(`${text}\n${url}`);
          setShareNote('Copied. The link is a redacted teaser or the Mini App, with no account secrets.');
        } catch {
          setShareNote(url);
        }
        return;
      }
      const shared = await shareExternalLink(url, text);
      if (shared === 'copied') setShareNote('Copied. Open Telegram to paste it, or use Share teaser inside the Mini App.');
      else if (shared === 'failed') setShareNote(url);
    } finally {
      setSharing(false);
    }
  };

  const handleReset = () => {
    const reset = () => {
      setReport(null);
      setError(null);
      setPersistHint(null);
      setStrategySaved(false);
      setMcpKey(null);
      setMcpError(null);
      setUrl('');
      draftPersistenceService.clearDraft(DRAFT_KEYS.AUDIT_URL);
      setCrewEvents([]);
      setBoardFindings([]);
      setCrewMeasurement(null);
      setScoutSummary(null);
      setShareNote(null);
      setAttestation(null);
    };
    // Only ask when there is a report to lose.
    if (!report) {
      reset();
      return;
    }
    requestConfirm(
      {
        title: 'Start a new audit?',
        description: 'The current report will be discarded. Export or copy anything you need first.',
        confirmLabel: 'Discard and start new',
        variant: 'danger',
      },
      reset,
    );
  };

  const mintMcpKey = async () => {
    const base = apiBase();
    if (!base || mcpMinting || mcpKey) return;
    setMcpMinting(true);
    setMcpError(null);
    try {
      const r = await workerFetchWithAuthRetry(`${base}/api/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Instant Audit MCP' }),
      });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; key?: string; error?: string };
      if (!r.ok || !data.ok || typeof data.key !== 'string') {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      setMcpKey(data.key);
      productTelemetry.track('mcp_key_created', { source: 'instant_audit' });
    } catch (e) {
      setMcpError(e instanceof Error && e.message ? e.message : 'Could not mint MCP key.');
    } finally {
      setMcpMinting(false);
    }
  };

  const copyMcp = async (kind: 'key' | 'snippet') => {
    if (!mcpKey) return;
    const text =
      kind === 'key'
        ? mcpKey
        : buildCursorMcpServersJson(mcpHttpUrlFromApiBase(apiBase()), mcpKey);
    try {
      await navigator.clipboard.writeText(text);
      setMcpCopied(kind);
      if (kind === 'snippet') {
        productTelemetry.track('mcp_snippet_copied', { source: 'instant_audit' });
      }
      window.setTimeout(() => setMcpCopied(null), 2000);
    } catch {
      setMcpError('Copy failed. Select the text and copy manually.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6 sm:py-8 animate-in fade-in duration-700 min-w-0">
      {confirmModal}
      <div className="text-center mb-6 sm:mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/10 border border-gold/30 mb-4">
          <ICONS.Radar className="w-4 h-4 text-gold-light" />
          <span className="text-[10px] font-semibold tracking-wide text-gold-light">
            {isFullAudit ? 'Full audit' : 'Quick scout'}
            {sampleSource && !report ? ' · from Sample' : ''}
            {sampleSource && report ? ' · was Sample handoff' : ''}
          </span>
        </div>
        {sampleSource && !report && (
          <p className="text-[11px] font-mono text-gold-light/90 mb-3">
            Prefill from Sample scout. Live measurement starts when you run; Sample labels stay until then.
          </p>
        )}
        <h1 className="font-display font-normal text-[length:var(--text-display-s)] text-[var(--color-ink)] tracking-tight leading-[1.08] mb-3 [overflow-wrap:anywhere]">
          Will AI mention your brand?
        </h1>
        <p className="text-sm text-gray-400 max-w-xl mx-auto leading-relaxed px-1">
          Paste your site. Get a plain verdict, evidence chips, and one move to ship this week.
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 text-xs text-gray-300 leading-relaxed">
        {hostedScoutPreRunCopy(hostedRail)}
        {isGuest && hostedRail === 'byok_or_signin' && (
          <span className="block mt-1 text-gray-400">
            Saving a project strategy and full branded share links still need sign-in. Growth and Agency include those share links.
          </span>
        )}
      </div>

      {dna ? (
        <div className="mb-6 rounded-xl px-4 py-3 border border-success-500/30 bg-black/50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-success-400 animate-pulse"></span>
            <span className="text-gray-300">Full audit locked to <strong className="text-white">{dna.name}</strong></span>
          </div>
          <span className="text-[10px] font-mono text-success-400 tracking-wide">Profile linked</span>
        </div>
      ) : (
        <div className="mb-6 rounded-xl px-4 py-3 border border-warning-500/30 bg-black/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-gold"></span>
            <span className="text-gray-300">
              No business profile yet. You can still run a <strong className="text-white">Quick scout</strong>.
              Set your profile to unlock a full, USP-aware audit.
            </span>
          </div>
          {onNavigateDNA && (
            <button type="button" onClick={onNavigateDNA} className="text-[10px] font-semibold tracking-wide text-gold-light hover:underline shrink-0">
              Set up profile →
            </button>
          )}
        </div>
      )}

      {/* Controls Card */}
      {!report && (
        <div className="rounded-2xl border border-gold/25 bg-black/55 p-4 sm:p-6 md:p-8 mb-8 shadow-xl">
          <div className="flex flex-col gap-6">
            <div>
              <label htmlFor="audit-target-url" className="block text-xs font-medium tracking-wide text-gray-400 mb-2">
                Target website domain / URL
              </label>
              <div className="flex flex-col sm:relative gap-2 sm:gap-0">
                <input
                  id="audit-target-url"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="e.g., luminaradigital.io or yourbrand.com"
                  onKeyDown={(e) => e.key === 'Enter' && handleExecuteAudit(url, focus)}
                  className={`w-full bg-black/60 border rounded-xl py-3.5 px-4 sm:pr-40 text-sm text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none transition-all shadow-inner min-h-12 ${
                    inlineValidationError ? 'border-danger-500/70 focus:border-danger-400' : 'border-white/15 focus:border-gold'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => handleExecuteAudit(url, focus)}
                  disabled={loading}
                  aria-busy={loading}
                  className="sm:absolute sm:right-2 sm:top-1/2 sm:-translate-y-1/2 w-full sm:w-auto min-h-11 px-4 py-3 sm:py-2 rounded-lg bg-gold text-black font-semibold text-[11px] tracking-wide hover:bg-gold-light active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-md shadow-gold/15 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none whitespace-nowrap"
                >
                  {loading && <div className="w-3 h-3 border-2 border-black/40 border-t-black rounded-full animate-spin" />}
                  <span>{instantAuditPrimaryLabel(loading, isFullAudit)}</span>
                </button>
              </div>
              {scoutSummary && !loading && (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => handleExecuteAudit(url, focus)}
                    className="min-h-11 px-4 py-2 rounded-lg border border-gold/40 text-[10px] font-black uppercase tracking-widest text-gold-light focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="min-h-11 px-4 py-2 rounded-lg border border-white/15 text-[10px] font-black uppercase tracking-widest text-gray-200 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    New domain
                  </button>
                </div>
              )}
              {inlineValidationError && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-danger-400 font-medium animate-in fade-in">
                  <ICONS.AlertCircle className="w-4 h-4 shrink-0 text-danger-400" />
                  <span>{inlineValidationError}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Report type:</span>
                {(['SEO', 'AEO', 'GEO'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={focus === f}
                    onClick={() => setFocus(f)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                      focus === f 
                        ? 'bg-gradient-to-br from-gold to-gold-dark text-black shadow-lg shadow-gold/20' 
                        : 'glass-morphism border border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Focus Lenses:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {AUDIT_LENSES.map(l => {
                  const on = lenses.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleLens(l.id)}
                      title={l.hint}
                      aria-pressed={on}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all border focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                        on ? 'bg-gold/20 border-gold/60 text-gold-light' : 'border-white/10 text-gray-400 hover:text-white hover:border-white/30'
                      }`}
                    >
                      {on ? '✓ ' : ''}{l.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <SuiteCitabilityChecklist />

      {scoutSummary && !loading && (
        <GuestScoutSummaryPanel
          summary={scoutSummary}
          shareNote={shareNote}
          sharing={sharing}
          onShare={() => { void shareTeaser('share'); }}
          onCopy={() => { void shareTeaser('copy'); }}
        />
      )}

      {/* Agent Mission Control: Real-time Multi-Agent Activity Stream */}
      {crewEvents.length > 0 && (
        <AgentMissionControl
          events={crewEvents}
          isComplete={!loading && crewMeasurement != null}
          measurementStatus={crewMeasurement}
          hasAttestation={PROOF_BADGE_ENABLED && Boolean(attestation)}
          onViewAttestation={() => setShowAttestationModal(true)}
        />
      )}

      {/* Audit digest modal. Hidden until Phase 4 (PROOF_BADGE_ENABLED). */}
      {PROOF_BADGE_ENABLED && showAttestationModal && attestation && (
        <ProofOfAuditBadgeModal
          attestation={attestation}
          onClose={() => setShowAttestationModal(false)}
        />
      )}

      {/* Loading Skeleton */}
      {loading && crewEvents.length === 0 && (
        <div className="space-y-4">
          <div className="glass-morphism rounded-xl px-4 py-3 border border-gold/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-gold animate-pulse" />
              <span className="text-xs text-white font-medium">
                {isFullAudit ? 'Conducting full brand audit…' : 'Quick scout in progress…'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-gold-light truncate max-w-xs">{progressStage || 'Initializing agents…'}</span>
          </div>
          <AuditReportSkeleton />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="glass-morphism rounded-xl border border-danger-500/40 p-5 mb-8 flex items-center justify-between text-xs text-danger-200">
          <div className="flex items-center gap-3">
            <ICONS.AlertCircle className="w-5 h-5 text-danger-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => handleExecuteAudit(url, focus)}
            className="px-4 py-1.5 rounded-lg bg-danger-500/20 hover:bg-danger-500/30 text-danger-200 uppercase font-bold text-[10px] tracking-wider transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {persistHint && !error && (
        <p className="text-[11px] font-mono text-gray-400 px-1">{persistHint}</p>
      )}

      {strategySaved && !error && (
        <div className="mt-3 mb-6 rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 space-y-2">
          {isGuest && (
            <p className="text-xs text-gray-300">
              Sign in to mint an MCP key for Cursor after save.
            </p>
          )}
          {!isGuest && !canMintMcpKeys() && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <p className="text-xs text-gray-300">
                Growth includes MCP for Cursor and Claude. Upgrade to mint a hosted key.
              </p>
              {onSeePricing && (
                <Button variant="secondary" size="sm" onClick={onSeePricing}>
                  See Growth pricing
                </Button>
              )}
            </div>
          )}
          {!isGuest && canMintMcpKeys() && !mcpKey && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <p className="text-xs text-gray-300">
                Connect Cursor: mint a one-time <span className="font-mono">lm_live_*</span> key and copy the mcpServers snippet.
              </p>
              <Button variant="primary" size="sm" loading={mcpMinting} onClick={() => void mintMcpKey()}>
                Mint MCP key
              </Button>
            </div>
          )}
          {mcpKey && (
            <div className="space-y-2">
              <p className="text-[11px] text-warning-200 font-mono">
                Store this now. The full key will not be shown again.
              </p>
              <pre className="text-[10px] font-mono text-gray-200 bg-black/50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {mcpKey}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => void copyMcp('key')}>
                  {mcpCopied === 'key' ? 'Copied key' : 'Copy key'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void copyMcp('snippet')}>
                  {mcpCopied === 'snippet' ? 'Copied snippet' : 'Copy Cursor snippet'}
                </Button>
              </div>
            </div>
          )}
          {mcpError && (
            <p className="text-[11px] text-danger-300" role="alert">
              {mcpError}
            </p>
          )}
        </div>
      )}

      {/* Decision Card from session board (revisit without a live report in memory). */}
      {!report && boardFindings.length > 0 && (
        <WeeklyDecisionCard
          domain={url || 'unknown'}
          primary={pickPrimaryFinding(boardFindings)}
          findings={boardFindings}
          commitment={null}
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

      {/* Audit Report Result */}
      {report && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 glass-morphism rounded-xl border border-gold/30">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 font-mono">Regenerate Focus:</span>
              {(['SEO', 'AEO', 'GEO'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={focus === f}
                  onClick={() => {
                    setFocus(f);
                    handleExecuteAudit(url, f);
                  }}
                  disabled={loading}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                    focus === f 
                      ? 'bg-gold text-black' 
                      : 'border border-white/10 text-gray-400 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!report?.text || briefing) return;
                if (!freeLlmModalitiesService.isAvailable()) {
                  setError('Configure FreeLLMAPI in Settings → LLM to enable audit voice briefings.');
                  return;
                }
                setBriefing(true);
                setError(null);
                try {
                  const summary = report.text.replace(/[#*`>_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
                  await freeLlmModalitiesService.briefAloud(
                    `Audit briefing for ${url}. Focus ${focus}. ${summary}`,
                  );
                } catch (e: any) {
                  setError(toUserFacingText(e, 'Voice briefing failed. Check FreeLLMAPI speech models.'));
                } finally {
                  setBriefing(false);
                }
              }}
              disabled={briefing || loading}
              className="px-4 py-1.5 rounded-lg glass-morphism border border-gold/30 text-xs text-gold-light hover:text-white uppercase tracking-wider font-bold transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              title="Speak a short audit briefing via FreeLLMAPI TTS"
            >
              {briefing ? 'Speaking…' : 'Brief aloud'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-1.5 rounded-lg glass-morphism border border-white/10 text-xs text-gray-300 hover:text-white uppercase tracking-wider font-bold transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              New Audit
            </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <PageSpeedPanel url={url.startsWith('http') ? url : `https://${url}`} />
            <GscPanel domain={url} />
          </div>
          <ReportDisplay
            markdownText={report.text}
            sources={report.sources}
            empiricalSummary={report.empiricalSummary}
            remediationPayload={report.remediationPayload}
            unifiedDiff={report.unifiedDiff}
            targetDomain={url}
            dnaName={dna?.name}
            enrichedEntity={report.enrichedEntity}
            writingQuality={report.writingQuality}
            trafficImpact={report.trafficImpact}
            citationIntegrity={report.citationIntegrity || report.integrity}
            trustPack={report.trustPack}
            shareOfVoice={report.shareOfVoice}
            suppressLiveMetrics={crewMeasurement === 'not_measured'}
            sourceGraph={report.sourceGraph}
            enterpriseTrust={report.enterpriseTrust}
            boardFindings={boardFindings}
          />
        </div>
      )}
    </div>
  );
};
