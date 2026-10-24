import React from 'react';
import { ICONS } from '../../constants';
import { countPhrase } from '../../services/audit/reportSentence';
import { gateReportText } from '../../services/audit/reportColumnGate';
import { displayMeasured, parseAuditReport } from '../../services/audit/reportBlocks';

interface CompetitorMapProps {
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

function rawCell(cell: unknown): string {
    return String(cell ?? '').replace(/[*_`]/g, '').replace(/\[\[|\]\]/g, '').trim();
}

/** The cell as written, or the unmeasured constant when the report left it empty. */
function cellText(cell: unknown): string {
    return displayMeasured(rawCell(cell));
}

const BLANK_CELL = /^(?:-|—|–|n\/a|none|not measured|unknown)?$/i;

/** A model placeholder, a blank name, or a disclaimer such as "(no verified rivals in this niche)". */
function placeholderCompetitor(entity: string): boolean {
    const plain = entity.replace(/\[\[|\]\]/g, '').trim();
    if (!plain || BLANK_CELL.test(plain)) return true;
    if (/^competitor\s*#?\d+$/i.test(plain)) return true;
    if (/no verified rivals/i.test(plain)) return true;
    return /^\(.*\)$/.test(plain);
}

function measuredField(cell: unknown): boolean {
    return !BLANK_CELL.test(rawCell(cell));
}

type MapColumns = { entity: number; perception: number; pages: number; advantage: number };

function mapColumns(headers: string[]): MapColumns {
    return {
        entity: columnIndex(headers, /entity|brand/i, 0),
        perception: columnIndex(headers, /perception|how ai talks/i, 1),
        pages: columnIndex(headers, /page/i, 2),
        advantage: columnIndex(headers, /advantage/i, 3),
    };
}

/** A rival row the map draws: a real name and at least one measured cell. The first row is the target. */
function shownRival(row: string[], cols: MapColumns): boolean {
    if (placeholderCompetitor(rawCell(row[cols.entity]))) return false;
    return [cols.perception, cols.pages, cols.advantage].some((col) => measuredField(row[col]));
}

/** Rival rows and measured content-advantage gaps, the same ones the map draws. */
export function renderedCompetitorCounts(headers: string[], rows: string[][]): { rivals: number; gaps: number } {
    const cols = mapColumns(headers);
    const rivals = rows.filter((row, index) => index > 0 && shownRival(row, cols));
    const gaps = rivals.filter((row) => measuredField(row[cols.advantage]));
    return { rivals: rivals.length, gaps: gaps.length };
}

/** Progress-card sentence for those counts. An empty rival list is not a zero count. */
export function competitorProgressMessage(rivals: number, gaps: number): string {
    if (rivals === 0) return 'No competitors found in this search sample.';
    return `Identified ${countPhrase(rivals, 'key competitor')} and mapped ${countPhrase(gaps, 'keyword gap')}.`;
}

/** Rival and gap counts for the competitor table, or null when that table is absent. */
export function verifiedRivalsFromReport(markdown: string): { rivals: number; gaps: number } | null {
    const doc = parseAuditReport(gateReportText(markdown || ''));
    const section = doc.sections.find((item) => /competitor/i.test(item.title));
    const table = section?.blocks.find((block) => block.kind === 'table');
    if (!table || table.kind !== 'table') return null;
    return renderedCompetitorCounts(table.headers, table.rows);
}

/** The sentence for the competitor table in a report, or null when that table is absent. */
export function competitorProgressFromReport(markdown: string): string | null {
    const counts = verifiedRivalsFromReport(markdown);
    if (!counts) return null;
    return competitorProgressMessage(counts.rivals, counts.gaps);
}

export const CompetitorMap: React.FC<CompetitorMapProps> = ({ headers, rows }) => {
    const cols = mapColumns(headers);
    const visibleRows = rows.filter((row, index) => index === 0 || shownRival(row, cols));
    const rivalCount = Math.max(visibleRows.length - 1, 0);

    return (
        <div className="my-8 glass-morphism rounded-2xl border border-gold/30 overflow-hidden shadow-2xl animate-in fade-in duration-700">
            <div className="bg-gradient-to-r from-gold/20 via-black to-transparent px-6 py-4 border-b border-gold/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
                        <ICONS.Shield className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold uppercase tracking-widest text-gold-light">Competitor Reality Map</h3>
                        <p className="text-[11px] font-mono text-gray-400">ENTITY PROFILE & STRATEGIC CONTENT GAP ANALYSIS</p>
                    </div>
                </div>
                <div className="hidden sm:block text-[10px] font-mono text-gold-light/80 uppercase tracking-wider">
                    Grounding Matrix
                </div>
            </div>

            <div className="p-4 md:p-6 grid gap-4">
                {rivalCount === 0 ? (
                    <p className="text-xs text-gray-400">No rivals found in this search sample.</p>
                ) : null}
                {visibleRows.map((row, idx) => {
                    const entity = cellText(row[cols.entity]);
                    const perception = cellText(row[cols.perception]);
                    const topPages = cellText(row[cols.pages]);
                    const contentAdvantage = cellText(row[cols.advantage]);
                    const isUser = idx === 0;

                    return (
                        <div 
                            key={idx} 
                            className={`relative rounded-xl border p-5 transition-all duration-300 ${
                                isUser 
                                    ? 'glass-morphism border-gold/60 bg-gold/5 shadow-[0_0_25px_rgba(191,149,63,0.1)]' 
                                    : 'glass-morphism border-white/5 hover:border-white/20'
                            }`}
                        >
                            {isUser && (
                                <div className="absolute top-0 right-0 bg-gradient-to-l from-gold to-gold-dark text-black text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-xl rounded-tr-xl shadow-md">
                                    TARGET BRAND
                                </div>
                            )}

                            <div className="flex flex-col lg:flex-row gap-6">
                                {/* Entity Profile */}
                                <div className="flex-1 min-w-[200px]">
                                    <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${isUser ? 'bg-gold-light shadow-[0_0_8px_#FCF6BA]' : 'bg-gray-500'}`}></span>
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
                                        <ICONS.Sparkle className="w-3.5 h-3.5 text-gold-light" />
                                        <span className="text-[10px] font-bold text-gold-light uppercase tracking-wider">Content Citation Advantage</span>
                                    </div>
                                    <div className="bg-black/40 rounded-xl p-3 border border-white/5 text-xs text-gray-300 leading-relaxed">
                                        {contentAdvantage}
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
