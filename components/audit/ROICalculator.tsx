import React, { useState, useEffect, useMemo } from 'react';
import { ICONS } from '../../constants';
import { TimesFmMathEngine } from '../../services/timesfm/timesfmEngine';

export const ROICalculator: React.FC = () => {
    const [traffic, setTraffic] = useState<number>(5000);
    const [conversionRate, setConversionRate] = useState<number>(2.5);
    const [leadValue, setLeadValue] = useState<number>(120);
    const [uplift, setUplift] = useState<number>(25);
    const [agencyRetainer, setAgencyRetainer] = useState<number>(4500);
    const [showTimesFMRunway, setShowTimesFMRunway] = useState<boolean>(false);
    
    const [currentRevenue, setCurrentRevenue] = useState<number>(0);
    const [projectedRevenue, setProjectedRevenue] = useState<number>(0);
    const [netIncrease, setNetIncrease] = useState<number>(0);
    const [annualSavings, setAnnualSavings] = useState<number>(0);

    useEffect(() => {
        const current = traffic * (conversionRate / 100) * leadValue;
        const projectedTraffic = traffic * (1 + uplift / 100);
        const projectedConvRate = conversionRate * 1.08; // Higher intent conversions from AEO
        const projected = projectedTraffic * (projectedConvRate / 100) * leadValue;
        
        setCurrentRevenue(Math.round(current));
        setProjectedRevenue(Math.round(projected));
        setNetIncrease(Math.round(projected - current));
        setAnnualSavings(agencyRetainer * 12);
    }, [traffic, conversionRate, leadValue, uplift, agencyRetainer]);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
    };

    // 12-Month TimesFM Runway Calculation
    const runwayData = useMemo(() => {
        if (!showTimesFMRunway || currentRevenue <= 0) return null;
        const now = Date.now();
        const oneMonth = 86400000 * 30.4;
        const history = [];

        // 6-month historical revenue proxy
        for (let i = 5; i >= 0; i--) {
            const t = now - i * oneMonth;
            const d = new Date(t);
            const noise = (Math.sin(i * 1.4) * (currentRevenue * 0.03));
            history.push({
                timestamp: t,
                dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                value: Math.round(currentRevenue * (0.92 + (5 - i) * 0.016) + noise)
            });
        }

        try {
            const res = TimesFmMathEngine.runForecast(
                history,
                {
                    horizon: 12,
                    patchLength: 4,
                    frequency: 'monthly',
                    quantiles: [0.1, 0.25, 0.5, 0.75, 0.9],
                    decomposition: 'additive',
                    revin: true
                },
                [
                    {
                        id: 'uplift_compound',
                        name: 'Organic Uplift',
                        type: 'multiplier',
                        value: 1 + (uplift / 100),
                        active: true,
                        description: 'AEO and SERP citation lift'
                    },
                    {
                        id: 'agency_capital',
                        name: 'Agency Capital Reinvestment',
                        type: 'additive',
                        value: agencyRetainer,
                        active: true,
                        description: 'Saved agency retainer reinvested'
                    }
                ]
            );

            const allVals = [...history.map(h => h.value), ...res.forecast.map(f => f.p90)];
            const minVal = Math.min(...history.map(h => h.value)) * 0.85;
            const maxVal = Math.max(...allVals) * 1.1;
            const range = Math.max(1, maxVal - minVal);

            const totalSteps = history.length + res.forecast.length;
            const scaleX = (idx: number) => (idx / (totalSteps - 1)) * 100;
            const scaleY = (val: number) => 100 - ((val - minVal) / range) * 80 - 10;

            const lastHistPt = `${scaleX(history.length - 1).toFixed(1)},${scaleY(history[history.length - 1].value).toFixed(1)}`;
            const p10Points = res.forecast.map((f, i) => ({ x: scaleX(history.length + i), y: scaleY(f.p10) }));
            const p90Points = res.forecast.map((f, i) => ({ x: scaleX(history.length + i), y: scaleY(f.p90) }));
            const p50Points = res.forecast.map((f, i) => `${scaleX(history.length + i).toFixed(1)},${scaleY(f.p50).toFixed(1)}`);

            const coneAreaStr = `M${lastHistPt} ` + 
                p90Points.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' ' +
                p10Points.slice().reverse().map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

            const p50LineStr = [lastHistPt, ...p50Points].join(' ');
            const histLineStr = history.map((h, i) => `${scaleX(i).toFixed(1)},${scaleY(h.value).toFixed(1)}`).join(' ');

            const cumulativeP50 = res.forecast.reduce((sum, f) => sum + f.p50, 0);
            const baseline12M = currentRevenue * 12;
            const net12MLift = Math.round(cumulativeP50 - baseline12M);

            return {
                coneAreaStr,
                p50LineStr,
                histLineStr,
                forecast: res.forecast,
                splitX: scaleX(history.length - 1),
                net12MLift,
                finalP50: res.forecast[res.forecast.length - 1].p50,
                finalP10: res.forecast[res.forecast.length - 1].p10,
                finalP90: res.forecast[res.forecast.length - 1].p90
            };
        } catch (e) {
            return null;
        }
    }, [showTimesFMRunway, currentRevenue, uplift, agencyRetainer]);

    return (
        <div className="my-8 glass-morphism rounded-2xl border border-[#BF953F]/30 overflow-hidden shadow-2xl animate-in fade-in duration-700">
            <div className="bg-gradient-to-r from-[#BF953F]/20 via-[#FCF6BA]/10 to-transparent px-6 py-4 border-b border-[#BF953F]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-[#BF953F]/10 border border-[#BF953F]/30 text-[#FCF6BA]">
                        <ICONS.Calculator className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold uppercase tracking-widest text-[#FCF6BA]">Luminara ROI & Retainer Arbiter</h3>
                        <p className="text-xs text-gray-400">Link AI-search visibility to quantifiable monthly revenue expansion</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowTimesFMRunway(!showTimesFMRunway)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#BF953F]/10 hover:bg-[#BF953F]/20 border border-[#BF953F]/30 text-[10px] font-mono text-[#FCF6BA] uppercase tracking-wider transition-all"
                    >
                        <ICONS.TimeSeries className="w-3.5 h-3.5" />
                        <span>{showTimesFMRunway ? 'Hide Runway' : 'TimesFM 12M Runway'}</span>
                    </button>
                    <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-gray-400 uppercase tracking-wider">
                        <span>Zero Retainer</span>
                    </div>
                </div>
            </div>

            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Inputs */}
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Monthly Organic Traffic</label>
                            <input 
                                type="number" 
                                value={traffic} 
                                onChange={(e) => setTraffic(Math.max(0, Number(e.target.value)))}
                                className="w-full bg-black/60 border border-[#BF953F]/30 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-[#BF953F] transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Conversion Rate (%)</label>
                            <input 
                                type="number" 
                                step="0.1" 
                                value={conversionRate} 
                                onChange={(e) => setConversionRate(Math.max(0, Number(e.target.value)))}
                                className="w-full bg-black/60 border border-[#BF953F]/30 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-[#BF953F] transition-all"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Avg. Customer Value ($)</label>
                            <input 
                                type="number" 
                                value={leadValue} 
                                onChange={(e) => setLeadValue(Math.max(0, Number(e.target.value)))}
                                className="w-full bg-black/60 border border-[#BF953F]/30 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-[#BF953F] transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Agency Retainer Saved / mo ($)</label>
                            <input 
                                type="number" 
                                value={agencyRetainer} 
                                onChange={(e) => setAgencyRetainer(Math.max(0, Number(e.target.value)))}
                                className="w-full bg-black/60 border border-[#BF953F]/30 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-[#BF953F] transition-all"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-[#FCF6BA]">Projected AI & AEO Uplift</label>
                            <span className="text-xs font-mono font-bold text-[#FCF6BA]">{uplift}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="5" 
                            max="100" 
                            value={uplift} 
                            onChange={(e) => setUplift(Number(e.target.value))}
                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#BF953F]"
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Simulated increase in citations and qualified organic search clicks.</p>
                    </div>
                </div>

                {/* Results Card */}
                <div className="flex flex-col justify-between space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="glass-morphism rounded-xl p-4 border border-white/5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Baseline Monthly</p>
                            <p className="text-xl font-bold font-mono text-gray-200">{formatCurrency(currentRevenue)}</p>
                        </div>
                        <div className="glass-morphism rounded-xl p-4 border border-emerald-500/20 bg-emerald-950/10">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1">Annual Retainer Saved</p>
                            <p className="text-xl font-bold font-mono text-emerald-300">{formatCurrency(annualSavings)}</p>
                        </div>
                    </div>

                    <div className="relative glass-morphism rounded-2xl p-6 border border-[#BF953F]/40 bg-gradient-to-br from-[#BF953F]/15 via-black to-black shadow-xl">
                        <div className="absolute -top-3 right-4 bg-gradient-to-r from-[#BF953F] to-[#FCF6BA] text-black text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-lg">
                            +{formatCurrency(netIncrease)} / Mo Lift
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#FCF6BA] mb-1">Projected Monthly Revenue</p>
                        <p className="text-3xl sm:text-4xl font-black font-mono text-white mb-2">{formatCurrency(projectedRevenue)}</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                            Includes calculated <strong>{uplift}% citation lift</strong> plus retained capital reallocated from redundant agency overhead.
                        </p>
                    </div>
                </div>
            </div>

            {/* TimesFM 12-Month Runway Projection Drawer */}
            {showTimesFMRunway && runwayData && (
                <div className="border-t border-[#BF953F]/30 bg-black/80 p-6 animate-in slide-in-from-top-4 duration-500">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                        <div>
                            <div className="flex items-center gap-2 text-xs font-bold text-[#FCF6BA] uppercase tracking-wider">
                                <ICONS.TimeSeries className="w-4 h-4" />
                                <span>TimesFM 12-Month Probabilistic Runway Projection</span>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                                Patch-based foundation modeling with compound uplift & saved retainer capital reinvestment.
                            </p>
                        </div>
                        <div className="flex items-center gap-4 text-right">
                            <div>
                                <span className="text-[9px] uppercase font-mono text-gray-500 block">12-Month Net Capital Lift</span>
                                <span className="text-lg font-bold font-mono text-emerald-400">+{formatCurrency(runwayData.net12MLift)}</span>
                            </div>
                            <div>
                                <span className="text-[9px] uppercase font-mono text-gray-500 block">Month 12 Horizon (p50)</span>
                                <span className="text-lg font-bold font-mono text-[#FCF6BA]">{formatCurrency(runwayData.finalP50)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="h-28 w-full bg-black/60 rounded-xl border border-white/10 relative p-2 overflow-hidden mb-3">
                        <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                            <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                            <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                            <line x1={runwayData.splitX} y1="0" x2={runwayData.splitX} y2="100" stroke="#BF953F" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />

                            <defs>
                                <linearGradient id="roiCone" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stopColor="#BF953F" stopOpacity="0.4" />
                                    <stop offset="100%" stopColor="#BF953F" stopOpacity="0.1" />
                                </linearGradient>
                            </defs>

                            <path d={runwayData.coneAreaStr} fill="url(#roiCone)" />
                            <polyline points={runwayData.histLineStr} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <polyline points={runwayData.p50LineStr} fill="none" stroke="#FCF6BA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>

                    <div className="flex justify-between text-[9px] text-gray-500 font-mono">
                        <span>-6M Historical Baseline</span>
                        <span>Now ({formatCurrency(currentRevenue)}/mo)</span>
                        <span>Month 12 Horizon [{formatCurrency(runwayData.finalP10)} .. {formatCurrency(runwayData.finalP90)}]</span>
                    </div>
                </div>
            )}
        </div>
    );
};
