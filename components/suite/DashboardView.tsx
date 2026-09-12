import React, { useMemo } from 'react';
import { AppView, BusinessDNA } from '../../types';
import { ICONS } from '../../constants';
import { auditHistoryService } from '../../services/audit/auditHistoryService';
import { productTelemetry } from '../../services/analytics/productTelemetry';

interface DashboardViewProps {
  onNavigate: (view: AppView) => void;
  dna: BusinessDNA | null;
  onClearDNA?: () => void;
  advancedUi?: boolean;
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
export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, dna, advancedUi = false }) => {
  const hasAudits = useMemo(() => auditHistoryService.list({ limit: 1 }).length > 0, []);
  const hasDna = Boolean(dna);
  const telemetrySummary = productTelemetry.getSummary();
  const hasChatOrMemory = telemetrySummary.totalChatsSent > 0 || hasAudits;

  const onboardingSteps = [
    {
      id: 'step_scout',
      title: '1. Run Quick Scout',
      desc: 'Audit your website in 10 seconds to see if AI engines cite your brand.',
      done: hasAudits,
      view: AppView.INSTANT_AUDIT,
      cta: 'Run Scout →',
    },
    {
      id: 'step_dna',
      title: '2. Anchor Business DNA',
      desc: 'Extract your core mission and USP to unlock full personalized audits.',
      done: hasDna,
      view: AppView.BUSINESS_DNA,
      cta: 'Set Profile →',
    },
    {
      id: 'step_memory',
      title: '3. Inspect Brand Memory',
      desc: 'Track AI citation deltas and activate 24/7 Drift Sentinel monitoring.',
      done: hasChatOrMemory && hasDna,
      view: AppView.BRAND_MEMORY,
      cta: 'Open Vault →',
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
      desc: 'Clear the fog with a live, cited answer about your brand in search and AI.',
      icon: ICONS.Terminal,
      badge: 'Ask',
    },
    {
      id: AppView.INSTANT_AUDIT,
      title: 'Audit my website',
      desc: 'See whether Google and AI answers mention you, then commit to one fix.',
      icon: ICONS.Radar,
      badge: 'Audit',
    },
    {
      id: AppView.BRAND_MEMORY,
      title: 'Brand Memory',
      desc: 'What changed since last scan: citation deltas, watchlist, Sentinel.',
      icon: ICONS.Shield,
      badge: 'Memory',
    },
    {
      id: AppView.NOTEBOOK,
      title: 'Intelligence Studio',
      desc: 'Multi-source grounded dossiers, dual-host audio overviews, and briefing docs.',
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
      id: AppView.VISION,
      title: 'How Luminara works',
      desc: 'The method behind fog-clearing audits.',
      icon: ICONS.Sparkle,
      badge: 'Method',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="mb-8 border-b border-white/10 pb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-8 h-[1px] bg-gold" />
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gold-light">
            Fog clearing
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
          Will AI mention your brand?
        </h1>
        <p className="text-sm text-gray-400 mt-2 max-w-2xl leading-relaxed">
          Monitor your brand's presence, audit citation health, and uncover optimization moves across AI search engines.
        </p>
      </div>

      {/* Guided Onboarding Tracker */}
      {!onboardingComplete && (
        <div className="mb-10 glass-morphism rounded-2xl border border-gold/40 p-6 bg-black/60 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-widest text-gold">
                  Guided Onboarding
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gold/15 text-gold-light border border-gold/30">
                  {completedStepsCount} of 3 completed
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Complete these initial steps to anchor your brand in AI search visibility.
              </p>
            </div>
            <div className="w-full sm:w-36 h-2 bg-white/10 rounded-full overflow-hidden shrink-0">
              <div
                className="h-full bg-gradient-to-r from-gold to-gold-light transition-all duration-500 rounded-full"
                style={{ width: `${(completedStepsCount / 3) * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {onboardingSteps.map((step) => (
              <div
                key={step.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                  step.done
                    ? 'border-success-500/30 bg-success-500/[0.04]'
                    : 'border-white/10 bg-white/[0.02] hover:border-gold/40'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white">{step.title}</span>
                    {step.done ? (
                      <span className="text-[9px] font-mono uppercase text-success-400 font-bold">✓ Done</span>
                    ) : (
                      <span className="text-[9px] font-mono uppercase text-gold font-bold">Next</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">{step.desc}</p>
                </div>
                {!step.done && (
                  <button
                    type="button"
                    onClick={() => handleStepClick(step.view, step.id)}
                    className="w-full py-2 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black text-[10px] font-black uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-md shadow-gold/10 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    {step.cta}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-morphism rounded-2xl p-4 border border-gold/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10 bg-black/60">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${dna ? 'bg-success-400 shadow-sm shadow-success-500/30' : 'bg-gold animate-pulse'}`} />
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Business profile</div>
            <div className="text-sm font-bold text-white">{dna ? dna.name : 'Not set - full audits stay locked to scout mode'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(AppView.BUSINESS_DNA)}
          className="px-4 py-2 rounded-lg bg-gold/10 border border-gold/30 text-[10px] font-bold uppercase tracking-wider text-gold-light hover:bg-gold/20 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
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
              className="text-left glass-morphism rounded-2xl border border-white/10 hover:border-gold/50 p-6 transition-all duration-300 hover:-translate-y-1 bg-black/40 group focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded-xl bg-gold/10 border border-gold/30 text-gold-light group-hover:scale-105 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-mono uppercase tracking-widest text-gray-400">
                  {card.badge}
                </span>
              </div>
              <h2 className="text-lg font-bold text-white mb-2 group-hover:text-gold-light transition-colors">{card.title}</h2>
              <p className="text-xs text-gray-400 leading-relaxed">{card.desc}</p>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">Support</span>
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
                className="text-left glass-morphism rounded-2xl border border-white/10 hover:border-gold/40 p-5 transition-all bg-black/30 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="w-4 h-4 text-gold-light" />
                  <span className="text-sm font-bold text-white">{card.title}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-widest text-gray-400">{card.badge}</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{card.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {advancedUi && (
        <p className="mt-10 text-[10px] text-gray-400 font-mono uppercase tracking-widest">
          Developer tools on: Labs and theme studio remain in More tools / Omnibar.
        </p>
      )}
    </div>
  );
};
