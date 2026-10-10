import React from 'react';
import { buildExplorerAddressUrl } from '../../../chain/evmChainRegistry';

export interface ContractAuditCardProps {
  address?: string;
  network?: string;
  score?: string | number;
  findings?: Array<[string, string, string]> | any[];
  onInspect?: () => void;
  args?: any[];
}

export const ContractAuditCard: React.FC<ContractAuditCardProps> = ({
  address: propAddress,
  network: propNetwork,
  score: propScore,
  findings: propFindings,
  onInspect: propOnInspect,
  args,
}) => {
  const address = propAddress ?? (args?.[0] !== undefined ? String(args[0]) : '0x0000000000000000000000000000000000000000');
  const network = propNetwork ?? (args?.[1] !== undefined ? String(args[1]) : 'Base');
  const scoreRaw = propScore ?? (args?.[2] !== undefined ? String(args[2]) : '85/100 (Safe)');
  const findingsList = propFindings ?? (Array.isArray(args?.[3]) ? args[3] : []);
  const callback = propOnInspect ?? (typeof args?.[4] === 'function' ? args[4] : undefined);

  const shortAddress = address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

  const scoreStr = String(scoreRaw);
  const isHighRisk = /high risk|danger|poor|critical/i.test(scoreStr);
  const isModerate = /moderate|warning|fair/i.test(scoreStr);

  const scoreBadgeColor = isHighRisk
    ? 'border-red-500/40 bg-red-950/30 text-red-300'
    : isModerate
    ? 'border-yellow-500/40 bg-yellow-950/30 text-yellow-300'
    : 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300';

  return (
    <div className="p-5 my-4 rounded-2xl border border-white/10 bg-black/60 shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition-all hover:border-white/20">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-emerald-400 font-bold">
          Verified Contract Safety Audit
        </span>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300 text-[10px] font-mono">
            {network}
          </span>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold ${scoreBadgeColor}`}>
            {scoreStr}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold text-white leading-snug">
            Target: <span className="font-mono text-cyan-300 text-sm">{shortAddress}</span>
          </h4>
          <a
            href={buildExplorerAddressUrl(8453, address) || `https://basescan.org/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-gray-400 hover:text-white transition-colors underline"
          >
            View on Explorer ↗
          </a>
        </div>
        <p className="text-xs text-gray-400 font-mono mt-1">
          Deconstructed from verified bytecode & ABI. No developer jargon.
        </p>
      </div>

      {Array.isArray(findingsList) && findingsList.length > 0 && (
        <div className="space-y-2 mb-4 border-t border-white/10 pt-3">
          {findingsList.map((item, idx) => {
            const name = Array.isArray(item) ? item[0] : item?.name || 'Check';
            const status = Array.isArray(item) ? item[1] : item?.status || 'Info';
            const detail = Array.isArray(item) ? item[2] : item?.detail || '';

            const isWarning = /warning|danger|dangerous|critical/i.test(String(status));
            const isSafe = /safe|passed|verified/i.test(String(status));

            const badgeColor = isWarning
              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
              : isSafe
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-white/10 bg-white/5 text-gray-300';

            return (
              <div key={idx} className="flex items-start justify-between text-xs p-2 rounded-lg bg-white/[0.02] border border-white/5">
                <div>
                  <span className="font-medium text-gray-200">{name}</span>
                  {detail && <p className="text-[11px] text-gray-400 mt-0.5">{detail}</p>}
                </div>
                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono ${badgeColor}`}>
                  {status}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {callback && (
        <div className="flex items-center justify-end pt-3 border-t border-white/10">
          <button
            type="button"
            onClick={callback}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer"
          >
            Deep Inspect
          </button>
        </div>
      )}
    </div>
  );
};
