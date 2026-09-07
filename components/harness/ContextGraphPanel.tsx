import React, { useEffect, useMemo, useState } from 'react';
import { contextGraphService } from '../../services/contextGraph/contextGraphService';
import {
  ContextGraphConflict,
  ContextGraphDecision,
  ContextGraphNode,
  ContextGraphRuleFinding,
  HybridRetrieveResult
} from '../../types';

type GraphSubTab = 'explore' | 'decisions' | 'provenance' | 'conflicts' | 'export';

export const ContextGraphPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<GraphSubTab>('explore');
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edgeFilter, setEdgeFilter] = useState('');
  const [queryText, setQueryText] = useState('brand competitors AEO');
  const [queryResult, setQueryResult] = useState<HybridRetrieveResult | null>(null);
  const [exportText, setExportText] = useState('');
  const [graphAware, setGraphAware] = useState(contextGraphService.isGraphAwareAgents());
  const [chainDecisionId, setChainDecisionId] = useState<string | null>(null);

  useEffect(() => {
    return contextGraphService.subscribe(() => setVersion(v => v + 1));
  }, []);

  const stats = useMemo(() => contextGraphService.getStats(), [version]);
  const nodes = useMemo(() => {
    const all = contextGraphService.listNodes();
    if (!search.trim()) return all;
    return contextGraphService.findNodes(search);
  }, [version, search]);
  const edges = useMemo(() => {
    const all = contextGraphService.listEdges();
    if (!edgeFilter.trim()) return all;
    const f = edgeFilter.toLowerCase();
    return all.filter(e => e.edgeType.toLowerCase().includes(f));
  }, [version, edgeFilter]);
  const decisions = useMemo(() => contextGraphService.listDecisions(), [version]);
  const conflicts = useMemo(() => contextGraphService.detectConflicts(), [version]);
  const provenance = useMemo(() => contextGraphService.listProvenance(), [version]);
  const selected = selectedId ? contextGraphService.getNode(selectedId) : null;
  const neighbors = selectedId ? contextGraphService.getNeighbors(selectedId, 1) : { nodes: [], edges: [] };
  const chain = chainDecisionId ? contextGraphService.traceDecision(chainDecisionId) : null;

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 4000);
  };

  const handleSyncDna = () => {
    const res = contextGraphService.syncFromDna();
    flash(res.message);
    setVersion(v => v + 1);
  };

  const handleIngestAudit = () => {
    const res = contextGraphService.ingestAudit();
    flash(res.message);
    setVersion(v => v + 1);
  };

  const handleRunRules = () => {
    const findings = contextGraphService.runAeoRules();
    flash(`AEO rules: ${findings.length} finding(s). See Conflicts tab for related issues.`);
    setSubTab('conflicts');
    setVersion(v => v + 1);
  };

  const handleQuery = () => {
    const res = contextGraphService.query(queryText);
    setQueryResult(res);
  };

  const handleExport = (kind: 'jsonld' | 'prov' | 'full') => {
    if (kind === 'jsonld') setExportText(contextGraphService.exportJsonLd());
    else if (kind === 'prov') setExportText(contextGraphService.exportProvenance());
    else setExportText(contextGraphService.exportFull());
    setSubTab('export');
  };

  const handleRecordSampleDecision = () => {
    const d = contextGraphService.recordDecision({
      category: 'manual',
      scenario: 'Manual harness decision from Context Graph panel',
      reasoning: 'User recorded a sample decision for chain testing',
      outcome: 'recorded',
      confidence: 0.9
    });
    if (decisions[0]) {
      contextGraphService.addCausalLink(decisions[0].id, d.id, 'PRECEDENT_FOR');
    }
    flash(`Recorded decision ${d.id}`);
    setVersion(v => v + 1);
  };

  const tabs: Array<{ id: GraphSubTab; label: string }> = [
    { id: 'explore', label: 'Explore' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'provenance', label: 'Provenance' },
    { id: 'conflicts', label: 'Conflicts' },
    { id: 'export', label: 'Export' }
  ];

  const ruleFindings: ContextGraphRuleFinding[] =
    subTab === 'conflicts' ? contextGraphService.runAeoRules() : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Luminara Context Graph</h2>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl">
            Browser-first entity graph for AEO saturation, decision provenance, and hybrid VFS retrieval.
            Clean-room TypeScript (not a Semantica fork).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSyncDna}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-[#BF953F]/20 border border-[#BF953F]/50 text-[#FCF6BA] hover:bg-[#BF953F]/30"
          >
            Sync from DNA
          </button>
          <button
            onClick={handleIngestAudit}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider glass-morphism border border-white/15 text-gray-200 hover:text-white"
          >
            Ingest last audit
          </button>
          <button
            onClick={handleRunRules}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider glass-morphism border border-white/15 text-gray-200 hover:text-white"
          >
            Run AEO rules
          </button>
          <button
            onClick={() => handleExport('jsonld')}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider glass-morphism border border-emerald-500/40 text-emerald-300"
          >
            Export JSON-LD
          </button>
        </div>
      </div>

      {status && (
        <div className="px-4 py-2 rounded-xl border border-[#BF953F]/40 bg-[#BF953F]/10 text-xs text-[#FCF6BA] font-mono">
          {status}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Nodes', value: stats.nodeCount },
          { label: 'Edges', value: stats.edgeCount },
          { label: 'Decisions', value: stats.decisionCount },
          { label: 'Conflicts', value: stats.conflictCount }
        ].map(s => (
          <div key={s.label} className="glass-morphism rounded-xl border border-white/10 p-3">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">{s.label}</div>
            <div className="text-2xl font-bold text-white mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={graphAware}
          onChange={e => {
            const on = e.target.checked;
            setGraphAware(on);
            contextGraphService.setGraphAwareAgents(on);
          }}
          className="rounded border-white/20"
        />
        Graph-aware agent context (inject hybrid retrieve precedents into Agent Matrix dispatch)
      </label>

      <div className="flex gap-2 overflow-x-auto border-b border-white/5 pb-2">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono shrink-0 border ${
              subTab === t.id
                ? 'bg-[#BF953F]/20 text-[#FCF6BA] border-[#BF953F]/50'
                : 'text-gray-400 border-transparent hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'explore' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search nodes..."
              className="w-full bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-xs font-mono text-white"
            />
            <input
              value={edgeFilter}
              onChange={e => setEdgeFilter(e.target.value)}
              placeholder="Filter edges by type..."
              className="w-full bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-xs font-mono text-white"
            />
            <div className="max-h-80 overflow-y-auto space-y-1">
              {nodes.map((n: ContextGraphNode) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs border ${
                    selectedId === n.id
                      ? 'border-[#BF953F]/60 bg-[#BF953F]/10 text-[#FCF6BA]'
                      : 'border-white/5 text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <span className="text-[9px] uppercase text-gray-500 mr-2">{n.type}</span>
                  {n.label}
                </button>
              ))}
              {nodes.length === 0 && (
                <p className="text-xs text-gray-500 p-3">No nodes yet. Sync from DNA to start.</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {selected ? (
              <div className="glass-morphism rounded-xl border border-white/10 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#BF953F] font-bold">{selected.type}</div>
                    <h3 className="text-lg font-bold text-white">{selected.label}</h3>
                    <div className="text-[10px] font-mono text-gray-500 mt-1">{selected.id}</div>
                  </div>
                </div>
                <pre className="text-[10px] font-mono text-gray-300 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-40">
                  {JSON.stringify(selected.properties, null, 2)}
                </pre>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">
                    Neighbors (1 hop) · {neighbors.nodes.length} nodes · {neighbors.edges.length} edges
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {neighbors.nodes.map(n => (
                      <button
                        key={n.id}
                        onClick={() => setSelectedId(n.id)}
                        className="px-2 py-1 rounded-md text-[10px] border border-white/10 text-gray-300 hover:border-[#BF953F]/40"
                      >
                        {n.type}: {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-morphism rounded-xl border border-white/10 p-8 text-center text-xs text-gray-500">
                Select a node to inspect neighbors and properties.
              </div>
            )}

            <div className="glass-morphism rounded-xl border border-white/10 p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Hybrid query (graph + VFS)</div>
              <div className="flex gap-2">
                <input
                  value={queryText}
                  onChange={e => setQueryText(e.target.value)}
                  className="flex-1 bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  onKeyDown={e => e.key === 'Enter' && handleQuery()}
                />
                <button
                  onClick={handleQuery}
                  className="px-4 py-2 rounded-lg bg-[#BF953F]/20 border border-[#BF953F]/50 text-[#FCF6BA] text-xs font-bold"
                >
                  Query
                </button>
              </div>
              {queryResult && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  <div className="text-[10px] text-gray-500 font-mono">
                    {queryResult.hits.length} hits in {queryResult.executionTimeMs}ms
                  </div>
                  {queryResult.hits.map(h => (
                    <div key={`${h.kind}_${h.id}`} className="text-xs border border-white/5 rounded-lg p-2">
                      <div className="text-[#FCF6BA] font-mono text-[10px]">
                        {h.kind} · {h.score.toFixed(3)}
                      </div>
                      <div className="text-white">{h.title}</div>
                      <div className="text-gray-400 mt-1">{h.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-morphism rounded-xl border border-white/10 p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">
                Edges ({edges.length})
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 font-mono text-[10px] text-gray-400">
                {edges.slice(0, 40).map(e => (
                  <div key={e.id}>
                    {`${e.fromId.slice(0, 24)} -[${e.edgeType}]-> ${e.toId.slice(0, 24)}`}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'decisions' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={handleRecordSampleDecision}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-[#BF953F]/20 border border-[#BF953F]/50 text-[#FCF6BA]"
            >
              Record sample decision
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-gray-500 border-b border-white/10">
                <tr>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3">Confidence</th>
                  <th className="py-2">Chain</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d: ContextGraphDecision) => (
                  <tr key={d.id} className="border-b border-white/5 text-gray-300">
                    <td className="py-2 pr-3 font-mono">{d.category}</td>
                    <td className="py-2 pr-3">{d.outcome}</td>
                    <td className="py-2 pr-3">{(d.confidence * 100).toFixed(0)}%</td>
                    <td className="py-2">
                      <button
                        onClick={() => setChainDecisionId(d.id)}
                        className="text-[#FCF6BA] hover:underline"
                      >
                        Trace
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {decisions.length === 0 && (
              <p className="text-xs text-gray-500 p-4">No decisions yet. Ingest an audit or record a sample.</p>
            )}
          </div>
          {chain && (
            <div className="glass-morphism rounded-xl border border-[#BF953F]/30 p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#BF953F] font-bold mb-2">Decision chain</div>
              <div className="space-y-2">
                {chain.chain.map((d, i) => (
                  <div key={d.id} className="text-xs text-gray-300">
                    {i > 0 && (
                      <div className="text-[10px] text-[#FCF6BA] font-mono mb-1">
                        {chain.edgeTypes[i - 1] || 'CAUSED'} ↓
                      </div>
                    )}
                    <div className="font-bold text-white">{d.category}: {d.outcome}</div>
                    <div className="text-gray-400">{d.scenario}</div>
                    <div className="text-gray-500 mt-1">{d.reasoning}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'provenance' && (
        <div className="space-y-2 max-h-[480px] overflow-y-auto">
          {provenance.length === 0 && (
            <p className="text-xs text-gray-500">No provenance trails yet. Sync DNA or ingest an audit.</p>
          )}
          {provenance.map(p => (
            <div key={p.entityId} className="glass-morphism rounded-xl border border-white/10 p-3">
              <div className="text-[10px] font-mono text-[#FCF6BA]">{p.entityId}</div>
              {p.entries.slice(0, 3).map((e, i) => (
                <div key={i} className="text-xs text-gray-400 mt-1">
                  {e.source} · {e.extractor} · conf {(e.confidence * 100).toFixed(0)}%
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {subTab === 'conflicts' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white mb-2">Detected conflicts</h3>
            {conflicts.length === 0 && <p className="text-xs text-gray-500">No conflicts detected.</p>}
            {conflicts.map((c: ContextGraphConflict) => (
              <div key={c.id} className="glass-morphism rounded-xl border border-red-500/30 p-3 mb-2">
                <div className="text-[10px] font-bold uppercase text-red-300">{c.severity} · {c.field}</div>
                <div className="text-xs text-gray-300 mt-1">{c.message}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{c.values.join(' | ')}</div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="text-sm font-bold text-white mb-2">AEO rule findings</h3>
            {ruleFindings.length === 0 && <p className="text-xs text-gray-500">No rule findings.</p>}
            {ruleFindings.map(f => (
              <div key={`${f.ruleId}_${f.relatedNodeIds[0] || ''}`} className="glass-morphism rounded-xl border border-amber-500/30 p-3 mb-2">
                <div className="text-[10px] font-bold uppercase text-amber-300">{f.severity} · {f.name}</div>
                <div className="text-xs text-gray-300 mt-1">{f.message}</div>
                <div className="text-xs text-emerald-300/80 mt-1">{f.recommendation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'export' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleExport('jsonld')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-white/15 text-gray-200">
              Organization JSON-LD
            </button>
            <button onClick={() => handleExport('prov')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-white/15 text-gray-200">
              Provenance JSON
            </button>
            <button onClick={() => handleExport('full')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-white/15 text-gray-200">
              Full graph JSON
            </button>
            {exportText && (
              <button
                onClick={() => navigator.clipboard.writeText(exportText)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"
              >
                Copy
              </button>
            )}
          </div>
          <textarea
            readOnly
            value={exportText || '// Click an export button above'}
            className="w-full h-80 bg-black/60 border border-white/10 rounded-xl p-4 text-[10px] font-mono text-gray-300"
          />
        </div>
      )}
    </div>
  );
};
