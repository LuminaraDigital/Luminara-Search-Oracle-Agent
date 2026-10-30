import React, { useEffect, useMemo, useState } from 'react';
import { ICONS } from '../../constants';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { patchFindingStatus } from '../../services/audit/findingBoardService';
import { sampleAiSaidFixtures } from '../../services/audit/sampleAiSaidFixtures';
import type { ShipCommitment } from '../../services/audit/shipCommitmentService';
import { upsertWeeklyDecision } from '../../services/privacy/privacyClient';
import { honestyChipLabel, normalizeMeasurementStatus } from '../../services/wdl/liveHonesty';
import {
  LLMS_NAME_NOTE,
  comparisonOutlineDraft,
  llmsTxtDraft,
  offSiteMentionPackDraft,
  organizationJsonLd,
} from '../../services/audit/fixPackCopy';
import { brandNameFor } from '../../services/audit/brandName';
import { firstVerifiedRivalFromReport } from './CompetitorMap';
import { scoutAuthoritySources } from '../../services/visibility/authorityScoutService';

import type { EmpiricalEvidence } from '../../services/audit/empiricalCitationService';
import type { RadarCitationRow } from './VisibilityRadar';
import type { MindshareHistoryPoint } from '../../services/visibility/mindshareService';
import { probeLlmCrawlerReadiness } from '../../services/audit/llmCrawlerProbe';
import { MindshareRadarCard } from '../visibility/MindshareRadarCard';
import { formatAuDate } from '../../utils/formatAuDate';
import { PerceptionMatrix } from '../visibility/PerceptionMatrix';
import { classifyRemediationTier } from '../../services/deployment/remediationTierRouter';

interface WeeklyDecisionCardProps {
  domain: string;
  primary: BoardFinding | null;
  findings: BoardFinding[];
  commitment: ShipCommitment | null;
  onFindingUpdated?: (f: BoardFinding) => void;
  evidence?: EmpiricalEvidence[];
  rawSources?: Array<{ uri: string; title: string }>;
  radarRows?: readonly RadarCitationRow[];
  mindshareHistory?: readonly MindshareHistoryPoint[];
  /** Report markdown. Who-gets-named follows the rival rows this report's map draws. */
  reportMarkdown?: string;
  onSelectAction?: (actionId: string, label: string) => void;
}

const EMPTY_EVIDENCE: EmpiricalEvidence[] = [];

/**
 * One weekly decision: action, Why (Sample AI-said or finding), verify hint.
 * When signed in, commits also persist to D1 via /api/weekly-decisions.
 */
