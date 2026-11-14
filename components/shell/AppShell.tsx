import React from 'react';
import { ICONS } from '../../constants';
import { AppView } from '../../types';

/** The signed-in app's chrome: a left rail from 1024px, a top bar, and a tab bar on phones. Styles in ledger.css. */

export type AgentState = 'idle' | 'working' | 'waiting';

type NavItem = { view: AppView; label: string; short?: string; icon: React.FC<{ className?: string }>; item: string };

const NAV: NavItem[] = [
  { view: AppView.ORACLE_AGENT, label: 'Ask', icon: ICONS.Chat, item: 'ask' },
  { view: AppView.INSTANT_AUDIT, label: 'Instant Audit', short: 'Audit', icon: ICONS.Radar, item: 'instant-audit' },
  { view: AppView.REVIEW, label: 'Review', icon: ICONS.Inbox, item: 'review' },
  { view: AppView.DASHBOARD, label: 'Dashboard', icon: ICONS.Layers, item: 'dashboard' },
  { view: AppView.BRAND_MEMORY, label: 'Memory', icon: ICONS.Bookmark, item: 'memory' },
  { view: AppView.NOTEBOOK, label: 'Studio', icon: ICONS.Notebook, item: 'studio' },
];

/** Tabs on a phone. Memory, Studio and the rest live behind More. */
const TABS = NAV.slice(0, 4);

