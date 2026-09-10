import React from 'react';
import { AppView, BusinessDNA } from '../../types';
import { ICONS } from '../../constants';

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
      <div className="mb-10 border-b border-white/10 pb-8">
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
          Three doors. Ask for a cited answer, audit your site, or check what changed.
          Everything else stays out of the way until you need it.
        </p>
      </div>

      <div className="glass-morphism rounded-2xl p-4 border border-gold/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10 bg-black/60">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${dna ? 'bg-success-400 shadow-[0_0_12px_#10B981]' : 'bg-gold animate-pulse'}`} />
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Business profile</div>
            <div className="text-sm font-bold text-white">{dna ? dna.name : 'Not set - full audits stay locked to scout mode'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(AppView.BUSINESS_DNA)}
          className="px-4 py-2 rounded-lg bg-gold/10 border border-gold/30 text-[10px] font-bold uppercase tracking-wider text-gold-light hover:bg-gold/20 transition-all"
        >
          {dna ? 'View profile' : 'Set up profile'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        {doors.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onNavigate(card.id)}
              className="text-left glass-morphism rounded-2xl border border-white/10 hover:border-gold/50 p-6 transition-all duration-300 hover:-translate-y-1 bg-black/40 group"
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
                className="text-left glass-morphism rounded-2xl border border-white/10 hover:border-gold/40 p-5 transition-all bg-black/30"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="w-4 h-4 text-gold-light" />
                  <span className="text-sm font-bold text-white">{card.title}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-widest text-gray-500">{card.badge}</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{card.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {advancedUi && (
        <p className="mt-10 text-[10px] text-gray-500 font-mono uppercase tracking-widest">
          Developer tools on: Labs and theme studio remain in More tools / Omnibar.
        </p>
      )}
    </div>
  );
};