export const WeeklyDecisionCard: React.FC<WeeklyDecisionCardProps> = ({
  domain,
  primary,
  findings,
  commitment,
  onFindingUpdated,
  evidence,
  rawSources,
  radarRows,
  mindshareHistory,
  reportMarkdown,
  onSelectAction,
}) => {
  const [busy, setBusy] = useState(false);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const cleanDomain = (domain || 'domain').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  const rememberedBrand = brandNameFor(cleanDomain);
  const aiSaid = useMemo(() => sampleAiSaidFixtures(domain, rememberedBrand), [domain, rememberedBrand]);
  const llmsPreview = useMemo(() => llmsTxtDraft(domain, rememberedBrand), [domain, rememberedBrand]);
  const verifyBy = useMemo(() => {
    const base = commitment?.committedAt || Date.now();
    return formatAuDate(base + 14 * 24 * 60 * 60 * 1000);
  }, [commitment?.committedAt]);

  const mappedEvidence = evidence && evidence.length > 0 ? evidence : EMPTY_EVIDENCE;

  const authorityScout = useMemo(
    () =>
      scoutAuthoritySources({
        targetDomain: domain,
        evidence: mappedEvidence,
        rawSources,
      }),
    [domain, mappedEvidence, rawSources],
  );
  const topMissingHub = authorityScout.missingCompetitorSources[0] || authorityScout.topUntappedHub;

  useEffect(() => {
    if (!commitment || !domain) return;
    let cancelled = false;
    void (async () => {
      const statuses = aiSaid.map((r) => normalizeMeasurementStatus(r.measurementStatus));
      const hasMeasured = statuses.some((s) => s === 'measured');
      const row = await upsertWeeklyDecision({
        domain,
        title: commitment.label,
        whyText: primary?.description || '',
        findingId: primary?.id,
        commitment,
        dataFreshness: hasMeasured ? 'mixed' : 'sample',
        evidence: aiSaid.slice(0, 5),
      });
      if (!cancelled) {
        setPersistNote(row ? 'Saved to account' : 'Session only (sign in to sync)');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commitment?.actionId, commitment?.committedAt, domain, primary?.id, primary?.description, aiSaid]);

  const [exported, setExported] = useState(false);
  const [proving, setProving] = useState(false);
  const [verificationNote, setVerificationNote] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'measured' | 'unverified' | null>(null);
  const [telegramDigestOptIn, setTelegramDigestOptIn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('luminara_weekly_digest_opt_in') === '1';
    } catch {
      return false;
    }
  });

  const toggleTelegramDigest = () => {
    const next = !telegramDigestOptIn;
    setTelegramDigestOptIn(next);
    try {
      localStorage.setItem('luminara_weekly_digest_opt_in', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const triggerDownload = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportMentionPack = () => {
    if (!topMissingHub) return;
    const mentionContent = offSiteMentionPackDraft({
      host: cleanDomain,
      siteNameOrEvidence: rememberedBrand,
      channel: topMissingHub.offSiteChannel,
      targetHubDomain: topMissingHub.domain,
      rivalName:
        topMissingHub.competitorsMentioned[0] ||
        firstVerifiedRivalFromReport(reportMarkdown || ''),
    });
    triggerDownload(
      `mention-pack-${cleanDomain}-${topMissingHub.domain}.md`,
      mentionContent,
      'text/markdown;charset=utf-8',
    );
  };

  const handleExportFixPack = () => {
    const llmsContent = llmsTxtDraft(cleanDomain, rememberedBrand);
    const schemaContent = organizationJsonLd(cleanDomain, rememberedBrand);
    const compareContent = comparisonOutlineDraft(
      cleanDomain,
      rememberedBrand,
      firstVerifiedRivalFromReport(reportMarkdown || ''),
    );

    triggerDownload(`llms-${cleanDomain}.txt`, llmsContent, 'text/plain;charset=utf-8');
    setTimeout(() => {
      triggerDownload(`schema-${cleanDomain}.jsonld`, schemaContent, 'application/ld+json;charset=utf-8');
    }, 150);
    setTimeout(() => {
      triggerDownload(`compare-${cleanDomain}.md`, compareContent, 'text/markdown;charset=utf-8');
    }, 300);
    if (topMissingHub) {
      setTimeout(() => {
        handleExportMentionPack();
      }, 450);
    }

    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  const handleRecheckAndProve = async () => {
    if (!domain || proving) return;
    setProving(true);
    setVerificationNote(null);
    try {
      const report = await probeLlmCrawlerReadiness(`https://${cleanDomain}`);
      // Only a served llms.txt proves the fix pack is live. A robots.txt that blocks nothing
      // (or no robots.txt at all) also passes, so it cannot mark the fix done.
      const llmsPass = report.checks.some((c) => c.id === 'llms_txt' && c.status === 'pass');

      if (llmsPass) {
        setVerificationStatus('measured');
        setVerificationNote(`Verified live on ${cleanDomain}: measured crawler evidence detected.`);
        if (primary) {
          const updated = await patchFindingStatus(domain, primary.id, 'done');
          if (updated) onFindingUpdated?.(updated);
        }
      } else {
        setVerificationStatus('unverified');
        setVerificationNote(`Not detected yet on https://${cleanDomain}/llms.txt. Deploy the exported fix pack to your public root and re-check.`);
      }
    } catch {
      setVerificationStatus('unverified');
      setVerificationNote('Network check failed. Verify domain connectivity and try again.');
    } finally {
      setProving(false);
    }
  };

  const markInProgress = async () => {
    if (!primary || busy) return;
    setBusy(true);
    try {
      const updated = await patchFindingStatus(domain, primary.id, 'in_progress');
      if (updated) onFindingUpdated?.(updated);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mb-8 rounded-2xl border border-gold/40 bg-black/70 p-6 sm:p-8 shadow-2xl"
      aria-label="Weekly decision"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
        <span className="text-[10px] font-black uppercase tracking-[0.35em] text-gold-light">
          This week
        </span>
        {persistNote && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500 ml-auto">
            {persistNote}
          </span>
        )}
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">
        {commitment?.label || primary?.title || 'Pick one ship move'}
      </h2>
      <p className="text-sm text-gray-400 max-w-2xl leading-relaxed mb-6">
        {primary
          ? primary.description
          : 'Commit to one fix from Instant Audit. Sample AI-said rows below explain the Why until Live probes are connected.'}
      </p>

      {primary && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-gold-light">
              {primary.severity}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {primary.category}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {primary.status}
            </span>
            {!primary.synced && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400/90">
                Local until signed in
              </span>
            )}
          </div>
          <p className="text-gray-300 text-xs leading-relaxed">{primary.title}</p>
          <div id="tour-mark-done" className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              disabled={busy || primary.status === 'in_progress' || primary.status === 'done'}
              onClick={markInProgress}
              className="px-3 py-1.5 rounded-lg border border-gold/40 text-[11px] font-bold uppercase tracking-wider text-gold-light disabled:opacity-40"
            >
              Mark in progress
            </button>
            {llmsPreview.includes('<Your agency name>') && (
              <div className="w-full basis-full">
                <p className="mb-2 text-sm text-gray-300">{LLMS_NAME_NOTE}</p>
                <pre className="max-h-40 overflow-auto rounded-lg border border-white/10 bg-black p-3 text-xs leading-relaxed text-gray-200">{llmsPreview}</pre>
              </div>
            )}
            <button
              type="button"
              onClick={handleExportFixPack}
              className="px-3 py-1.5 rounded-lg bg-gold/20 hover:bg-gold/30 border border-gold/60 text-[11px] font-bold uppercase tracking-wider text-gold-light inline-flex items-center gap-1.5 transition-colors"
              title="Download machine-readable llms.txt and JSON-LD schema fix pack"
            >
              {exported ? (
                <>
                  <ICONS.Check className="w-3.5 h-3.5 text-green-400" />
                  Fix Pack Exported
                </>
              ) : (
                <>
                  <ICONS.FileText className="w-3.5 h-3.5" />
                  Export Fix Pack
                </>
              )}
            </button>
            <button
              type="button"
              disabled={busy || proving}
              onClick={handleRecheckAndProve}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-[11px] font-bold uppercase tracking-wider text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-40"
              title="Probe live domain to verify fix deployment"
            >
              {proving ? (
                <>
                  <ICONS.Radar className="w-3.5 h-3.5 animate-spin text-gold-light" />
                  Checking...
                </>
              ) : (
                <>
                  <ICONS.Check className="w-3.5 h-3.5 text-gold-light" />
                  Re-check &amp; Prove
                </>
              )}
            </button>
          </div>
          {verificationNote && (
            <p
              className={`mt-2 text-xs font-mono ${
                verificationStatus === 'measured' ? 'text-green-400' : 'text-amber-400/90'
              }`}
            >
              {verificationNote}
            </p>
          )}
          {verificationStatus === 'unverified' && (() => {
            const unverifiedDecision = classifyRemediationTier({
              domain,
              summary: primary.title,
              findingCategory: 'llms_txt',
              cmsPlatform: 'unknown',
              previousDeployBlocked: true,
            });
            return (
              <div className="mt-3 rounded-lg border border-gold/25 bg-black/60 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-gray-300">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-gold-light block">
                    {unverifiedDecision.badgeLabel}
                  </span>
                  Need full-stack root file routing, SSR schema injection, or custom CRM automation?
                </div>
                <a
                  href={
                    unverifiedDecision.engineeringBrief?.partnerUrl ||
                    `https://luminara.digital/?utm_source=luminarasuite&utm_medium=weekly_decision&domain=${encodeURIComponent(domain)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-gold text-black font-bold text-[10px] uppercase tracking-wider hover:bg-gold-light transition-colors"
                >
                  Delegate to Luminara Digital &rarr;
                </a>
              </div>
            );
          })()}
        </div>
      )}

      <MindshareRadarCard
        domain={domain}
        evidence={mappedEvidence}
        rawSources={rawSources}
        radarRows={radarRows}
        history={mindshareHistory}
        reportMarkdown={reportMarkdown}
        authorityScoutSummary={authorityScout}
        onSelectAction={onSelectAction}
      />

      {topMissingHub && (
        <div className="mb-6 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[240px]">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 font-bold">
                Missing Brand Mention Source
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300">
                {topMissingHub.offSiteChannel.replace(/_/g, ' ')}
              </span>
              {topMissingHub.competitorsMentioned.length > 0 && (
                <span className="text-[10px] font-mono text-amber-300/90">
                  Names: {topMissingHub.competitorsMentioned.join(', ')}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              <strong className="text-white font-mono">{topMissingHub.domain}</strong>: {topMissingHub.actionRecommendation}
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportMentionPack}
            className="px-3 py-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/10 hover:bg-cyan-400/20 text-[11px] font-mono text-cyan-200 uppercase tracking-wider transition-colors shrink-0 inline-flex items-center gap-1.5"
          >
            <ICONS.FileText className="w-3.5 h-3.5" />
            Prepare Mention Pack
          </button>
        </div>
      )}

      {mappedEvidence.some((e) => Boolean((e as { engine?: string }).engine)) && (
        <PerceptionMatrix
          domain={domain}
          evidence={mappedEvidence}
          onTakeAction={onSelectAction}
        />
      )}

      <div className="mb-4">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-gray-500 mb-3">
          Why (Sample AI said)
        </h3>
        <ul className="space-y-3">
          {aiSaid.map((row) => {
            const status = normalizeMeasurementStatus(row.measurementStatus);
            return (
              <li
                key={row.id}
                className="rounded-xl border border-white/10 px-4 py-3 text-xs text-gray-300 leading-relaxed"
              >
                <div className="flex flex-wrap gap-2 mb-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300/90">
                    {row.label}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
                    {row.engine}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
                    {honestyChipLabel(status)}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
                    {row.presence}
                  </span>
                </div>
                <p className="text-gray-400 mb-1">
                  <span className="text-gray-500">Prompt:</span> {row.prompt}
                </p>
                <p className="text-gray-300 mb-1">{row.excerpt}</p>
                <p className="text-[11px] text-gray-500">{row.note}</p>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10 text-[11px] text-gray-500 font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <ICONS.Radar className="w-3.5 h-3.5 text-gold/80" />
            Verify by {verifyBy}
          </span>
          <span>
            {findings.length} finding{findings.length === 1 ? '' : 's'} on board
          </span>
        </div>
        <button
          type="button"
          onClick={toggleTelegramDigest}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
            telegramDigestOptIn
              ? 'border-gold/50 bg-gold/10 text-gold-light'
              : 'border-white/10 text-gray-400 hover:text-white'
          }`}
          title="Toggle weekly decision summary notifications"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${telegramDigestOptIn ? 'bg-gold' : 'bg-gray-600'}`} />
          Weekly Telegram Briefing: {telegramDigestOptIn ? 'Enabled. Press to turn it off.' : 'Disabled. Press this to turn it on in this browser.'}
        </button>
      </div>
    </section>
  );
};
