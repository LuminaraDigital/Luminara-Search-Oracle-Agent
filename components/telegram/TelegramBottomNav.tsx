import React from 'react';
import { AppView } from '../../types';
import { haptic } from '../../services/telegram/tma';
import { ICONS } from '../../constants';

interface TelegramBottomNavProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenPaywall: () => void;
  onOpenTools: () => void;
}

export const TelegramBottomNav: React.FC<TelegramBottomNavProps> = ({
  currentView,
  onNavigate,
  onOpenPaywall,
  onOpenTools,
}) => {
  const handleNav = (view: AppView) => {
    haptic('light');
    onNavigate(view);
  };

  const isToolsActive = [
    AppView.NOTEBOOK,
    AppView.BUSINESS_DNA,
    AppView.STRESS_TEST,
    AppView.DATA_ANALYST,
    AppView.TIMESFM_FORECAST,
    AppView.ORACLE_MIND,
    AppView.ORGANIZER,
    AppView.RESEARCH,
    AppView.VISION,
    AppView.HARNESS,
  ].includes(currentView);

  return (
    <nav
      aria-label="Telegram navigation"
      className="md:hidden shrink-0 z-40 bg-black/95 backdrop-blur-xl border-t border-gold/20 flex items-center justify-around px-2 pt-2 transition-all"
      style={{
        paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px), 8px) + 2px)',
      }}
    >
      {/* 1. Instant Audit */}
      <button
        onClick={() => handleNav(AppView.INSTANT_AUDIT)}
        aria-label="Audit"
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
          currentView === AppView.INSTANT_AUDIT
            ? 'text-gold-light scale-105 font-bold'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <div className={`p-1 rounded-xl transition-all ${currentView === AppView.INSTANT_AUDIT ? 'bg-gold/20 text-gold-light shadow-[0_0_10px_rgba(191,149,63,0.3)]' : ''}`}>
          <ICONS.Search className="w-5 h-5" />
        </div>
        <span className="text-[10px] mt-0.5 tracking-tight font-medium">Audit</span>
      </button>

      {/* 2. Ask Oracle */}
      <button
        onClick={() => handleNav(AppView.ORACLE_AGENT)}
        aria-label="Ask Oracle"
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
          currentView === AppView.ORACLE_AGENT
            ? 'text-gold-light scale-105 font-bold'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <div className={`p-1 rounded-xl transition-all ${currentView === AppView.ORACLE_AGENT ? 'bg-gold/20 text-gold-light shadow-[0_0_10px_rgba(191,149,63,0.3)]' : ''}`}>
          <ICONS.Sparkle className="w-5 h-5" />
        </div>
        <span className="text-[10px] mt-0.5 tracking-tight font-medium">Oracle</span>
      </button>

      {/* 3. Dashboard */}
      <button
        onClick={() => handleNav(AppView.DASHBOARD)}
        aria-label="Dashboard"
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
          currentView === AppView.DASHBOARD
            ? 'text-gold-light scale-105 font-bold'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <div className={`p-1 rounded-xl transition-all ${currentView === AppView.DASHBOARD ? 'bg-gold/20 text-gold-light shadow-[0_0_10px_rgba(191,149,63,0.3)]' : ''}`}>
          <ICONS.Shield className="w-5 h-5" />
        </div>
        <span className="text-[10px] mt-0.5 tracking-tight font-medium">Dashboard</span>
      </button>

      {/* 4. Strategy & Tools */}
      <button
        onClick={() => {
          haptic('light');
          onOpenTools();
        }}
        aria-label="Tools"
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
          isToolsActive
            ? 'text-gold-light scale-105 font-bold'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <div className={`p-1 rounded-xl transition-all ${isToolsActive ? 'bg-gold/20 text-gold-light shadow-[0_0_10px_rgba(191,149,63,0.3)]' : ''}`}>
          <ICONS.DNA className="w-5 h-5" />
        </div>
        <span className="text-[10px] mt-0.5 tracking-tight font-medium">Tools</span>
      </button>

      {/* 5. Subscription Plan / Stars */}
      <button
        onClick={() => {
          haptic('light');
          onOpenPaywall();
        }}
        aria-label="Subscription Plan"
        className="flex flex-col items-center justify-center flex-1 py-1 text-gold hover:text-gold-light transition-all"
      >
        <div className="p-1 rounded-xl bg-gold/15 text-gold border border-gold/30 shadow-[0_0_8px_rgba(191,149,63,0.2)]">
          <span className="text-xs font-bold leading-none">⭐</span>
        </div>
        <span className="text-[10px] mt-0.5 tracking-tight font-bold text-gold">Plan</span>
      </button>
    </nav>
  );
};
