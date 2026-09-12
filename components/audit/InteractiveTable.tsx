import React, { useState } from 'react';
import { ICONS } from '../../constants';
import { parseInlineFormatting } from './HighlightedText';
import { MetricModal } from './MetricModal';

// Interactive table with clickable sparklines
export const InteractiveTable: React.FC<{ headers: string[]; rows: string[][] }> = ({ headers, rows }) => {
  const [selectedCell, setSelectedCell] = useState<{ header: string; value: string; entity: string } | null>(null);

  return (
    <>
      <div className="my-6 glass-morphism rounded-xl border border-white/10 overflow-hidden shadow-2xl">
        <div className="bg-white/[0.02] px-4 py-2 border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light flex items-center gap-1.5">
            <ICONS.ChartBar className="w-3.5 h-3.5" /> Interactive Matrix Analysis
          </span>
          <span className="text-[9px] text-gray-500 uppercase tracking-widest">Click cells to inspect trends</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-black/60 border-b border-white/10 text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                {headers.map((h, i) => (
                  <th key={i} className="px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-sans">
              {rows.map((row, rIdx) => {
                const entityName = row[0];
                return (
                  <tr key={rIdx} className="hover:bg-white/[0.03] transition-colors group">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        onClick={() => setSelectedCell({
                          header: headers[cIdx] || 'Metric',
                          value: cell.replace(/[*_`]/g, ''),
                          entity: (entityName ?? '').replace(/[*_`]/g, '')
                        })}
                        className={`px-4 py-3 align-top cursor-pointer transition-colors ${
                          cIdx === 0 ? 'font-bold text-white' : 'text-gray-300 hover:text-gold-light hover:bg-white/[0.02]'
                        }`}
                        title="Click to analyze trend"
                      >
                        {parseInlineFormatting(cell)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <MetricModal isOpen={!!selectedCell} onClose={() => setSelectedCell(null)} data={selectedCell} />
    </>
  );
};
