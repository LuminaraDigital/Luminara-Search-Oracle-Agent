import React, { useEffect, useMemo, useState } from 'react';
import { AppView, BusinessDNA } from '../../types';
import { ICONS } from '../../constants';
import { brandMemoryVaultService, type BrandMemoryEvent } from '../../services/memory/brandMemoryVaultService';
import { auditHistoryService, type AuditHistoryEntry } from '../../services/audit/auditHistoryService';
import { auditDiffService, type AuditPeriodDiff } from '../../services/audit/auditDiffService';
import { auditQueryService } from '../../services/audit/auditQueryService';
import {
  agencyWorkspaceService,
  type AgencyClient,
} from '../../services/workspace/agencyWorkspaceService';
import {
  competitorWatchlistService,
  type CompetitorAlert,
  type CompetitorWatchItem,
} from '../../services/competitors/competitorWatchlistService';
import { entitlementsFor } from '../../services/plans/planEntitlements';
import { registerSentinelTarget, fetchSentinelStatus, fetchQuotaStatus, subscribeQuota, type QuotaInfo } from '../../services/apiClient';
import { mem0MemoryEngine } from '../../services/agentCore/mem0MemoryEngine';
import { MemoryFact } from '../../services/agentCore/types';

interface Props {
  dna: BusinessDNA | null;
  onNavigate: (view: AppView) => void;
  onOpenPaywall?: () => void;
}

