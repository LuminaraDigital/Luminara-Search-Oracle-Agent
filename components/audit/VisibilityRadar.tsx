import React from 'react';
import { ICONS } from '../../constants';

interface VisibilityRadarProps {
    headers: string[];
    rows: string[][];
}

/**
 * Index of the column whose header matches, or -1 when the table does not carry it.
 * A table that came with no headers at all is read by the report's own column order.
 */
function columnIndex(headers: string[], pattern: RegExp, position: number): number {
    if (headers.length === 0) return position;
    return headers.findIndex((header) => pattern.test(String(header)));
}

function plain(cell: unknown): string {
    return String(cell ?? '').replace(/[*_`]/g, '').trim();
}

export type RadarReading = 'yes' | 'no' | 'not_measured';

/**
 * Reads the "Brand Cited" cell. Only a plain yes or no counts.
 * "not measured", "not verified", an empty cell and anything else read as not measured.
 */
export function readBrandCited(cell: unknown): RadarReading {
    const text = plain(cell).toLowerCase();
    if (/^(yes|cited)\b/.test(text)) return 'yes';
    if (/^(no|not cited)\b/.test(text)) return 'no';
    return 'not_measured';
}

export type RadarStatus = 'cited' | 'not_cited' | 'not_measured';

/**
 * Reads the "Citation Status" cell. The column has three values: Cited, Not Cited,
 * Not Measured. The cell is read for the one it starts with and nothing after it is
 * shown, so "Cited, rank #3, AI Overview active" reads as cited and prints "Cited".
 */
export function readCitationStatus(cell: unknown): RadarStatus {
    const text = plain(cell).toLowerCase();
    if (/^cited\b/.test(text)) return 'cited';
    if (/^not cited\b/.test(text)) return 'not_cited';
    return 'not_measured';
}

const STATUS_TEXT: Record<RadarStatus, string> = {
    cited: 'Cited',
    not_cited: 'Not cited',
    not_measured: 'Not measured',
};

/**
 * Draws the report's visibility table as cards.
 * It shows what the table says and nothing else: no score is worked out from the
 * cells, and a cell that does not give a reading prints "Not measured".
 */
export const VisibilityRadar: React.FC<VisibilityRadarProps> = ({ headers, rows }) => {
    const queryCol = columnIndex(headers, /query/i, 0);
    const intentCol = columnIndex(headers, /intent/i, 1);
    const citedCol = columnIndex(headers, /brand cited/i, 2);
    const competitorsCol = columnIndex(headers, /competitor/i, 3);
    const statusCol = columnIndex(headers, /status/i, 4);

    return (
        <div className="my-8 rounded-2xl border border-gold/25 bg-black/60 overflow-hidden shadow-xl relative animate-in fade-in duration-700">
            <div className="bg-gradient-to-r from-gold/15 via-black to-transparent px-6 py-4 border-b border-gold/20 flex items-center justify-between relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
                        <ICONS.Radar className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold tracking-tight text-gold-light">AI and search visibility</h3>
                        <p className="text-[11px] font-mono text-gray-400">As written in the report table. Not a score.</p>
                    </div>
                </div>
            </div>

            <div className="p-6 grid gap-4 relative z-10">
                {rows.map((row, idx) => {
                    const query = plain(row[queryCol]) || 'Query';
                    const intent = plain(row[intentCol]);
                    const cited = readBrandCited(row[citedCol]);
                    const competitors = plain(row[competitorsCol]) || 'Not measured';
                    const status = STATUS_TEXT[readCitationStatus(row[statusCol])];

                    return (
                        <div
                            key={idx}
                            className="rounded-xl border border-white/8 hover:border-gold/35 p-4 transition-all duration-300 hover:bg-white/[0.02] bg-black/40"
                        >
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                                <div className="flex items-center gap-2">
                                    {intent && (
                                        <span className="px-2.5 py-0.5 rounded-full bg-gold/10 border border-gold/30 text-[9px] font-semibold tracking-wide text-gold-light">
                                            {intent}
                                        </span>
                                    )}
                                    <span className="text-sm font-semibold text-white tracking-tight">"{query}"</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-gray-500">Citation status:</span>
                                    <span className="text-xs font-mono font-bold text-gold-light bg-black/60 px-2 py-0.5 rounded border border-gold/20">
                                        {status}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-white/5">
                                <div>
                                    <span className="block text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Brand quoted</span>
                                    <span className={`inline-flex items-center gap-1 font-bold ${cited === 'yes' ? 'text-success-400' : cited === 'no' ? 'text-warning-400' : 'text-gray-400'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${cited === 'yes' ? 'bg-success-400' : cited === 'no' ? 'bg-warning-400' : 'bg-gray-500'}`}></span>
                                        {cited === 'yes' ? 'Cited (estimated)' : cited === 'no' ? 'Opportunity gap' : 'Not measured'}
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
