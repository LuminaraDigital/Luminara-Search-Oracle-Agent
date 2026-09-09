import React, { useState } from 'react';
import { ICONS } from '../../constants';
import type { EnterpriseTrustPack, TrustStatus } from '../../services/trust/enterpriseTrustPackService';

interface EnterpriseTrustPanelProps {
  pack?: EnterpriseTrustPack | null;
}

const statusClass = (s: TrustStatus) => {
  if (s === 'pass') return 'text-success-300 border-success-500/30 bg-success-500/10';
  if (s === 'partial') return 'text-warning-300 border-warning-500/30 bg-warning-500/10';
  if (s === 'fail') return 'text-danger-300 border-danger-500/30 bg-danger-500/10';
  return 'text-gray-400 border-white/10 bg-white/5';
};

export const EnterpriseTrustPanel: React.FC<EnterpriseTrustPanelProps> = ({ pack }) => {
  const [tab, setTab] = useState<'controls' | 'datasets' | 'volumes' | 'eeat'>('controls');
  if (!pack) return null;

  return (
    <div className="glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gold/10 border border-gold/30">
            <ICONS.Shield className="w-5 h-5 text-gold-light" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Enterprise Trust Pack</h3>
            <p className="text-xs text-gray-400">
              Controls checklist, dataset provenance, and prompt-volume estimates. Not a SOC 2 certification.
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="block text-[10px] font-mono text-gray-500 uppercase">Readiness</span>
          <span className="text-lg font-bold font-mono text-gold-light">{pack.readinessScore}/100</span>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-warning-500/30 bg-warning-500/5 px-3 py-2 text-[11px] text-warning-200">
        Disclaimer: <code className="font-mono">{pack.meta.disclaimer}</code>. Use this as an evidence map for buyers
        and auditors, not as a claim that Luminara is SOC 2 certified.
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['controls', 'Controls'],
            ['datasets', 'Datasets'],
            ['volumes', 'Prompt volumes'],
            ['eeat', 'E-E-A-T'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all ${
              tab === id
                ? 'border-gold/50 text-gold-light bg-gold/10'
                : 'border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2 max-h-72 overflow-y-auto pr-1">
        {tab === 'controls' &&
          pack.controls.map((c) => (
            <div key={c.id} className={`rounded-lg border p-2.5 text-xs ${statusClass(c.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white">{c.title}</span>
                <span className="font-mono uppercase text-[9px]">{c.status}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">{c.detail}</p>
              <p className="text-[9px] font-mono text-gray-500 mt-1">
                {c.criterion} · {c.period} · {c.owner}
              </p>
            </div>
          ))}

        {tab === 'datasets' &&
          pack.datasetProvenance.map((d) => (
            <div key={d.id} className="glass-morphism rounded-lg border border-white/10 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-gold-light hover:underline">
                  {d.name}
                </a>
                <span className="font-mono text-[9px] text-gray-500 uppercase">{d.health}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">{d.usedIn}</p>
              <p className="text-[9px] font-mono text-gray-500 mt-1">
                {d.topic} · {d.license || 'n/a'} · {d.free ? 'free' : 'paid'}
              </p>
            </div>
          ))}

        {tab === 'volumes' &&
          pack.promptVolumeEstimates.map((p) => (
            <div key={p.id} className="glass-morphism rounded-lg border border-white/10 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white">{p.surface}</span>
                <span className="font-mono text-[9px] text-cyan-300 uppercase">{p.method}</span>
              </div>
              <p className="text-sm font-mono text-gold-light mt-1">
                {typeof p.prompts === 'number' && `${p.prompts} prompts`}
                {typeof p.sessions === 'number' && `${typeof p.prompts === 'number' ? ' · ' : ''}${p.sessions} sessions`}
                {' · '}confidence {p.confidence}%
              </p>
              <p className="text-[11px] text-gray-400 mt-1">{p.notes}</p>
            </div>
          ))}

        {tab === 'eeat' &&
          pack.eeatSignals.map((e) => (
            <div key={e.id} className={`rounded-lg border p-2.5 text-xs ${statusClass(e.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white">
                  {e.system.toUpperCase()} · {e.itemCode}
                  {e.veto ? ' · VETO' : ''}
                </span>
                <span className="font-mono uppercase text-[9px]">{e.status}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">{e.detail}</p>
            </div>
          ))}
      </div>

      {pack.sourceGraphSummary && (
        <p className="mt-3 text-[10px] font-mono text-gray-500">
          Source graph: {pack.sourceGraphSummary.nodes} nodes · {pack.sourceGraphSummary.edges} edges ·{' '}
          {pack.sourceGraphSummary.brandCites} brand cites
        </p>
      )}
    </div>
  );
};
