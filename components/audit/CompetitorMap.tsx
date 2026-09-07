import React from 'react';
import { ICONS } from '../../constants';

interface CompetitorMapProps {
    headers: string[];
    rows: string[][];
}

export const CompetitorMap: React.FC<CompetitorMapProps> = ({ headers, rows }) => {
    return (
        <div className="my-8 glass-morphism rounded-2xl border border-[#BF953F]/30 overflow-hidden shadow-2xl animate-in fade-in duration-700">
            <div className="bg-gradient-to-r from-[#BF953F]/20 via-black to-transparent px-6 py-4 border-b border-[#BF953F]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-[#BF953F]/10 border border-[#BF953F]/30 text-[#FCF6BA]">
                        <ICONS.Shield className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold uppercase tracking-widest text-[#FCF6BA]">Competitor Reality Map</h3>
                        <p className="text-[11px] font-mono text-gray-400">ENTITY PROFILE & STRATEGIC CONTENT GAP ANALYSIS</p>
                    </div>
                </div>
                <div className="hidden sm:block text-[10px] font-mono text-[#FCF6BA]/80 uppercase tracking-wider">
                    Grounding Matrix
                </div>
            </div>

            <div className="p-4 md:p-6 grid gap-4">
                {rows.map((row, idx) => {
                    const entity = row[0]?.replace(/[*_`]/g, '') || 'Market Entity';
                    const perception = row[1]?.replace(/[*_`]/g, '') || 'Neutral visibility';
                    const topPages = row[2]?.replace(/[*_`]/g, '') || 'Homepage, Case Studies';
                    const contentAdvantage = row[3]?.replace(/[*_`]/g, '') || 'None identified';
                    const trustStrength = row[4]?.replace(/[*_`]/g, '').toLowerCase() || 'medium';
                    const isUser = idx === 0;

                    return (
                        <div 
                            key={idx} 
                            className={`relative rounded-xl border p-5 transition-all duration-300 ${
                                isUser 
                                    ? 'glass-morphism border-[#BF953F]/60 bg-[#BF953F]/5 shadow-[0_0_25px_rgba(191,149,63,0.1)]' 
                                    : 'glass-morphism border-white/5 hover:border-white/20'
                            }`}
                        >
                            {isUser && (
                                <div className="absolute top-0 right-0 bg-gradient-to-l from-[#BF953F] to-[#AA771C] text-black text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-xl rounded-tr-xl shadow-md">
                                    TARGET BRAND
                                </div>
                            )}

                            <div className="flex flex-col lg:flex-row gap-6">
                                {/* Entity Profile */}
                                <div className="flex-1 min-w-[200px]">
                                    <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${isUser ? 'bg-[#FCF6BA] shadow-[0_0_8px_#FCF6BA]' : 'bg-gray-500'}`}></span>
                                        {entity}
                                    </h4>
                                    <div className="mb-3">
                                        <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest mb-1">AI Entity Perception</p>
                                        <p className="text-xs text-gray-300 italic leading-relaxed">"{perception}"</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest mb-1">Top Cited Asset Types</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {topPages.split(',').map((page, pIdx) => (
                                                <span key={pIdx} className="bg-black/60 text-gray-300 text-[10px] font-mono px-2 py-0.5 rounded border border-white/10">
                                                    {page.trim()}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Content Advantage Column */}
                                <div className="flex-1 border-t lg:border-t-0 lg:border-l border-white/5 lg:pl-6 pt-4 lg:pt-0">
                                    <div className="flex items-center gap-2 mb-2">
                                        <ICONS.Sparkle className="w-3.5 h-3.5 text-[#FCF6BA]" />
                                        <span className="text-[10px] font-bold text-[#FCF6BA] uppercase tracking-wider">Content Citation Advantage</span>
                                    </div>
                                    <div className="bg-black/40 rounded-xl p-3 border border-white/5 text-xs text-gray-300 leading-relaxed">
                                        {contentAdvantage}
                                    </div>
                                </div>

                                {/* Trust Signal Strength */}
                                <div className="lg:w-44 border-t lg:border-t-0 lg:border-l border-white/5 lg:pl-6 pt-4 lg:pt-0 flex flex-col justify-between">
                                    <div>
                                        <span className="block text-[9px] uppercase tracking-widest text-gray-500 mb-1">Trust Signal Strength</span>
                                        <span className={`text-xs font-bold uppercase tracking-wider ${
                                            trustStrength.includes('high') ? 'text-emerald-400' :
                                            trustStrength.includes('med') ? 'text-[#FCF6BA]' : 'text-gray-400'
                                        }`}>
                                            {trustStrength}
                                        </span>
                                    </div>
                                    <div className="w-full bg-white/5 rounded-full h-1.5 mt-2 overflow-hidden border border-white/5">
                                        <div 
                                            className={`h-full rounded-full ${
                                                trustStrength.includes('high') ? 'w-full bg-emerald-500' :
                                                trustStrength.includes('med') ? 'w-2/3 bg-[#BF953F]' : 'w-1/3 bg-gray-600'
                                            }`}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
