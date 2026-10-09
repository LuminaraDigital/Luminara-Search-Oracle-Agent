import React, { useMemo, useState } from 'react';
import { AppView } from '../../types';
import { ICONS } from '../ui/icons';
import { Button } from '../ui/Button';

export interface EcosystemHubViewProps {
  onSelectView: (view: AppView) => void;
  onOpenVaultManager?: () => void;
}

interface CapabilityItem {
  id: string;
  view: AppView;
  title: string;
  tagline: string;
  category: 'audit' | 'forecast' | 'trust' | 'agent';
  platforms: Array<'web' | 'desktop' | 'tma'>;
  isFeatured?: boolean;
  isPopular?: boolean;
  badge?: string;
}

const CAPABILITIES: CapabilityItem[] = [
  {
    id: 'instant-audit',
    view: AppView.INSTANT_AUDIT,
    title: 'Instant Audit',
    tagline: 'Multi-engine organic visibility analysis across Google, Perplexity, and AI Overviews.',
    category: 'audit',
    platforms: ['web', 'desktop', 'tma'],
    isFeatured: true,
    badge: 'Core Engine',
  },
  {
    id: 'trust-center',
    view: AppView.TRUST_CENTER,
    title: 'Trust Center & Brand Passport',
    tagline: 'Cryptographic domain verification, Trust Receipts, and machine-readable citations.',
    category: 'trust',
    platforms: ['web', 'desktop', 'tma'],
    isFeatured: true,
    badge: 'Cryptographic',
  },
  {
    id: 'timesfm-forecast',
    view: AppView.TIMESFM_FORECAST,
    title: 'TimesFM Predictive Forecast',
    tagline: 'Zero-shot AI time-series forecasting with probabilistic quantile confidence bounds.',
    category: 'forecast',
    platforms: ['web', 'desktop'],
    isPopular: true,
    badge: 'Labs',
  },
  {
    id: 'merchant-launchpad',
    view: AppView.LAUNCHPAD,
    title: 'SMB Merchant Launchpad',
    tagline: 'Non-custodial milestone pre-order escrow and loyalty voucher tokens.',
    category: 'trust',
    platforms: ['web', 'desktop'],
    isPopular: true,
    badge: 'Web3',
  },
  {
    id: 'brand-memory',
    view: AppView.BRAND_MEMORY,
    title: 'Brand Memory Vault',
    tagline: 'Long-term context graph capturing audits, competitive moves, and brand DNA.',
    category: 'audit',
    platforms: ['web', 'desktop', 'tma'],
  },
  {
    id: 'oracle-mind',
    view: AppView.ORACLE_MIND,
    title: 'Oracle Mind Research',
    tagline: 'Autonomous multi-perspective agent research and executive synthesis.',
    category: 'agent',
    platforms: ['web', 'desktop'],
  },
  {
    id: 'idea-scout',
    view: AppView.IDEA_SCOUT,
    title: 'Idea Scout & Continuum',
    tagline: 'Strategic content gap discovery and organic growth tracking.',
    category: 'audit',
    platforms: ['web', 'desktop', 'tma'],
  },
  {
    id: 'data-analyst',
    view: AppView.DATA_ANALYST,
    title: 'Data Analyst & SQL Workbench',
    tagline: 'Interactive dataset exploration, CSV ingestion, and schema analytics.',
    category: 'forecast',
    platforms: ['web', 'desktop'],
  },
  {
    id: 'vision-auditor',
    view: AppView.VISION,
    title: 'Vision & Multimodal Teardown',
    tagline: 'Computer vision UX audit and rendering diagnostics for web assets.',
    category: 'audit',
    platforms: ['web', 'desktop'],
  },
  {
    id: 'archy-harness',
    view: AppView.HARNESS,
    title: 'Archy Agent Harness',
    tagline: 'Autonomous agent matrix execution with live task lifecycle monitoring.',
    category: 'agent',
    platforms: ['web', 'desktop'],
    badge: 'Automation',
  },
  {
    id: 'notebook',
    view: AppView.NOTEBOOK,
    title: 'Collaborative Notebook',
    tagline: 'Persistent scratchpad for audit findings and client-ready action items.',
    category: 'agent',
    platforms: ['web', 'desktop', 'tma'],
  },
];

