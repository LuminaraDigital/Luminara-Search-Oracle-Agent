import React, { useEffect, useState } from 'react';
import { ICONS } from '../../constants';

interface VisibilityRadarProps {
    headers: string[];
    rows: string[][];
}

/** Pure helper: average of trailing numeric cells, or null when none measured. */
export function computeRadarAverage(rows: string[][]): number | null {
    let total = 0;
    let count = 0;
    for (const row of rows) {
        const scoreStr = row[row.length - 1]?.replace(/[^0-9]/g, '');
        const val = parseInt(scoreStr || '', 10);
        if (!Number.isNaN(val)) {
            total += val;
            count++;
        }
    }
    if (count === 0) return null;
    return Math.round(total / count);
}

export function parseRadarItemScore(raw: string | undefined): number | null {
    const digits = raw?.replace(/[^0-9]/g, '') || '';
    if (!digits) return null;
    const val = parseInt(digits, 10);
    return Number.isNaN(val) ? null : val;
}

export const VisibilityRadar: React.FC<VisibilityRadarProps> = ({ headers: _headers, rows }) => {
    const [scanActive, setScanActive] = useState(true);
    const [score, setScore] = useState<number | null>(null);
    const measuredAvg = computeRadarAverage(rows);

    useEffect(() => {
        if (measuredAvg === null) {
            setScore(null);
            setScanActive(false);
            return;
        }

        const duration = 1200;
        const startTime = performance.now();
        let rafId = 0;
        setScanActive(true);

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);

            setScore(Math.floor(measuredAvg * easeOutQuart));

            if (progress < 1) {
                rafId = requestAnimationFrame(animate);
            } else {
                setScanActive(false);
            }
        };

        rafId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafId);
    }, [rows, measuredAvg]);

    const displayScore = score;
    const ringOffset = displayScore === null ? 100 : 100 - displayScore;

    return (
        <div className="my-8 rounded-2xl border border-gold/25 bg-black/60 overflow-hidden shadow-xl relative animate-in fade-in duration-700">
            {scanActive && (
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-gold/10 to-transparent z-0 animate-pulse"></div>
            )}

            <div className="bg-gradient-to-r from-gold/15 via-black to-transparent px-6 py-4 border-b border-gold/20 flex items-center justify-between relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
                        <ICONS.Radar className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold tracking-tight text-gold-light">AI and search visibility</h3>
                        <p className="text-[11px] font-mono text-gray-400">
                          {measuredAvg === null ? 'No measured scores in this table' : 'Measured from report evidence'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">
                          {measuredAvg === null ? 'Status' : 'Blended authority'}
                        </div>
                        <div className="text-2xl font-semibold font-mono text-gold-light">
                            {displayScore === null ? 'not_measured' : `${displayScore}/100`}
                        </div>
                    </div>
                    <div className="w-12 h-12 rounded-full border border-gold/30 relative flex items-center justify-center bg-black/40">
                        <svg className="absolute inset-0 -rotate-90 w-full h-full p-1" aria-hidden="true">
                            <circle cx="20" cy="20" r="16" stroke="rgba(255,255,255,0.1)" strokeWidth="3" fill="transparent" />
                            <circle
                                cx="20"
                                cy="20"
                                r="16"
                                stroke="#BF953F"
                                strokeWidth="3"
                                fill="transparent"
                                strokeDasharray={100}
                                strokeDashoffset={ringOffset}
                                className="transition-all duration-1000 ease-out"
                            />
                        </svg>
                    </div>
                </div>
            </div>

            <div className="p-6 grid gap-4 relative z-10">
                {rows.map((row, idx) => {
                    const query = row[0]?.replace(/[*_`]/g, '') || 'Query';
                    const intent = row[1]?.replace(/[*_`]/g, '') || 'General';
                    const mentioned = row[2]?.toLowerCase().includes('yes');
                    const competitors = row[3]?.replace(/[*_`]/g, '') || 'None';
                    const organicRank = row[4]?.replace(/[*_`]/g, '') || '-';
                    const aiOverview = row[6]?.toLowerCase().includes('yes') || row[6]?.toLowerCase().includes('active');
                    const itemScore = parseRadarItemScore(row[7]);

                    return (
                        <div
                            key={idx}
                            className="rounded-xl border border-white/8 hover:border-gold/35 p-4 transition-all duration-300 hover:bg-white/[0.02] bg-black/40"
                        >
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-full bg-gold/10 border border-gold/30 text-[9px] font-semibold tracking-wide text-gold-light">
                                        {intent}
                                    </span>
                                    <span className="text-sm font-semibold text-white tracking-tight">"{query}"</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-gray-500">Radar score:</span>
                                    <span className="text-xs font-mono font-bold text-gold-light bg-black/60 px-2 py-0.5 rounded border border-gold/20">
                                        {itemScore === null ? 'not_measured' : `${itemScore}%`}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-white/5">
                                <div>
                                    <span className="block text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Brand quoted</span>
                                    <span className={`inline-flex items-center gap-1 font-bold ${mentioned ? 'text-success-400' : 'text-warning-400'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${mentioned ? 'bg-success-400' : 'bg-warning-400'}`}></span>
                                        {mentioned ? 'Verified cited' : 'Opportunity gap'}
                                    </span>
                                </div>
                                <div>
                                    <span className="block text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Organic rank</span>
                                    <span className="font-mono text-gray-200">{organicRank}</span>
                                </div>
                                <div>
                                    <span className="block text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">AI engine status</span>
                                    <span className={`font-medium ${aiOverview ? 'text-gold-light' : 'text-gray-400'}`}>
                                        {aiOverview ? 'AI Overview active' : 'Traditional SERP'}
                                    </span>
                                </div>
                                <div>
                                    <span className="block text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Top rival citations</span>
                                    <span className="text-gray-300 truncate block" title={competitors}>{competitors}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