export const BrandMemoryView: React.FC<Props> = ({ dna, onNavigate, onOpenPaywall }) => {
  const [events, setEvents] = useState<BrandMemoryEvent[]>([]);
  const [audits, setAudits] = useState<AuditHistoryEntry[]>([]);
  const [diff, setDiff] = useState<AuditPeriodDiff | null>(null);
  const [query, setQuery] = useState('audits where score < 60');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryHits, setQueryHits] = useState<AuditHistoryEntry[]>([]);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [watch, setWatch] = useState<CompetitorWatchItem[]>([]);
  const [alerts, setAlerts] = useState<CompetitorAlert[]>([]);
  const [watchName, setWatchName] = useState('');
  const [sentinelMsg, setSentinelMsg] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [tab, setTab] = useState<'timeline' | 'diff' | 'query' | 'watch' | 'agency' | 'mem0'>('diff');
  const [mem0Facts, setMem0Facts] = useState<MemoryFact[]>([]);

  const planId = quota?.plan || 'free';
  const entitlements = entitlementsFor(planId);
  const primaryDomain =
    audits[0]?.domain ||
    (dna?.name ? dna.name.toLowerCase().replace(/\s+/g, '') + '.com' : '');

  const refresh = () => {
    setEvents(brandMemoryVaultService.listEvents(40));
    setAudits(auditHistoryService.list({ limit: 40 }));
    setClients(agencyWorkspaceService.list());
    setActiveClientId(agencyWorkspaceService.getActiveClientId());
    setMem0Facts(mem0MemoryEngine.getFacts());
    const domain = auditHistoryService.list({ limit: 1 })[0]?.domain;
    if (domain) {
      setDiff(auditDiffService.diffSince(domain, 30 * 24 * 3600 * 1000));
      setWatch(competitorWatchlistService.list(domain));
    } else {
      setWatch(competitorWatchlistService.list());
    }
    setAlerts(competitorWatchlistService.listAlerts());
  };

  useEffect(() => {
    refresh();
    fetchQuotaStatus();
    const unsubMem0 = mem0MemoryEngine.subscribe(() => setMem0Facts(mem0MemoryEngine.getFacts()));
    const unsubQuota = subscribeQuota((q) => setQuota(q));
    return () => {
      unsubMem0();
      unsubQuota();
    };
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.competitor) {
        setTab('watch');
        setWatchName(String(detail.competitor));
      }
    };
    window.addEventListener('luminara-open-brand-memory', onOpen);
    return () => window.removeEventListener('luminara-open-brand-memory', onOpen);
  }, []);

  const domainOptions = useMemo(() => {
    const set = new Set(audits.map((a) => a.domain));
    return [...set];
  }, [audits]);

  const runQuery = () => {
    const res = auditQueryService.run(query);
    if (!res.ok) {
      setQueryError(res.error || 'Query failed');
      setQueryHits([]);
      return;
    }
    setQueryError(null);
    setQueryHits(res.matches);
  };

  const handleCreateClient = () => {
    const res = agencyWorkspaceService.create(newClientName || 'New client', {
      dna,
      planId,
      domains: domainOptions.slice(0, 3),
    });
    if ('error' in res) {
      setSentinelMsg(res.error);
      onOpenPaywall?.();
      return;
    }
    setNewClientName('');
    refresh();
  };

  const handleAddWatch = () => {
    const domain = domainOptions[0] || primaryDomain || 'example.com';
    const res = competitorWatchlistService.add(watchName, domain, { planId });
    if ('error' in res) {
      setSentinelMsg(res.error);
      return;
    }
    setWatchName('');
    refresh();
  };

  const handleEnableSentinel = async () => {
    const domain = domainOptions[0];
    if (!domain) {
      setSentinelMsg('Run an audit first so we know which domain to watch.');
      return;
    }
    if (dna?.competitors?.length) {
      competitorWatchlistService.seedFromDna(dna.competitors, domain, planId);
    }
    const keywords = competitorWatchlistService.sentinelKeywordsFor(domain, dna?.name || domain);
    try {
      await registerSentinelTarget({
        domain,
        brandName: dna?.name || domain,
        keywords,
        competitorNames: competitorWatchlistService.list(domain).map((w) => w.name),
        reauditCadence: entitlements.scheduledReaudit === 'none' ? 'weekly' : entitlements.scheduledReaudit,
      });
      const status = await fetchSentinelStatus();
      setSentinelMsg(`Sentinel watching ${status.targets?.length || 1} domain(s). Cron scans daily; re-audit nudges follow your plan.`);
      refresh();
    } catch (e: any) {
      setSentinelMsg(e?.message || 'Could not register Sentinel. Sign in and use a paid plan.');
      if (String(e?.message || '').includes('402') || String(e?.message || '').toLowerCase().includes('plan')) {
        onOpenPaywall?.();
      }
    }
  };

  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: 'diff', label: 'What changed' },
    { id: 'mem0', label: '4-Tier Memory' },
    { id: 'timeline', label: 'Memory timeline' },
    { id: 'query', label: 'Audit query' },
    { id: 'watch', label: 'Competitor watch' },
    { id: 'agency', label: 'Agency clients' },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 animate-fade-in font-['Outfit'] pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">Brand Memory Vault</span>
          <h2 className="text-2xl md:text-3xl font-bold text-white mt-1">AEO memory that compounds</h2>
          <p className="text-sm text-gray-400 mt-2 max-w-2xl">
            Every audit, chat insight, and competitor mention is saved to your vault and context graph.
            Plan: <span className="text-gold-light font-semibold">{entitlements.title}</span>
            {' · '}
            {entitlements.domainLimit} domains · {entitlements.sentinelLimit} Sentinel slots
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onNavigate(AppView.INSTANT_AUDIT)}
            className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-black uppercase tracking-wider focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Run audit
          </button>
          <button
            type="button"
            onClick={handleEnableSentinel}
            className="px-4 py-2 rounded-xl border border-gold/40 text-gold text-xs font-bold uppercase tracking-wider hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Enable Sentinel
          </button>
        </div>
      </div>

      {sentinelMsg && (
        <div className="p-3 rounded-2xl border border-white/10 bg-white/[0.03] text-xs text-gray-300">{sentinelMsg}</div>
      )}

      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-black/40 border border-white/10">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
              tab === t.id ? 'bg-gold text-black' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-white">Audit memory</h3>
          {audits.length === 0 ? (
            <div className="p-6 text-center border border-white/10 rounded-2xl bg-white/[0.02] space-y-2">
              <p className="text-xs text-gray-400">No audits stored yet. Run your first audit to start the historical memory timeline.</p>
              <button
                type="button"
                onClick={() => onNavigate(AppView.INSTANT_AUDIT)}
                className="px-4 py-2 rounded-xl bg-gold/20 border border-gold/40 text-gold-light text-xs font-bold hover:bg-gold/30 transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Run Instant Audit →
              </button>
            </div>
          ) : (
            audits.map((a) => (
              <div key={a.id} className="p-4 rounded-2xl border border-white/10 bg-white/[0.02]">
                <div className="flex justify-between gap-3 text-xs">
                  <span className="text-gold-light font-bold">{a.title}</span>
                  <span className="text-gray-400 font-mono">{new Date(a.measuredAt).toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-2 line-clamp-2">{a.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-400">
                  <span>Score {a.healthScore ?? 'n/a'}</span>
                  <span>Citation {a.citationRatePercent ?? 'n/a'}%</span>
                  {a.competitorsMentioned.slice(0, 4).map((c) => (
                    <span key={c} className="text-gold/80">
                      [[{c}]]
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
          <h3 className="text-sm font-bold text-white pt-4">Vault events</h3>
          {events.map((ev) => (
            <div key={ev.id} className="p-3 rounded-xl border border-white/5 bg-black/30 text-[11px] text-gray-400">
              <span className="text-gold uppercase tracking-wider text-[9px] font-black mr-2">{ev.type}</span>
              {ev.title}
            </div>
          ))}
        </div>
      )}

      {tab === 'diff' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white">What changed since last month?</h3>
          {!diff?.after ? (
            <div className="p-8 text-center border border-white/10 rounded-2xl bg-white/[0.02] space-y-3">
              <span className="text-3xl block">📊</span>
              <p className="text-sm font-semibold text-white">No Audit History Stored Yet</p>
              <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                Run an audit to establish your search and AI visibility baseline. Future scans automatically calculate citation deltas, competitor movements, and sentiment changes.
              </p>
              <button
                type="button"
                onClick={() => onNavigate(AppView.INSTANT_AUDIT)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black text-xs font-black uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-md shadow-gold/20"
              >
                Run Instant Audit →
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-300 leading-relaxed">{diff.narrative}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {diff.metrics.map((m) => (
                  <div key={m.key} className="p-4 rounded-2xl border border-white/10 bg-white/[0.02]">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">{m.label}</div>
                    <div className="text-lg font-bold text-white mt-1">
                      {m.after ?? 'n/a'}
                      {m.delta != null && (
                        <span className={`ml-2 text-xs ${m.delta >= 0 ? 'text-success-400' : 'text-danger-400'}`}>
                          {m.delta >= 0 ? '+' : ''}
                          {m.delta}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">Was {m.before ?? 'n/a'}</div>
                  </div>
                ))}
              </div>
              {diff.competitors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gold-light">Competitor citation deltas</h4>
                  {diff.competitors.map((c) => (
                    <div key={c.name} className="text-[11px] text-gray-400 flex justify-between border-b border-white/5 py-1.5">
                      <span>[[{c.name}]]</span>
                      <span className="uppercase tracking-wider text-[9px] text-gold">{c.change}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'query' && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-white">Query stored audits</h3>
          <p className="text-[11px] text-gray-400">
            Examples: <code className="text-gold-light">audits where score &lt; 60</code>,{' '}
            <code className="text-gold-light">audits where competitor = Acme</code>,{' '}
            <code className="text-gold-light">audits where focus = AEO and citation &gt;= 40</code>
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Query stored audits"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              placeholder="audits where score < 60"
            />
            <button
              type="button"
              onClick={runQuery}
              className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-black uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Run
            </button>
          </div>
          {queryError && <p className="text-xs text-danger-400">{queryError}</p>}
          <p className="text-[10px] text-gray-400">{queryHits.length} match(es)</p>
          {queryHits.map((a) => (
            <div key={a.id} className="p-3 rounded-xl border border-white/10 text-xs text-gray-300">
              {a.domain} · {a.focus} · score {a.healthScore ?? 'n/a'} · {new Date(a.measuredAt).toLocaleDateString()}
            </div>
          ))}
        </div>
      )}

      {tab === 'watch' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white">Competitor watchlist</h3>
          <div className="flex gap-2">
            <input
              aria-label="Competitor name to watch"
              value={watchName}
              onChange={(e) => setWatchName(e.target.value)}
              className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              placeholder="Competitor name"
            />
            <button type="button" onClick={handleAddWatch} className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-black uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none">
              Add
            </button>
          </div>
          {watch.map((w) => (
            <div key={w.id} className="flex justify-between items-center p-3 rounded-xl border border-white/10 text-xs">
              <span className="text-white">[[{w.name}]] <span className="text-gray-400">for {w.brandDomain}</span></span>
              <button type="button" className="text-danger-400 hover:text-danger-300 transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none" onClick={() => { competitorWatchlistService.remove(w.id); refresh(); }}>
                Remove
              </button>
            </div>
          ))}
          <h4 className="text-xs font-bold text-gold-light pt-2">Alerts</h4>
          {alerts.length === 0 && <p className="text-[11px] text-gray-400">No citation delta alerts yet.</p>}
          {alerts.slice(0, 20).map((a) => (
            <div key={a.id} className="p-3 rounded-xl border border-white/5 text-[11px] text-gray-400">
              <span className={`uppercase text-[9px] font-black mr-2 ${a.change === 'gained' ? 'text-success-400' : 'text-danger-400'}`}>
                {a.change}
              </span>
              {a.message}
            </div>
          ))}
          {alerts.some((a) => !a.read) && (
            <button type="button" className="text-[10px] text-gold underline focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none" onClick={() => { competitorWatchlistService.markAlertsRead(); refresh(); }}>
              Mark alerts read
            </button>
          )}
        </div>
      )}

      {tab === 'agency' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white">Client workspaces</h3>
          <p className="text-[11px] text-gray-400">
            Pro / Agency unlocks up to {entitlements.agencyClientLimit || 10} isolated clients (DNA + history).
            Current plan allows {entitlements.agencyClientLimit}.
          </p>
          <div className="flex gap-2">
            <input
              aria-label="New client workspace name"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              placeholder="Client name"
            />
            <button type="button" onClick={handleCreateClient} className="px-4 py-2 rounded-xl bg-gold text-black text-xs font-black uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none">
              Add client
            </button>
          </div>
          {clients.length === 0 && (
            <div className="p-6 text-center border border-dashed border-white/15 rounded-2xl bg-white/[0.01] space-y-1.5">
              <span className="text-2xl block mb-1">🏢</span>
              <p className="text-xs font-bold text-white">No Client Workspaces Created Yet</p>
              <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
                Isolate client Brand DNA, competitor watchlists, and citation histories. Type a client name above to create your first client workspace.
              </p>
            </div>
          )}
          {clients.map((c) => (
            <div
              key={c.id}
              className={`p-4 rounded-2xl border ${activeClientId === c.id ? 'border-gold/50 bg-gold/5' : 'border-white/10 bg-white/[0.02]'}`}
            >
              <div className="flex justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">{c.name}</div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {c.domains.join(', ') || 'No domains'} · DNA {c.dna?.name || 'none'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[10px] text-gold font-bold uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    onClick={() => {
                      agencyWorkspaceService.setActive(c.id);
                      refresh();
                    }}
                  >
                    Activate
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-danger-400 hover:text-danger-300 transition-colors uppercase focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    onClick={() => {
                      agencyWorkspaceService.delete(c.id);
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {entitlements.agencyClientLimit <= 0 && (
            <button
              type="button"
              onClick={() => onOpenPaywall?.()}
              className="w-full py-3 rounded-xl border border-gold/40 text-gold text-xs font-black uppercase tracking-wider focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Upgrade to Pro / Agency
            </button>
          )}
        </div>
      )}

      {tab === 'mem0' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🧠</span> Autonomous 4-Tier Knowledge Graph
              </h3>
              <p className="text-xs text-gray-400">
                Mem0-inspired multi-tier memory. Learns silently from audits and chats, extracting facts and auto-resolving conflicts.
              </p>
            </div>
            {mem0Facts.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  mem0MemoryEngine.clear();
                  refresh();
                }}
                className="px-3 py-1 bg-danger-500/20 hover:bg-danger-500/30 text-danger-300 border border-danger-500/30 rounded-lg text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Clear All Facts
              </button>
            )}
          </div>

          {mem0Facts.length === 0 ? (
            <div className="p-8 text-center border border-white/10 rounded-2xl bg-white/[0.02]">
              <span className="text-3xl block mb-2">🌱</span>
              <p className="text-sm font-semibold text-white">No Autonomous Facts Extracted Yet</p>
              <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
                Run an instant audit or converse with the Oracle Agent. The Mem0 engine will automatically extract brand identity, competitors, and technical health facts.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mem0Facts.map((fact) => (
                <div
                  key={fact.id}
                  className="p-4 rounded-xl border border-white/10 bg-slate-900/60 hover:border-slate-700 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {fact.tier.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-success-400 font-mono">
                        {Math.round(fact.confidence * 100)}% confidence
                      </span>
                    </div>
                    <div className="text-xs font-mono text-info-300 font-semibold mb-1">
                      {fact.key}
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed font-sans">
                      {fact.value}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-800 text-[10px] text-slate-400">
                    <span>Entity: {fact.entityId}</span>
                    <button
                      type="button"
                      onClick={() => {
                        mem0MemoryEngine.applyDelta({
                          action: 'DELETE',
                          tier: fact.tier,
                          entityId: fact.entityId,
                          key: fact.key,
                          value: '',
                          rationale: 'User pruned',
                          confidence: 1,
                        });
                        refresh();
                      }}
                      className="text-danger-400 hover:text-danger-300 transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-gray-400 pt-4">
        <ICONS.Shield className="w-3.5 h-3.5" />
        Memory stays in your browser workspace and syncs to your signed-in account. No third-party PKM runtime.
      </div>
    </div>
  );
};