type CategoryFilter = 'all' | 'audit' | 'forecast' | 'trust' | 'agent';

export const EcosystemHubView: React.FC<EcosystemHubViewProps> = ({ onSelectView, onOpenVaultManager }) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const filteredItems = useMemo(() => {
    return CAPABILITIES.filter((item) => {
      const matchCat = category === 'all' || item.category === category;
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.tagline.toLowerCase().includes(q) ||
        item.badge?.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [category, search]);

  const featured = useMemo(() => CAPABILITIES.filter((c) => c.isFeatured), []);

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-6 space-y-6 text-ink animate-fade-in">
      {/* Header Banner */}
      <header className="rounded-2xl border border-rule bg-surface-1 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-0.5 text-[10px] font-mono font-medium text-gold">
            <ICONS.Sparkle className="h-3 w-3" />
            <span>ECOSYSTEM DIRECTORY</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-display text-gold-light">Capabilities & Playbooks</h1>
          <p className="text-xs md:text-sm text-ink-2">
            Curated catalog of Luminara agents, predictive tools, and verification surfaces.
            Launch any tool directly or export your encrypted brand vault.
          </p>
        </div>

        {onOpenVaultManager && (
          <div className="shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenVaultManager}
              className="flex items-center gap-2 border-gold/40 text-gold hover:bg-gold/10 font-mono text-xs"
            >
              <ICONS.Shield className="h-4 w-4" />
              <span>Brand Vault (.luminara-vault)</span>
            </Button>
          </div>
        )}
      </header>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <ICONS.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search capabilities, playbooks, or tags..."
            className="w-full rounded-xl border border-rule bg-surface-1 pl-9 pr-4 py-2 text-xs text-ink placeholder-ink-2/40 focus:border-gold outline-none"
          />
        </div>

        {/* Categories */}
        <div className="flex flex-wrap gap-1.5 text-xs font-mono">
          {(
            [
              ['all', 'All'],
              ['audit', 'Audits & SEO'],
              ['forecast', 'Predictive AI'],
              ['trust', 'Web3 & Trust'],
              ['agent', 'Agent Tasks'],
            ] as Array<[CategoryFilter, string]>
          ).map(([cat, label]) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                category === cat
                  ? 'border border-gold/40 bg-gold/15 text-gold font-medium'
                  : 'border border-rule bg-surface-1 text-ink-2 hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Featured Section (when no search query) */}
      {!search && category === 'all' && (
        <section className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-wider text-ink-2">Featured Core Surfaces</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {featured.map((item) => (
              <div
                key={item.id}
                className="group rounded-2xl border border-gold/30 bg-surface-1 p-5 hover:border-gold/60 transition-all flex flex-col justify-between gap-4 shadow-sm"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-gold/10 border border-gold/30 px-2 py-0.5 text-[10px] font-mono text-gold">
                      {item.badge}
                    </span>
                    <div className="flex items-center gap-1 text-[10px] font-mono text-ink-2 uppercase">
                      {item.platforms.join(' • ')}
                    </div>
                  </div>
                  <h3 className="text-base font-semibold text-ink group-hover:text-gold-light transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-xs text-ink-2 line-clamp-2">{item.tagline}</p>
                </div>
                <div className="pt-2 border-t border-rule flex justify-end">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => onSelectView(item.view)}
                    className="font-mono text-xs"
                  >
                    Launch Surface →
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Grid of Capabilities */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono uppercase tracking-wider text-ink-2">
          {category === 'all' ? 'All Directory Tools' : `Filtered Results (${filteredItems.length})`}
        </h2>

        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-rule bg-surface-1 p-8 text-center text-xs text-ink-2 font-mono">
            No capabilities match your search criteria.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-rule bg-surface-1 p-4 hover:border-gold/40 transition-colors flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase text-ink-2">{item.category}</span>
                    {item.badge && (
                      <span className="rounded bg-surface border border-rule px-1.5 py-0.5 text-[9px] font-mono text-gold">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="text-xs text-ink-2 line-clamp-3">{item.tagline}</p>
                </div>

                <div className="pt-2 border-t border-rule flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[9px] font-mono text-ink-2 uppercase">
                    {item.platforms.join('/')}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectView(item.view)}
                    className="font-mono text-xs hover:text-gold"
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