export const VIEW_TITLES: Partial<Record<AppView, string>> = {
  [AppView.ORACLE_AGENT]: 'Ask',
  [AppView.INSTANT_AUDIT]: 'Instant Audit',
  [AppView.REVIEW]: 'Review',
  [AppView.DASHBOARD]: 'Dashboard',
  [AppView.BRAND_MEMORY]: 'Memory',
  [AppView.NOTEBOOK]: 'Studio',
  [AppView.IDEA_SCOUT]: 'Idea Scout',
  [AppView.BUSINESS_DNA]: 'Business profile',
  [AppView.TRUST_CENTER]: 'Trust',
  [AppView.ENQUIRY_DESK]: 'Enquiry Desk',
  [AppView.ECOSYSTEM_HUB]: 'Playbooks',
  [AppView.HARNESS]: 'Developer harness',
  [AppView.ORACLE_MIND]: 'OracleMind',
  [AppView.TIMESFM_FORECAST]: 'Forecaster',
  [AppView.STRESS_TEST]: 'Poke holes in my plan',
  [AppView.DATA_ANALYST]: 'Analyse my data',
  [AppView.ORGANIZER]: 'Turn notes into a plan',
  [AppView.RESEARCH]: 'Research the market',
  [AppView.VISION]: 'Vision',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

interface RailProps {
  view: AppView;
  onNavigate: (v: AppView) => void;
  onBrand: () => void;
  brandTitle: string;
  businessName: string | null;
  onBusiness: () => void;
  pendingCount: number;
  moreOpen: boolean;
  moreActive: boolean;
  onMore: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onSearch: () => void;
  onSettings: () => void;
  footer: React.ReactNode;
}

export const AppRail: React.FC<RailProps> = ({
  view, onNavigate, onBrand, brandTitle, businessName, onBusiness, pendingCount,
  moreOpen, moreActive, onMore, onSearch, onSettings, footer,
}) => (
  <aside className="lg-rail" aria-label="Workspace">
    <button type="button" className="lg-brand" onClick={onBrand} title={brandTitle} aria-label={brandTitle}>
      <ICONS.LuminaraLogo className="w-7 h-7" />
      <b>Luminara</b>
    </button>

    <button
      type="button"
      className="lg-proj"
      onClick={onBusiness}
      data-testid="add-business-pill"
      data-header-item="business"
      title="Business profile"
    >
      <span className="lg-fav" aria-hidden="true">{businessName ? initials(businessName) : '+'}</span>
      <span className="lg-proj-t">
        <b>{businessName ?? 'Add my business'}</b>
        <small>{businessName ? 'Business profile' : 'Answers get specific to you'}</small>
      </span>
    </button>

    <nav className="lg-nav" aria-label="Primary tools">
      {NAV.map(({ view: v, label, icon: Icon, item }) => (
        <button
          key={v}
          type="button"
          onClick={() => onNavigate(v)}
          aria-current={view === v ? 'page' : undefined}
          data-header-item={item}
        >
          <Icon />
          {label}
          {v === AppView.REVIEW && pendingCount > 0 && (
            <span className="lg-count" aria-label={`${pendingCount} waiting`}>{pendingCount}</span>
          )}
        </button>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-current={moreActive ? 'page' : undefined}
        data-header-item="more"
      >
        <ICONS.Plus />
        More tools
      </button>
      <button type="button" onClick={onSearch} data-testid="header-search" data-header-item="search" title="Jump to a tool (Cmd+K)">
        <ICONS.Search />
        Jump to a tool
        <kbd className="lg-mono" style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--lg-fg-3)' }}>⌘K</kbd>
      </button>
      <button type="button" onClick={onSettings} data-header-item="settings">
        <ICONS.Settings />
        Settings and AI keys
      </button>
    </nav>

    <div className="lg-rail-foot">
      <div className="lg-rail-note">
        <b>Changes wait for you</b>
        <span>Anything that touches your website or calendar stops in Review until you approve it.</span>
      </div>
      {footer}
    </div>
  </aside>
);

interface TopBarProps {
  title: string;
  businessName: string | null;
  agent: AgentState;
  pendingCount: number;
  onStatus: () => void;
  onBrand: () => void;
  brandTitle: string;
  children?: React.ReactNode;
}

const STATUS_TEXT: Record<AgentState, string> = {
  idle: 'Ready',
  working: 'Working',
  waiting: 'Waiting for your OK',
};

export const AppTopBar: React.FC<TopBarProps> = ({ title, businessName, agent, pendingCount, onStatus, onBrand, brandTitle, children }) => (
  <header className="lg-top" data-testid="app-header">
    <button type="button" className="lg-top-brand" onClick={onBrand} aria-label={brandTitle} data-header-item="brand">
      <ICONS.LuminaraLogo className="w-8 h-8" />
    </button>
    <div className="lg-crumb">
      {businessName && <><span>{businessName}</span><span aria-hidden="true">/</span></>}
      <b>{title}</b>
    </div>
    <div className="lg-top-r">
      {children}
      <button
        type="button"
        className="lg-status"
        onClick={onStatus}
        data-header-item="status"
        aria-label={agent === 'waiting' ? `${pendingCount} waiting for your OK. Open Review` : `Agent: ${STATUS_TEXT[agent]}. Open Review`}
      >
        <span className="lg-dot" aria-hidden="true" />
        <span className="lg-status-t">{STATUS_TEXT[agent]}{agent === 'waiting' && pendingCount > 1 ? ` · ${pendingCount}` : ''}</span>
      </button>
    </div>
  </header>
);

interface TabBarProps {
  view: AppView;
  onNavigate: (v: AppView) => void;
  pendingCount: number;
  moreOpen: boolean;
  moreActive: boolean;
  onMore: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const AppTabBar: React.FC<TabBarProps> = ({ view, onNavigate, pendingCount, moreOpen, moreActive, onMore }) => (
  <nav className="lg-tabbar" aria-label="Primary">
    {TABS.map(({ view: v, label, short, icon: Icon }) => (
      <button key={v} type="button" onClick={() => onNavigate(v)} aria-current={view === v ? 'page' : undefined}>
        <Icon />
        {short ?? label}
        {v === AppView.REVIEW && pendingCount > 0 && <span className="lg-count">{pendingCount}</span>}
      </button>
    ))}
    <button type="button" onClick={onMore} aria-haspopup="menu" aria-expanded={moreOpen} aria-current={moreActive ? 'page' : undefined}>
      <ICONS.Plus />
      More
    </button>
  </nav>
);

/** Views reached from the rail or tab bar. Anything else counts as "More". */
export const PRIMARY_VIEWS: ReadonlySet<AppView> = new Set(NAV.map((n) => n.view));
