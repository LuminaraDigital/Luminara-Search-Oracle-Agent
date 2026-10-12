import React, { useEffect, useMemo, useState } from 'react';
import { ICONS } from '../../constants';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { patchFindingStatus } from '../../services/audit/findingBoardService';
import { sampleAiSaidFixtures } from '../../services/audit/sampleAiSaidFixtures';
import type { ShipCommitment } from '../../services/audit/shipCommitmentService';
import { upsertWeeklyDecision } from '../../services/privacy/privacyClient';
import { honestyChipLabel, normalizeMeasurementStatus } from '../../services/wdl/liveHonesty';

import type { EmpiricalEvidence } from '../../services/audit/empiricalCitationService';
import { probeLlmCrawlerReadiness } from '../../services/audit/llmCrawlerProbe';
import { MindshareRadarCard } from '../visibility/MindshareRadarCard';
import { PerceptionMatrix } from '../visibility/PerceptionMatrix';

interface WeeklyDecisionCardProps {
  domain: string;
  primary: BoardFinding | null;
  findings: BoardFinding[];
  commitment: ShipCommitment | null;
  onFindingUpdated?: (f: BoardFinding) => void;
  evidence?: EmpiricalEvidence[];
  rawSources?: Array<{ uri: string; title: string }>;
  onSelectAction?: (actionId: string, label: string) => void;
}

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
  onSelectAction,
}) => {
  const [busy, setBusy] = useState(false);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const aiSaid = useMemo(() => sampleAiSaidFixtures(domain), [domain]);
  const verifyBy = useMemo(() => {
    const base = commitment?.committedAt || Date.now();
    return new Date(base + 14 * 24 * 60 * 60 * 1000).toLocaleDateString();
  }, [commitment?.committedAt]);

  const mappedEvidence: EmpiricalEvidence[] = useMemo(() => {
    if (evidence && evidence.length > 0) return evidence;
    return [];
  }, [evidence]);

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

  const handleExportFixPack = () => {
    const raw = domain || 'domain';
    const cleanDomain = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();

    const llmsContent = `# ${cleanDomain} - Answer Engine Optimization Context\n\n> Machine-readable context and verified answer targets for ${cleanDomain}.\n\n## What is ${cleanDomain}?\n${cleanDomain} is an authority in its industry, providing verified services and direct solutions. For authoritative documentation and current offerings, refer to https://${cleanDomain}.\n\n## Key Information\n- Canonical URL: https://${cleanDomain}\n- Knowledge Graph: https://${cleanDomain}/#organization\n- Documentation: https://${cleanDomain}/llms.txt\n`;

    const schemaContent = JSON.stringify(
      {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': `https://${cleanDomain}/#organization`,
            name: cleanDomain,
            url: `https://${cleanDomain}`,
            description: `Authoritative entity profile and verified knowledge graph for ${cleanDomain}.`,
          },
          {
            '@type': 'WebSite',
            '@id': `https://${cleanDomain}/#website`,
            url: `https://${cleanDomain}`,
            name: cleanDomain,
            publisher: {
              '@id': `https://${cleanDomain}/#organization`,
            },
          },
        ],
      },
      null,
      2
    );

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

    triggerDownload(`llms-${cleanDomain}.txt`, llmsContent, 'text/plain;charset=utf-8');
    setTimeout(() => {
      triggerDownload(`schema-${cleanDomain}.jsonld`, schemaContent, 'application/ld+json;charset=utf-8');
    }, 150);

    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  const handleRecheckAndProve = async () => {
    if (!domain || proving) return;
    setProving(true);
    setVerificationNote(null);
    try {
      const clean = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      const report = await probeLlmCrawlerReadiness(`https://${clean}`);
      const llmsPass = report.checks.some((c) => c.id === 'llms_txt' && c.status === 'pass');
      const anyDirective = report.checks.some((c) => (c.id === 'ai_bot_directives' || c.id === 'llms_structure') && c.status === 'pass');

      if (llmsPass || anyDirective) {
        setVerificationStatus('measured');
        setVerificationNote(`Verified live on ${clean}: measured crawler evidence detected.`);
        if (primary) {
          const updated = await patchFindingStatus(domain, primary.id, 'done');
          if (updated) onFindingUpdated?.(updated);
        }
      } else {
        setVerificationStatus('unverified');
        setVerificationNote(`Not detected yet on https://${clean}/llms.txt. Deploy the exported fix pack to your public root and re-check.`);
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
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              disabled={busy || primary.status === 'in_progress' || primary.status === 'done'}
              onClick={markInProgress}
              className="px-3 py-1.5 rounded-lg border border-gold/40 text-[11px] font-bold uppercase tracking-wider text-gold-light disabled:opacity-40"
            >
              Mark in progress
            </button>
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
        </div>
      )}

      <MindshareRadarCard
        domain={domain}
        evidence={mappedEvidence}
        rawSources={rawSources}
        onSelectAction={onSelectAction}
      />

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
          Weekly Telegram Briefing: {telegramDigestOptIn ? 'Enabled' : 'Disabled'}
        </button>
      </div>
    </section>
  );
};
