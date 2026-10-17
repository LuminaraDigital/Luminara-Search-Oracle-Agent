import React, { useState } from 'react';
import { ICONS } from '../../constants';

/** Pure arithmetic on the user's own inputs. No hidden multipliers, no synthetic history. */
export const computeRoi = (traffic: number, conversionRatePct: number, leadValue: number, upliftPct: number) => {
    const current = Math.round(traffic * (conversionRatePct / 100) * leadValue);
    const projected = Math.round(traffic * (1 + upliftPct / 100) * (conversionRatePct / 100) * leadValue);
    return { current, projected, net: projected - current };
};

const inputClass = 'w-full bg-black/60 border border-gold/30 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-gold transition-all';
const labelClass = 'block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5';

export const ROICalculator: React.FC = () => {
    const [traffic, setTraffic] = useState<number>(5000);
    const [conversionRate, setConversionRate] = useState<number>(2.5);
    const [leadValue, setLeadValue] = useState<number>(120);
    const [uplift, setUplift] = useState<number>(25);

    const { current, projected, net } = computeRoi(traffic, conversionRate, leadValue, uplift);
    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="my-8 glass-morphism rounded-2xl border border-gold/30 overflow-hidden shadow-2xl animate-in fade-in duration-700">
            <div className="bg-gradient-to-r from-gold/20 via-gold-light/10 to-transparent px-6 py-4 border-b border-gold/20 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
                    <ICONS.Calculator className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-base font-bold uppercase tracking-widest text-gold-light">ROI Calculator</h3>
                    <p className="text-xs text-gray-400">Illustrative estimate from your inputs. Not a measured or forecast result.</p>
                </div>
            </div>

            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Inputs */}
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>Monthly Organic Traffic</label>
                            <input type="number" value={traffic} onChange={(e) => setTraffic(Math.max(0, Number(e.target.value)))} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>Conversion Rate (%)</label>
                            <input type="number" step="0.1" value={conversionRate} onChange={(e) => setConversionRate(Math.max(0, Number(e.target.value)))} className={inputClass} />
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>Avg. Customer Value ($)</label>
                        <input type="number" value={leadValue} onChange={(e) => setLeadValue(Math.max(0, Number(e.target.value)))} className={inputClass} />
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-gold-light">Assumed Traffic Uplift</label>
                            <span className="text-xs font-mono font-bold text-gold-light">{uplift}%</span>
                        </div>
                        <input
                            type="range"
                            min="5"
                            max="100"
                            value={uplift}
                            onChange={(e) => setUplift(Number(e.target.value))}
                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-gold"
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Your assumption. Conversion rate is held constant.</p>
                    </div>
                </div>

                {/* Results Card */}
                <div className="flex flex-col justify-between space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="glass-morphism rounded-xl p-4 border border-white/5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Baseline Monthly</p>
                            <p className="text-xl font-bold font-mono text-gray-200">{formatCurrency(current)}</p>
                        </div>
                        <div className="glass-morphism rounded-xl p-4 border border-white/5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Net Monthly Uplift</p>
                            <p className="text-xl font-bold font-mono text-gray-200">{formatCurrency(net)}</p>
                        </div>
                    </div>

                    <div className="relative glass-morphism rounded-2xl p-6 border border-gold/40 bg-gradient-to-br from-gold/15 via-black to-black shadow-xl">
                        <div className="absolute -top-3 right-4 bg-gradient-to-r from-gold to-gold-light text-black text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-lg">
                            +{formatCurrency(net)} / Mo
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-gold-light mb-1">Estimated Monthly Revenue</p>
                        <p className="text-3xl sm:text-4xl font-black font-mono text-white mb-2">{formatCurrency(projected)}</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                            Traffic x (1 + {uplift}%) x conversion rate x customer value. Illustrative estimate from your inputs.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
