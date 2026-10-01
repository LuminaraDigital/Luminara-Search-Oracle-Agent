import React, { useMemo, useState } from 'react';
import { AppView, BusinessDNA } from '../../types';
import { ICONS } from '../../constants';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import { HomeCtaStrip } from './HomeCtaStrip';
import { VisibilityRetentionCard } from './VisibilityRetentionCard';
import { auditCountFromStorage, shouldShowHomeCta } from './homeCtaStripLogic';
import { WeeklyDecisionCard } from '../audit/WeeklyDecisionCard';
import {
  listLocalFindings,
  pickPrimaryFinding,
  type BoardFinding,
} from '../../services/audit/findingBoardService';
import { auditHistoryService } from '../../services/audit/auditHistoryService';

interface DashboardViewProps {
  onNavigate: (view: AppView) => void;
  dna: BusinessDNA | null;
  onClearDNA?: () => void;
  advancedUi?: boolean;
  signedIn?: boolean;
}

type Door = {
  id: AppView;
  title: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
  badge: string;
};

/**
 * Level 4 home: three primary doors only (Ask / Audit / Memory).
 * Secondary and Labs surfaces stay reachable from More tools / Omnibar when needed.
 */
export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, dna, advancedUi = false, signedIn = false }) => {
  const auditCount = useMemo(() => auditCountFromStorage(), []);
  const hasAudits = auditCount > 0;
  const hasDna = Boolean(dna);
  const telemetrySummary = productTelemetry.getSummary();
  const hasChatOrMemory = telemetrySummary.totalChatsSent > 0 || hasAudits;

  const homeSeed = useMemo(() => {
    try {
      for (const entry of auditHistoryService.list()) {
        const findings = listLocalFindings(entry.domain);
        if (findings.length) {
          return { domain: entry.domain, findings };
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);
  const [boardFindings, setBoardFindings] = useState<BoardFinding[]>(() => homeSeed?.findings || []);
  const homeDomain = homeSeed?.domain || '';
  const primaryFinding = useMemo(() => pickPrimaryFinding(boardFindings), [boardFindings]);

  const onboardingSteps = [
    {
      id: 'step_scout',
      title: '1. Run Instant Audit',
      desc: 'Paste your site URL and get a ranked list of search and AI visibility fixes.',
      done: hasAudits,
      view: AppView.INSTANT_AUDIT,
      cta: 'Run audit',
    },
    {
      id: 'step_dna',
      title: '2. Set business profile',
      desc: 'Add your mission and USP so full audits match what you sell.',
      done: hasDna,
      view: AppView.BUSINESS_DNA,
      cta: 'Set profile',
    },
    {
      id: 'step_save_project',
      title: '3. Save to a project',
      desc: 'Sign in to keep strategy and reports on the hosted project, not only in this browser.',
      done: hasChatOrMemory && hasDna,
      view: AppView.INSTANT_AUDIT,
      cta: 'Continue in audit',
    },
  ];

  const completedStepsCount = onboardingSteps.filter((s) => s.done).length;
  const onboardingComplete = completedStepsCount === onboardingSteps.length;

  const handleStepClick = (view: AppView, stepId: string) => {
    productTelemetry.track('onboarding_started', { stepId });
    onNavigate(view);
  };

  const doors: Door[] = [
    {
      id: AppView.ORACLE_AGENT,
      title: 'Ask a question',
      desc: 'Get a cited answer about your brand in search and AI answers.',
      icon: ICONS.Terminal,
      badge: 'Ask',
    },
    {
      id: AppView.INSTANT_AUDIT,
      title: 'Audit my website',
      desc: 'See whether Google and AI answers mention you, then pick one fix.',
      icon: ICONS.Radar,
      badge: 'Audit',
    },
    {
      id: AppView.BRAND_MEMORY,
      title: 'Brand Memory',
      desc: 'What changed since last scan: citations, watchlist, Sentinel.',
      icon: ICONS.Shield,
      badge: 'Memory',
    },
    {
      id: AppView.NOTEBOOK,
      title: 'Intelligence Studio',
      desc: 'Sources, audio overviews and briefing docs in one workspace.',
      icon: ICONS.Notebook,
      badge: 'Studio',
    },
  ];

  const secondary: Door[] = [
    {
      id: AppView.BUSINESS_DNA,
      title: 'My business profile',
      desc: dna
        ? `Linked to ${dna.name}. Required for a full (not scout) audit.`
        : 'Set this once so every audit reinforces what you sell and who you beat.',
      icon: ICONS.DNA,
      badge: dna ? 'Linked' : 'Set up',
    },
    {
      id: AppView.IDEA_SCOUT,
      title: 'Idea Scout',
      desc: 'No domain yet. Turn an idea into a hypothesis card, then hand off to Instant Audit.',
      icon: ICONS.Zap,
      badge: 'Idea',
    },
    {
      id: AppView.VISION,
      title: 'How Luminara works',
      desc: 'The audit method in plain English.',
      icon: ICONS.Sparkle,
      badge: 'Method',
    },
  ];

  const labsDoors: Door[] = [
    {
      id: AppView.TIMESFM_FORECAST,
      title: 'TimesFM Forecaster',
      desc: 'Predict visibility, citation rate, and traffic with Google Foundation time-series AI.',
      icon: ICONS.TimeSeries,
      badge: 'Forecast',
    },
    {
      id: AppView.ORACLE_MIND,
      title: 'OracleMind Studio',
      desc: 'Small language model reasoning lab, GRPO reinforcement, and agent benchmarks.',
      icon: ICONS.Brain,
      badge: 'Reasoning',
    },
    {
      id: AppView.HARNESS,
      title: 'Archy Developer Harness',
      desc: 'Agent runtime sandbox, VFS Studio, agent matrix, and live telemetry.',
      icon: ICONS.Terminal,
      badge: 'Harness',
    },
    {
      id: AppView.STRESS_TEST,
      title: 'Red Team Stress Test',
      desc: 'Hostile adversarial simulation to poke holes in your plan before launch.',
      icon: ICONS.Stress,
      badge: 'Red Team',
    },
    {
      id: AppView.DATA_ANALYST,
      title: 'Deep Data Analyst',
      desc: 'Interactive dataset analyzer with automated anomaly and trend discovery.',
      icon: ICONS.Analyst,
      badge: 'Analyst',
    },
    {
      id: AppView.ORGANIZER,
      title: 'Strategic Organizer',
      desc: 'Transform messy thoughts and notes into a structured execution roadmap.',
      icon: ICONS.Organizer,
      badge: 'Plan',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="mb-8 border-b border-[var(--color-rule)] pb-8">
        <p className="mkt-eyebrow mb-3">
          Home
        </p>
        <h1 className="font-display font-normal text-[length:var(--text-display-s)] text-[var(--color-ink)] tracking-tight leading-[1.08]">
          Will AI mention your brand?
        </h1>
        <p className="text-base text-[var(--color-ink-2)] mt-3 max-w-2xl leading-relaxed">
          Audit citation health and pick the next optimization move across Google and AI answer engines.
        </p>
      </div>

      <VisibilityRetentionCard signedIn={signedIn} onNavigate={onNavigate} />

      {/* Zero-audit home primary CTA strip */}
      {shouldShowHomeCta(auditCount) && <HomeCtaStrip onNavigate={onNavigate} />}

      {homeDomain && boardFindings.length > 0 && (
        <WeeklyDecisionCard
          domain={homeDomain}
          primary={primaryFinding}
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

      {/* Guided Onboarding Tracker */}
      {!onboardingComplete && (
        <div className="mb-10 rounded-lg bg-[var(--color-paper-2)] border border-gold/40 p-6 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-gold">
                  Guided Onboarding
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-gold/15 text-gold-light border border-gold/30">
                  {completedStepsCount} of 3 completed
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Three steps: audit, profile, then save to a project.
              </p>
            </div>
            <div className="w-full sm:w-36 h-2 bg-white/10 rounded-full overflow-hidden shrink-0">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-500 rounded-full"
                style={{ width: `${(completedStepsCount / 3) * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {onboardingSteps.map((step) => (
              <div
                key={step.id}
                className={`p-4 rounded border transition-all flex flex-col justify-between gap-3 ${
                  step.done
                    ? 'border-success-500/30 bg-success-500/[0.04]'
                    : 'border-white/10 bg-white/[0.02] hover:border-gold/40'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white">{step.title}</span>
                    {step.done ? (
                      <span className="text-[11px] font-mono uppercase text-success-400 font-bold">✓ Done</span>
                    ) : (
                      <span className="text-[11px] font-mono uppercase text-gold font-bold">Next</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">{step.desc}</p>
                </div>
                {!step.done && (
                  <button
                    type="button"
                    onClick={() => handleStepClick(step.view, step.id)}
                    className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-black text-[11px] font-semibold uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    {step.cta}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg bg-[var(--color-paper-2)] p-4 border border-gold/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${dna ? 'bg-success-400 shadow-sm shadow-success-500/30' : 'bg-gold animate-pulse'}`} />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Business profile</div>
            <div className="text-sm font-bold text-white">{dna ? dna.name : 'Not set - full audits stay locked to scout mode'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(AppView.BUSINESS_DNA)}
          className="px-4 py-2 rounded-lg bg-gold/10 border border-gold/30 text-[11px] font-bold uppercase tracking-wider text-gold-light hover:bg-gold/20 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
        >
          {dna ? 'View profile' : 'Set up profile'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {doors.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onNavigate(card.id)}
              className="text-left rounded-lg bg-[var(--color-paper-2)] border border-white/10 hover:border-gold/50 p-6 transition-all duration-300 group focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded bg-gold/10 border border-gold/30 text-gold-light group-hover:scale-105 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono uppercase tracking-widest text-gray-400">
                  {card.badge}
                </span>
              </div>
              <h2 className="text-lg font-bold text-white mb-2 group-hover:text-gold-light transition-colors">{card.title}</h2>
              <p className="text-sm text-gray-400 leading-relaxed">{card.desc}</p>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Support</span>
          <div className="flex-1 h-[1px] bg-white/5" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {secondary.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className="text-left rounded-lg bg-[var(--color-paper-2)] border border-white/10 hover:border-gold/40 p-5 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="w-4 h-4 text-gold-light" />
                  <span className="text-sm font-bold text-white">{card.title}</span>
                  <span className="ml-auto text-[11px] uppercase tracking-widest text-gray-400">{card.badge}</span>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">{card.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {advancedUi && (
        <div className="space-y-4 pt-6 border-t border-gold/20">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-warning-400">Labs & Advanced Intelligence</span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-warning-500/20 text-warning-300 font-bold">DEV MODE</span>
            <div className="flex-1 h-[1px] bg-white/5" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {labsDoors.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onNavigate(card.id)}
                  className="text-left rounded-lg bg-[var(--color-paper-2)] border border-white/10 hover:border-gold/50 p-4 transition-all group hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="p-2 rounded bg-gold/10 text-gold-light group-hover:bg-gold/20 transition-colors">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-warning-500/10 border border-warning-500/30 text-[11px] font-mono uppercase tracking-wider text-warning-300 font-bold">
                      {card.badge}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1 group-hover:text-gold-light transition-colors">{card.title}</h3>
                  <p className="text-[11px] text-gray-400 leading-relaxed">{card.desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
