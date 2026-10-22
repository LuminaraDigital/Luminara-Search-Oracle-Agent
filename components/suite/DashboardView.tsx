import React, { useEffect, useMemo, useState } from 'react';
import { HONEST_VISIBILITY_PROMISE } from '../../services/marketing/engineCoverage';
import { AppView, BusinessDNA } from '../../types';
import { ICONS } from '../../constants';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import { HomeCtaStrip } from './HomeCtaStrip';
import { VisibilityRetentionCard } from './VisibilityRetentionCard';
import { auditCountFromStorage, shouldShowHomeCta } from './homeCtaStripLogic';
import { WeeklyDecisionCard } from '../audit/WeeklyDecisionCard';
import { DreamingDashboardCard } from './DreamingDashboardCard';
import {
  listLocalFindings,
  pickPrimaryFinding,
  type BoardFinding,
} from '../../services/audit/findingBoardService';
import { auditHistoryService } from '../../services/audit/auditHistoryService';
import { AUDIT_ACTIVITY_EVENT } from '../../services/audit/auditActivity';
import { labsVisible } from '../../services/ui/labsAccess';

interface DashboardViewProps {
  onNavigate: (view: AppView) => void;
  dna: BusinessDNA | null;
  onClearDNA?: () => void;
  advancedUi?: boolean;
  signedIn?: boolean;
}

