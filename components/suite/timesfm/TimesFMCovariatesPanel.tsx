import React from 'react';
import { ICONS } from '../../../constants';
import { TimesFmCovariate } from '../../../types';

export interface TimesFMCovariatesPanelProps {
  covariates: TimesFmCovariate[];
  onToggleCovariate: (id: string) => void;
  onUpdateCovariateValue: (id: string, val: number) => void;
}

export const TimesFMCovariatesPanel: React.FC<TimesFMCovariatesPanelProps> = ({
  covariates,
  onToggleCovariate,
  onUpdateCovariateValue,
}) => {
  return (
    <div className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/60 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-light">
          <ICONS.Sliders className="w-3.5 h-3.5" />
          <span>Exogenous Covariates</span>
        </div>
        <span className="text-[9px] font-mono text-success-400 uppercase">Scenario Alpha</span>
      </div>

      <div className="space-y-4">
        {covariates.map(cov => (
          <div key={cov.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-200 cursor-pointer flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cov.active}
                  onChange={() => onToggleCovariate(cov.id)}
                  className="w-3.5 h-3.5 accent-gold rounded cursor-pointer"
                />
                <span>{cov.name}</span>
              </label>
              <span className="text-[10px] font-mono text-gold-light">
                {cov.type === 'multiplier' ? `x${cov.value.toFixed(2)}` : `${(cov.value * 100).toFixed(0)}%`}
              </span>
            </div>

            <p className="text-[10px] text-gray-500 leading-tight">
              {cov.description}
            </p>

            {cov.active && cov.type === 'multiplier' && (
              <input
                type="range"
                min="1.05"
                max="2.00"
                step="0.05"
                value={cov.value}
                onChange={(e) => onUpdateCovariateValue(cov.id, Number(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-gold"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
