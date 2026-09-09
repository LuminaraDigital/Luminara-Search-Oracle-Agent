import React, { useEffect, useState } from 'react';
import { ICONS } from '../../constants';
import { trafficInsightsService, type TrafficImpact } from '../../services/analytics/trafficInsightsService';

interface ResultsTrackingCardProps {
  impact?: TrafficImpact;
  domain: string;
}

const openSettings = () => window.dispatchEvent(new CustomEvent('luminara-open-settings'));

const Change: React.FC<{ pct: number | null }> = ({ pct }) => {
  if (pct === null) return <span className="text-[10px] font-mono text-gray-500">new</span>;
  const rounded = Math.round(pct);
  const up = rounded > 0;
  const down = rounded < 0;
  const color = up ? 'text-success-400' : down ? 'text-danger-400' : 'text-gray-400';
  const arrow = up ? '↑' : down ? '↓' : '→';
  return (
    <span className={`text-[10px] font-mono ${color}`} title="Compared with the previous period">
      {arrow} {rounded > 0 ? '+' : ''}{rounded}%
    </span>
  );
};

const Tile: React.FC<{ label: string; value: number; changePct: number | null; children?: React.ReactNode }> = ({ label, value, changePct, children }) => (
  <div className="glass-morphism rounded-xl p-3.5 border border-white/10 flex flex-col">
    <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">{label}</span>
    <div className="flex items-baseline gap-2 mt-1">
      <span className="text-2xl font-black font-mono text-white">{value.toLocaleString()}</span>
      <Change pct={changePct} />
    </div>
    {children}
  </div>
);

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl flex flex-col">
    {children}
  </div>
);

const Header: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="flex items-center gap-3 pb-4 border-b border-white/10">
    <div className="p-2 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
      <ICONS.Activity className="w-5 h-5 text-gold-light" />
    </div>
    <div>
      <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
      {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
    </div>
  </div>
);

const ActionButton: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean }> = ({ onClick, children, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="px-4 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-[10px] tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gold/20 shrink-0 disabled:opacity-40 disabled:hover:scale-100"
  >
    {children}
  </button>
);

export const ResultsTrackingCard: React.FC<ResultsTrackingCardProps> = ({ impact: impactProp, domain }) => {
  const [impact, setImpact] = useState<TrafficImpact | undefined>(impactProp);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setImpact(impactProp);
  }, [impactProp]);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const fresh = await trafficInsightsService.getImpact(domain);
      setImpact(fresh);
    } finally {
      setRetrying(false);
    }
  };

  // Not set up yet (or nothing measured at all).
  if (!impact || impact.status === 'not_configured') {
    return (
      <Frame>
        <Header title="Is it working?" />
        <div className="pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-1">
          <p className="text-xs text-gray-300 leading-relaxed">
            See whether the fixes work: add free results tracking and this card fills with real visitors and visits from AI assistants.
          </p>
          <ActionButton onClick={openSettings}>Set up tracking</ActionButton>
        </div>
      </Frame>
    );
  }

  if (impact.status === 'no_website') {
    return (
      <Frame>
        <Header title="Is it working?" />
        <div className="pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-1">
          <p className="text-xs text-gray-300 leading-relaxed">
            Tracking is connected but <span className="font-mono text-white">{impact.domain || domain}</span> isn&apos;t added yet. Add it in your tracking dashboard and paste the snippet into your site.
          </p>
          <ActionButton onClick={openSettings}>Open Settings</ActionButton>
        </div>
      </Frame>
    );
  }

  if (impact.status === 'error') {
    return (
      <Frame>
        <Header title="Is it working?" />
        <div className="pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-1">
          <p className="text-xs text-warning-200 flex items-start gap-2 leading-relaxed">
            <ICONS.AlertTriangle className="w-4 h-4 text-warning-400 shrink-0 mt-0.5" />
            <span>{impact.message || 'Could not read your traffic right now.'}</span>
          </p>
          <ActionButton onClick={handleRetry} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry'}</ActionButton>
        </div>
      </Frame>
    );
  }

  // ready
  const ai = impact.aiAssistantReferrals;
  const search = impact.searchReferrals;
  const topSources = impact.topReferrers.slice(0, 3);
  const subtitle = impact.websiteName ? `Measured on ${impact.websiteName}` : 'Measured on your own site';

  return (
    <Frame>
      <Header title={`Is it working? Last ${impact.period.days.toLocaleString()} days`} subtitle={subtitle} />

      <div className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile label="Visitors" value={impact.visitors.current} changePct={impact.visitors.changePct} />

        <Tile label="Visits from AI assistants" value={ai.total} changePct={ai.changePct}>
          {ai.total > 0 && ai.bySource.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {ai.bySource.slice(0, 4).map(s => (
                <span key={s.name} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-gray-300">
                  {s.name} {s.visits.toLocaleString()}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-gray-500 leading-snug">None yet &mdash; this is what the fixes should change.</p>
          )}
        </Tile>

        <Tile label="Visits from search" value={search.total} changePct={search.changePct} />
      </div>

      {topSources.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1.5">Top sources</p>
          <ul className="space-y-1">
            {topSources.map(s => (
              <li key={s.host} className="flex items-center justify-between text-xs">
                <span className="text-gray-300 truncate pr-3" title={s.host}>{s.name || s.host}</span>
                <span className="font-mono text-gray-400 shrink-0">{s.visits.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-gray-400">
        Measured on your own site, not an estimate.
      </div>
    </Frame>
  );
};
