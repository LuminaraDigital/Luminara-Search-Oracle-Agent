import React, { useMemo } from 'react';
import { ICONS } from '../../constants';
import type { SourceCitationGraph } from '../../services/visibility/sourceCitationGraphService';

interface SourceCitationGraphProps {
  graph?: SourceCitationGraph | null;
}

const kindStroke: Record<string, string> = {
  brand: '#C9A227',
  page: '#4ade80',
  external: '#67e8f9',
  competitor: '#f87171',
  query: '#a78bfa',
  error: '#9ca3af',
};

/** Deterministic radial layout (no heavy graph libs). */
function layoutNodes(graph: SourceCitationGraph, size = 320) {
  const cx = size / 2;
  const cy = size / 2;
  const brand = graph.nodes.find((n) => n.kind === 'brand');
  const others = graph.nodes.filter((n) => n.kind !== 'brand');
  const positions = new Map<string, { x: number; y: number }>();
  if (brand) positions.set(brand.id, { x: cx, y: cy });
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    const ring = n.kind === 'query' ? 70 : n.kind === 'competitor' ? 110 : 130;
    positions.set(n.id, {
      x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring,
    });
  });
  return { size, positions };
}

export const SourceCitationGraphView: React.FC<SourceCitationGraphProps> = ({ graph }) => {
  const layout = useMemo(() => (graph ? layoutNodes(graph) : null), [graph]);

  if (!graph || !layout) return null;

  const { size, positions } = layout;

  return (
    <div className="glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gold/10 border border-gold/30">
            <ICONS.Network className="w-5 h-5 text-gold-light" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Source Citation Graph</h3>
            <p className="text-xs text-gray-400">
              Queries, citations, competitors, and grounding sources for this audit.
            </p>
          </div>
        </div>
        <div className="text-right text-[10px] font-mono text-gray-500">
          <div>{graph.stats.queryNodes} queries</div>
          <div>{graph.stats.brandCites} brand cites</div>
          <div>{graph.stats.competitorNodes} competitors</div>
        </div>
      </div>

      <div className="mt-4 flex justify-center overflow-x-auto">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Source citation graph">
          {graph.edges.map((e) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            return (
              <line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={Math.min(2.5, 0.8 + e.weight * 0.4)}
              />
            );
          })}
          {graph.nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const r = n.kind === 'brand' ? 10 : n.kind === 'query' ? 5 : 7;
            return (
              <g key={n.id}>
                <circle cx={p.x} cy={p.y} r={r} fill={kindStroke[n.kind] || '#9ca3af'} opacity={0.9} />
                <title>{`${n.label} (${n.kind})`}</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-mono text-gray-500">
        {Object.entries(kindStroke).map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: c }} />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
};
