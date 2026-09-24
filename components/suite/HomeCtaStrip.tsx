import React from 'react';
import { AppView } from '../../types';
import { ICONS } from '../../constants';
import {
  HOME_CTA_HEADING,
  HOME_CTA_PRIMARY_LABEL,
  HOME_CTA_SECONDARY_LABEL,
  HOME_CTA_SUB,
} from './homeCtaStripLogic';

interface HomeCtaStripProps {
  onNavigate: (view: AppView) => void;
}

/**
 * Zero-audit home banner: shown at the top of the dashboard only when the
 * user has no saved audits. Renders nothing otherwise (decision is made by
 * the caller via shouldShowHomeCta; this component assumes it should render).
 */
export const HomeCtaStrip: React.FC<HomeCtaStripProps> = ({ onNavigate }) => {
  return (
    <section
      aria-label={HOME_CTA_HEADING}
      className="mb-10 glass-morphism rounded-2xl border border-gold/40 p-6 bg-black/60 shadow-2xl relative overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-gold/10 to-transparent" aria-hidden="true" />
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-gold/10 border border-gold/30 text-gold-light shrink-0" aria-hidden="true">
            <ICONS.Radar className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white mb-1">{HOME_CTA_HEADING}</h2>
            <p className="text-xs text-gray-400 leading-relaxed max-w-xl">{HOME_CTA_SUB}</p>
          </div>
        </div>
        <div className="flex flex-col sm:items-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate(AppView.INSTANT_AUDIT)}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black text-[11px] font-black uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-md shadow-gold/10 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            {HOME_CTA_PRIMARY_LABEL}
          </button>
          <button
            type="button"
            onClick={() => onNavigate(AppView.BUSINESS_DNA)}
            className="text-[10px] font-bold uppercase tracking-wider text-gold-light hover:text-gold transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded"
          >
            {HOME_CTA_SECONDARY_LABEL}
          </button>
        </div>
      </div>
    </section>
  );
};
