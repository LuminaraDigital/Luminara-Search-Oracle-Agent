import React from 'react';
import { ICONS } from '../../constants';
import type { TrustPackSummary } from '../../services/audit/aeoTrustPackService';

interface TrustPackPanelProps {
  trustPack?: TrustPackSummary | null;
}

const ymylBadgeClass = (tier: string) => {
  if (tier === 'high') return 'bg-danger-500/20 text-danger-300 border-danger-500/40';
  if (tier === 'elevated') return 'bg-warning-500/20 text-warning-300 border-warning-500/40';
  return 'bg-success-500/20 text-success-300 border-success-500/30';
};

const findingColor = (severity: string) => {
  if (severity === 'critical') return 'text-danger-300 border-danger-500/30';
  if (severity === 'high') return 'text-warning-300 border-warning-500/30';
  if (severity === 'medium') return 'text-gold-light border-gold/30';
  return 'text-gray-400 border-white/10';
};

export const TrustPackPanel: React.FC<TrustPackPanelProps> = ({ trustPack }) => {
  if (!trustPack) return null;

  const {
    citeWorthiness,
    securityTrust,
    citationIntegrity,
    entityClarity,
    schemaSafety,
    ymylTier,
    findings,
    formula,
    confidenceCap,
    signalStatus,
  } = trustPack;

  return (
    <div className="my-6 glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
            <ICONS.Shield className="w-5 h-5 text-gold-light" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              AEO Cite-Worthiness Trust Pack
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${ymylBadgeClass(ymylTier)}`}>
                YMYL: {ymylTier}
              </span>
            </h3>
            <p className="text-xs text-gray-400">
              Weighted security, citation integrity, entity clarity, and schema safety. Score never outruns measurement confidence.
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <span className="text-[10px] font-mono text-gray-500 uppercase">Cite-Worthiness:</span>
            <span className="text-lg font-bold font-mono text-gold-light">
              {citeWorthiness}/100
            </span>
          </div>
          <span className="text-[9px] font-mono text-gray-500">cap {confidenceCap}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4">
        {[
          { label: 'Security Trust', value: securityTrust, status: signalStatus.security },
          { label: 'Citation Integrity', value: citationIntegrity, status: signalStatus.integrity },
          { label: 'Entity Clarity', value: entityClarity, status: signalStatus.entityClarity },
          { label: 'Schema Safety', value: schemaSafety, status: signalStatus.schema },
        ].map((s) => (
          <div key={s.label} className="glass-morphism rounded-xl p-3 border border-white/10 text-center">
            <span className="block text-[10px] uppercase font-mono text-gray-400">{s.label}</span>
            <span className="text-base font-bold font-mono text-success-400">{s.value}/100</span>
            <span className="block text-[9px] text-gray-500 mt-0.5">{s.status}</span>
          </div>
        ))}
      </div>

      {findings.length > 0 && (
        <div className="mt-4 space-y-2">
          <span className="text-[10px] font-mono text-gold-light uppercase tracking-wider font-bold">
            Findings
          </span>
          {findings.map((f, idx) => (
            <div
              key={idx}
              className={`glass-morphism rounded-lg p-2.5 border text-xs ${findingColor(f.severity)}`}
            >
              <span className="font-mono uppercase text-[10px] mr-2">[{f.severity}]</span>
              <span className="font-bold text-white">{f.title}</span>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{f.detail}</p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 pt-3 border-t border-white/5 text-[10px] font-mono text-gray-500 break-all">
        {formula}
      </p>
    </div>
  );
};
