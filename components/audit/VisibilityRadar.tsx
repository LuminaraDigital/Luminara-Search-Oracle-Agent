import React from 'react';
import { ICONS } from '../../constants';
import type { EmpiricalCitationSummary } from '../../services/audit/empiricalCitationService';
import { groundCustomerReport, NOT_MEASURED, parseAuditReport, type GroundFacts } from '../../services/audit/reportBlocks';

interface VisibilityRadarProps {
    headers: string[];
    rows: string[][];
    /** Per-query readings from the same search evidence as the preview label. */
    evidence?: ReadonlyArray<{ query: string; brandCited: boolean }>;
}

function normQuery(value: string): string {
    return value.toLowerCase().replace(/["“”']/g, '').replace(/\s+/g, ' ').trim();
}

const WRAP_QUOTE = /["“”']/;

/** One quote pair around the query. A matched wrap is removed first. Quotes inside the query stay. */
export function quotedQuery(query: string): string {
    let text = query.trim();
    while (text.length >= 2 && WRAP_QUOTE.test(text[0]) && WRAP_QUOTE.test(text[text.length - 1])) {
        const next = text.slice(1, -1).trim();
        if (!next) break;
        text = next;
    }
    if (/["“”]/.test(text)) return text;
    return `"${text}"`;
}

export type RadarCitationRow = {
    query: string;
    competitors: string;
    status: RadarStatus;
};

const NOT_A_RIVAL = /^(?:not measured|none|n\/a|unknown|-)$/i;

/** Rival names from one radar cell. Empty, "Not measured", and "None" are not names. */
export function rivalNames(cell: string): string[] {
    const text = plain(cell);
    if (!text || NOT_A_RIVAL.test(text)) return [];
    return text.split(/,|\band\b/i).map((part) => part.trim()).filter((part) => part && !NOT_A_RIVAL.test(part));
}

/**
 * The same query, rival, and citation rows the visibility radar draws.
 * Evidence overrides a row only when that query was actually measured.
 */
export function radarCitationRows(
    markdown: string,
    evidence?: ReadonlyArray<{ query: string; brandCited: boolean }>,
): RadarCitationRow[] {
    const doc = parseAuditReport(markdown);
    const section = doc.sections.find((item) => /visibility radar/i.test(item.title));
    const table = section?.blocks.find((block) => block.kind === 'table');
    if (!table || table.kind !== 'table') return [];
    const queryCol = columnIndex(table.headers, /query/i, 0);
    const competitorsCol = columnIndex(table.headers, /competitor/i, 3);
    const statusCol = columnIndex(table.headers, /status/i, 4);
    return table.rows.map((row) => {
        const query = plain(row[queryCol]) || 'Query';
        const hit = evidence?.find((item) => normQuery(item.query) === normQuery(query));
        const status: RadarStatus = hit ? (hit.brandCited ? 'cited' : 'not_cited') : readCitationStatus(row[statusCol]);
        return { query, competitors: rivalNames(row[competitorsCol] || '').join(', '), status };
    });
}

/** The radar rows after the report is grounded. The radar cards and Who gets named both read this. */
export function renderedRadarRows(markdown: string, facts: GroundFacts): RadarCitationRow[] {
    const shown = facts.domain ? groundCustomerReport(markdown, facts) : markdown;
    const evidence = (facts.evidence || []).flatMap((row) => (
        typeof row.brandCited === 'boolean' ? [{ query: row.query, brandCited: row.brandCited }] : []
    ));
    return radarCitationRows(shown, evidence.length ? evidence : undefined);
}

export type MentionTally = { mentioned: number; total: number };

function wholePair(mentioned: number | undefined, total: number | undefined): MentionTally | null {
    if (typeof mentioned !== 'number' || typeof total !== 'number') return null;
    if (!Number.isInteger(mentioned) || !Number.isInteger(total)) return null;
    if (total <= 0 || mentioned < 0 || mentioned > total) return null;
    return { mentioned, total };
}

/**
 * One count for the radar rows (queries) and one for the search rows (web results).
 * A row that was not measured is not counted as a miss.
 */
export function mentionCounts(input: {
    radarRows: ReadonlyArray<{ status: RadarStatus }>;
    webResultsMentioned?: number;
    webResultsTotal?: number;
}): { queries: MentionTally | null; webResults: MentionTally | null } {
    const measured = input.radarRows.filter((row) => row.status === 'cited' || row.status === 'not_cited');
    const queries = measured.length
        ? { mentioned: measured.filter((row) => row.status === 'cited').length, total: measured.length }
        : null;
    return { queries, webResults: wholePair(input.webResultsMentioned, input.webResultsTotal) };
}

export function mentionLabel(tally: MentionTally, unit: 'queries' | 'web results'): string {
    return `mentioned in ${tally.mentioned} of ${tally.total} ${unit}`;
}

/** Header for the rows on screen, including rows that were not measured. */
export function radarRowCaption(rows: ReadonlyArray<{ status: RadarStatus }>): string | null {
    if (!rows.length) return null;
    const cited = rows.filter((row) => row.status === 'cited').length;
    const notMeasured = rows.filter((row) => row.status === 'not_measured').length;
    const unit = rows.length === 1 ? 'query' : 'queries';
    const line = `cited in ${cited} of ${rows.length} ${unit}`;
    return notMeasured ? `${line}, ${notMeasured} not measured` : line;
}

/** One citation sentence for the verdict. Web results win. Otherwise the radar rows. */
export function verdictCitationLine(input: {
    radarRows: ReadonlyArray<{ status: RadarStatus }>;
    webResultsMentioned?: number;
    webResultsTotal?: number;
}): string | null {
    const counts = mentionCounts(input);
    if (counts.webResults) return `The brand is ${mentionLabel(counts.webResults, 'web results')}.`;
    const caption = radarRowCaption(input.radarRows);
    return caption ? `The brand is ${caption}.` : null;
}

/**
 * The preview label and the radar share mentionCounts.
 * Web results label the search rows. Queries label the radar rows.
 */
export function citationView(
    markdown: string,
    summary: EmpiricalCitationSummary | undefined,
): { label: string | null; evidence: Array<{ query: string; brandCited: boolean }> | null } {
    if (!summary || summary.measurementStatus === 'not_measured') return { label: null, evidence: null };
    const evidence = summary.evidenceList || [];
    const radar = radarCitationRows(markdown, evidence);
    const counts = mentionCounts({
        radarRows: radar,
        webResultsMentioned: summary.webResultsMentioned,
        webResultsTotal: summary.webResultsTotal,
    });
    const label = counts.webResults
        ? mentionLabel(counts.webResults, 'web results')
        : counts.queries
            ? mentionLabel(counts.queries, 'queries')
            : null;
    if (!label) return { label: null, evidence: null };
    return { label, evidence: evidence.length ? evidence : null };
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
    not_measured: NOT_MEASURED,
};

/** A measured row with no rival name prints "None". "Not measured" is only for a row the search did not run. */
function rivalCitationLabel(cell: unknown, status: RadarStatus): string {
    const names = rivalNames(plain(cell));
    if (names.length) return names.join(', ');
    return status === 'not_measured' ? NOT_MEASURED : 'None';
}

/**
 * Draws the report's visibility table as cards.
 * It shows what the table says and nothing else: no score is worked out from the
 * cells, and a cell that does not give a reading prints "Not measured".
 */
export const VisibilityRadar: React.FC<VisibilityRadarProps> = ({ headers, rows, evidence }) => {
    const queryCol = columnIndex(headers, /query/i, 0);
    const intentCol = columnIndex(headers, /intent/i, 1);
    const citedCol = columnIndex(headers, /brand cited/i, 2);
    const competitorsCol = columnIndex(headers, /competitor/i, 3);
    const statusCol = columnIndex(headers, /status/i, 4);
    const statuses = rows.map((row) => {
        const query = plain(row[queryCol]) || 'Query';
        const hit = evidence?.find((item) => normQuery(item.query) === normQuery(query));
        return hit ? (hit.brandCited ? 'cited' : 'not_cited') : readCitationStatus(row[statusCol]);
    });
    const queries = radarRowCaption(statuses.map((status) => ({ status })));

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
                        {queries ? <p className="text-[11px] font-mono text-gray-400">{queries}</p> : null}
                    </div>
                </div>
            </div>

            <div className="p-6 grid gap-4 relative z-10">
                {rows.map((row, idx) => {
                    const query = plain(row[queryCol]) || 'Query';
                    const intent = plain(row[intentCol]);
                    const hit = evidence?.find((item) => normQuery(item.query) === normQuery(query));
                    const cited = hit ? (hit.brandCited ? 'yes' : 'no') : readBrandCited(row[citedCol]);
                    const statusKey: RadarStatus = hit ? (hit.brandCited ? 'cited' : 'not_cited') : readCitationStatus(row[statusCol]);
                    const competitors = rivalCitationLabel(row[competitorsCol], statusKey);
                    const status = STATUS_TEXT[statusKey];

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
                                    <span className="text-sm font-semibold text-white tracking-tight">{quotedQuery(query)}</span>
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
                                        {cited === 'yes' ? 'Cited (estimated)' : cited === 'no' ? 'Opportunity gap' : NOT_MEASURED}
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
