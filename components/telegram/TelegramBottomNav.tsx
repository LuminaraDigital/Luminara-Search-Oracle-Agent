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

const TOOL_VIEWS: AppView[] = [
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
  AppView.TRUST_CENTER,
];

function NavItem({
  label,
  active,
  onClick,
  children,
  emphasize,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  emphasize?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col items-center justify-center flex-1 min-w-0 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 rounded-lg ${
        emphasize
          ? 'text-gold'
          : active
            ? 'text-gold-light'
            : 'text-gray-500 hover:text-gray-200'
      }`}
    >
      <div
        className={`p-1.5 rounded-xl transition-colors ${
          emphasize
            ? 'bg-gold/15 border border-gold/30 text-gold'
            : active
              ? 'bg-gold/15 text-gold-light'
              : 'text-inherit'
        }`}
      >
        {children}
      </div>
      <span className={`text-[10px] mt-0.5 tracking-tight truncate max-w-full px-0.5 ${active || emphasize ? 'font-semibold' : 'font-medium'}`}>
        {label}
      </span>
    </button>
  );
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

  const isToolsActive = TOOL_VIEWS.includes(currentView);

  return (
    <nav
      aria-label="Telegram navigation"
      className="md:hidden shrink-0 z-40 bg-[var(--color-paper)]/95 backdrop-blur-md border-t border-[var(--color-rule)] flex items-stretch justify-around px-1 pt-1.5"
      style={{
        paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px), 8px) + 2px)',
      }}
    >
      <NavItem
        label="Idea"
        active={currentView === AppView.IDEA_SCOUT}
        onClick={() => handleNav(AppView.IDEA_SCOUT)}
      >
        <ICONS.Zap className="w-5 h-5" />
      </NavItem>

      <NavItem
        label="Audit"
        active={currentView === AppView.INSTANT_AUDIT}
        onClick={() => handleNav(AppView.INSTANT_AUDIT)}
      >
        <ICONS.Search className="w-5 h-5" />
      </NavItem>

      <NavItem
        label="Oracle"
        active={currentView === AppView.ORACLE_AGENT}
        onClick={() => handleNav(AppView.ORACLE_AGENT)}
      >
        <ICONS.Sparkle className="w-5 h-5" />
      </NavItem>

      <NavItem
        label="Home"
        active={currentView === AppView.DASHBOARD}
        onClick={() => handleNav(AppView.DASHBOARD)}
      >
        <ICONS.Shield className="w-5 h-5" />
      </NavItem>

      <NavItem
        label="Tools"
        active={isToolsActive}
        onClick={() => {
          haptic('light');
          onOpenTools();
        }}
      >
        <ICONS.DNA className="w-5 h-5" />
      </NavItem>

      <NavItem
        label="Plan"
        emphasize
        onClick={() => {
          haptic('light');
          onOpenPaywall();
        }}
      >
        <ICONS.Layers className="w-5 h-5" />
      </NavItem>
    </nav>
  );
};