function latestAuditSeed(): { domain: string; findings: BoardFinding[] } | null {
  try {
    for (const entry of auditHistoryService.list()) {
      const findings = listLocalFindings(entry.domain);
      if (findings.length) return { domain: entry.domain, findings };
    }
  } catch {
    /* ignore */
  }
  return null;
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
  const telemetrySummary = productTelemetry.getSummary();
  const completedSteps = telemetrySummary.completedOnboardingSteps || [];
  const [auditCount, setAuditCount] = useState(() => auditCountFromStorage());
  const [homeSeed, setHomeSeed] = useState(latestAuditSeed);
  useEffect(() => {
    const bump = () => {
      setAuditCount(auditCountFromStorage());
      setHomeSeed(latestAuditSeed());
    };
    window.addEventListener(AUDIT_ACTIVITY_EVENT, bump);
    return () => window.removeEventListener(AUDIT_ACTIVITY_EVENT, bump);
  }, []);
  const hasRunAudit = auditCount > 0;
  const hasProfile = Boolean(dna) || completedSteps.includes('business_dna');
  const hasSavedProject = completedSteps.includes('strategy_saved') || completedSteps.includes('brand_memory') || (signedIn && hasRunAudit);

  const [boardFindings, setBoardFindings] = useState<BoardFinding[]>(() => homeSeed?.findings || []);
  useEffect(() => {
    setBoardFindings(homeSeed?.findings || []);
  }, [homeSeed]);
  const homeDomain = homeSeed?.domain || '';
  const primaryFinding = useMemo(() => pickPrimaryFinding(boardFindings), [boardFindings]);

  const onboardingSteps = [
    {
      id: 'step_scout',
      title: '1. Run Instant Audit',
      desc: 'Paste your site URL and get a ranked list of search and AI visibility fixes.',
      done: hasRunAudit,
      view: AppView.INSTANT_AUDIT,
      cta: 'Run audit',
    },
    {
      id: 'step_dna',
      title: '2. Set business profile',
      desc: 'Add your mission and USP so full audits match what you sell.',
      done: hasProfile,
      view: AppView.BUSINESS_DNA,
      cta: 'Set profile',
    },
    ...(signedIn
      ? []
      : [
          {
            id: 'step_save_project',
            title: '3. Save to a project',
            desc: 'Sign in to keep strategy and reports on the hosted project, not only in this browser.',
            done: hasSavedProject,
            view: AppView.INSTANT_AUDIT,
            cta: 'Continue in audit',
          },
        ]),
  ];

  const completedStepsCount = onboardingSteps.filter((s) => s.done).length;
  const onboardingComplete = completedStepsCount === onboardingSteps.length;

  const handleStepClick = (view: AppView, stepId: string) => {
    productTelemetry.track('onboarding_started', { stepId });
    onNavigate(view);
  };

  const doors: Door[] = [
    {
      id: AppView.INSTANT_AUDIT,
      title: 'Audit my website',
      desc: 'See whether Google and AI answers mention you, then pick one fix.',
      icon: ICONS.Radar,
      badge: 'Audit',
    },
    {
      id: AppView.ORACLE_AGENT,
      title: 'Ask a question',
      desc: 'Get a cited answer about your brand in search and AI answers.',
      icon: ICONS.Terminal,
      badge: 'Ask',
    },
    {
      id: AppView.BRAND_MEMORY,
      title: 'Brand Memory',
      desc: 'What changed since last scan: citations, watchlist, Sentinel.',
      icon: ICONS.Shield,
      badge: 'Memory',
    },
  ];

  const secondary: Door[] = [
    {
      id: AppView.NOTEBOOK,
      title: 'Intelligence Studio',
      desc: 'Sources, audio overviews and briefing docs in one workspace.',
      icon: ICONS.Notebook,
      badge: 'Studio',
    },
    {
      id: AppView.BUSINESS_DNA,
      title: 'Business profile',
      desc: dna
        ? `Linked to ${dna.name}. Required for a full audit.`
        : 'Set this once so every audit reinforces what you sell and who you beat.',
      icon: ICONS.DNA,
      badge: dna ? 'Linked' : 'Set up',
    },
    {
      id: AppView.IDEA_SCOUT,
      title: 'Idea Scout',
      desc: 'Turn an idea into a hypothesis card, then hand off to Instant Audit.',
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
      <div className="mb-8 mkt-chassis p-6 sm:p-7">
        <span aria-hidden className="pointer-events-none absolute -top-px -left-px h-2.5 w-2.5 border-t-2 border-l-2 border-[var(--color-accent)]" />
        <span aria-hidden className="pointer-events-none absolute -top-px -right-px h-2.5 w-2.5 border-t-2 border-r-2 border-[var(--color-accent)]" />
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-4 border-b border-[var(--color-rule)] text-[11px] font-mono">
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--gold)]" />
            <span className="text-[var(--color-accent)] uppercase tracking-[0.14em]">
              {advancedUi ? 'OBSERVATORY COMMAND DECK · LUMINARA SUITE' : 'Your AI visibility'}
            </span>
          </div>
          <span className="text-[var(--color-ink-2)]">
            {advancedUi
              ? (homeDomain ? `ACTIVE TARGET // ${homeDomain}` : 'SITE AND WEB SEARCH · WEEKLY DECISION LOOP')
              : (homeDomain || 'Site and web search')}
          </span>
        </div>
        <h1 className="font-display font-normal text-[length:var(--text-display-s)] text-[var(--color-ink)] tracking-tight leading-[1.08]">
          Will AI mention your brand?
        </h1>
        <p className="text-base text-[var(--color-ink-2)] mt-3 max-w-2xl leading-relaxed">
          {HONEST_VISIBILITY_PROMISE}
        </p>
      </div>

      <VisibilityRetentionCard signedIn={signedIn} onNavigate={onNavigate} plainLanguage={!advancedUi} />
      {advancedUi && <DreamingDashboardCard domain={homeDomain} onNavigate={onNavigate} />}

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
        <div className="mb-10 mkt-chassis p-6 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--color-accent)]">
                  Guided Onboarding
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 bg-black/60 text-[var(--gold-light)] border border-[var(--color-rule-strong)]">
                  {completedStepsCount} of {onboardingSteps.length} completed
                </span>
              </div>
              <p className="text-xs text-[var(--color-ink-2)] mt-1">
                {signedIn ? 'Two steps: audit, then a business profile.' : 'Three steps: audit, profile, then save to a project.'}
              </p>
            </div>
            <div className="w-full sm:w-36 h-2 bg-black/60 border border-[var(--color-rule)] overflow-hidden shrink-0">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-500"
                style={{ width: `${(completedStepsCount / onboardingSteps.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {onboardingSteps.map((step) => (
              <div
                key={step.id}
                className={`p-4 border transition-all flex flex-col justify-between gap-3 ${
                  step.done
                    ? 'border-success-500/40 bg-success-500/[0.05]'
                    : 'border-[var(--color-rule)] bg-black/40 hover:border-[var(--color-accent)]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-[var(--color-ink)]">{step.title}</span>
                    {step.done ? (
                      <span className="text-[11px] font-mono uppercase text-success-400 font-semibold">✓ Done</span>
                    ) : (
                      <span className="text-[11px] font-mono uppercase text-[var(--color-accent)]">Next</span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--color-ink-2)] leading-relaxed">{step.desc}</p>
                </div>
                {!step.done && (
                  <button
                    type="button"
                    onClick={() => handleStepClick(step.view, step.id)}
                    className="mkt-cta-primary w-full !min-h-9 !py-1.5 !px-3 !text-xs"
                  >
                    {step.cta}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mkt-chassis-subtle p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
        <div className="flex items-center gap-4">
          <div className={`w-2.5 h-2.5 rounded-full ${dna ? 'bg-success-400 shadow-sm shadow-success-500/30' : 'bg-[var(--color-accent)] animate-pulse'}`} />
          <div>
            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--color-accent)]">Business profile</div>
            <div className="text-sm font-medium text-[var(--color-ink)] mt-0.5">{dna ? dna.name : 'Not set - full audits stay locked to scout mode'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(AppView.BUSINESS_DNA)}
          className="mkt-cta-secondary !min-h-9 !py-1.5 !px-4 !text-xs font-mono uppercase tracking-wider"
        >
          {dna ? 'View profile' : 'Set up profile'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
        {doors.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onNavigate(card.id)}
              className="text-left mkt-chassis p-6 transition-colors duration-200 group hover:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-2.5 bg-black/60 border border-[var(--color-rule-strong)] text-[var(--gold-light)] group-hover:border-[var(--color-accent)] transition-colors">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 bg-black/50 border border-[var(--color-rule)] text-[11px] font-mono uppercase tracking-widest text-[var(--color-accent)]">
                  {card.badge}
                </span>
              </div>
              <h2 className="text-lg font-medium text-[var(--color-ink)] mb-2 group-hover:text-[var(--gold-light)] transition-colors">{card.title}</h2>
              <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">{card.desc}</p>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--color-accent)]">Support & Workspace</span>
          <div className="flex-1 h-[1px] bg-[var(--color-rule)]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {secondary.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className="text-left mkt-chassis-subtle p-5 hover:border-[var(--color-accent)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="w-4 h-4 text-[var(--gold-light)]" />
                  <span className="text-sm font-medium text-[var(--color-ink)]">{card.title}</span>
                  <span className="ml-auto text-[11px] font-mono uppercase tracking-widest text-[var(--color-ink-2)]">{card.badge}</span>
                </div>
                <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">{card.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {advancedUi && labsVisible() && (
        <div className="space-y-4 pt-6 mt-6 border-t border-[var(--color-rule)]">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-warning-400">Labs & Advanced Intelligence</span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 bg-warning-500/20 text-warning-300 font-semibold">DEV MODE</span>
            <div className="flex-1 h-[1px] bg-[var(--color-rule)]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {labsDoors.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onNavigate(card.id)}
                  className="text-left mkt-chassis-subtle p-4 hover:border-[var(--color-accent)] transition-all group focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="p-2 bg-black/50 border border-[var(--color-rule)] text-[var(--gold-light)]">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="px-2 py-0.5 bg-warning-500/10 border border-warning-500/30 text-[11px] font-mono uppercase tracking-wider text-warning-300">
                      {card.badge}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-[var(--color-ink)] mb-1 group-hover:text-[var(--gold-light)] transition-colors">{card.title}</h3>
                  <p className="text-[12px] text-[var(--color-ink-2)] leading-relaxed">{card.desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
