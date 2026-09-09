import React, { useState } from 'react';
import { ICONS } from '../../constants';
import type { WritingIssue, WritingIssueCategory, WritingQualityReport } from '../../services/audit/writingQualityService';

interface WritingQualityCardProps {
  report: WritingQualityReport;
}

const CATEGORY_LABEL: Record<WritingIssueCategory, string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  style: 'Style',
  clarity: 'Clarity',
  other: 'Other',
};

const CATEGORY_ORDER: WritingIssueCategory[] = ['spelling', 'grammar', 'clarity', 'style', 'other'];

function gradeColor(grade: WritingQualityReport['grade']): string {
  switch (grade) {
    case 'Excellent':
    case 'Good':
      return 'text-success-300';
    case 'Needs work':
      return 'text-warning-300';
    case 'Poor':
    default:
      return 'text-danger-300';
  }
}

function gradeBadge(grade: WritingQualityReport['grade']): string {
  switch (grade) {
    case 'Excellent':
    case 'Good':
      return 'bg-success-500/15 text-success-300 border-success-500/30';
    case 'Needs work':
      return 'bg-warning-500/15 text-warning-300 border-warning-500/30';
    case 'Poor':
    default:
      return 'bg-danger-500/15 text-danger-300 border-danger-500/30';
  }
}

const openSettings = () => window.dispatchEvent(new CustomEvent('luminara-open-settings'));

const IssueLine: React.FC<{ issue: WritingIssue }> = ({ issue }) => (
  <li className="text-xs text-gray-300 leading-snug">
    <span>{issue.message}</span>
    {issue.snippet && (
      <span className="block mt-0.5 font-mono text-[11px] text-gray-500 truncate" title={issue.snippet}>
        {issue.snippet}
      </span>
    )}
    {issue.suggestion && (
      <span className="block mt-0.5 text-[11px] text-gold-light">Try: {issue.suggestion}</span>
    )}
  </li>
);

export const WritingQualityCard: React.FC<WritingQualityCardProps> = ({ report }) => {
  const [showAll, setShowAll] = useState(false);

  const topIssues = report.issues.slice(0, 3);
  const extraCount = Math.max(0, report.issues.length - topIssues.length);

  const grouped = CATEGORY_ORDER
    .map(cat => ({ cat, items: report.issues.filter(i => i.category === cat) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
            <ICONS.FileText className="w-5 h-5 text-gold-light" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">How your page reads</h3>
            <p className="text-xs text-gray-400">
              {report.readability.label} &middot; about {report.wordCount.toLocaleString()} words
            </p>
          </div>
        </div>

        <div className="flex items-baseline gap-2 shrink-0">
          <span className={`text-3xl font-black font-mono ${gradeColor(report.grade)}`}>{report.score}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${gradeBadge(report.grade)}`}>
            {report.grade}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="pt-4 flex-1">
        {report.issues.length === 0 ? (
          report.available ? (
            <p className="text-xs text-success-300 flex items-center gap-1.5">
              <ICONS.CheckCircle className="w-4 h-4 shrink-0" />
              No wording problems found.
            </p>
          ) : null
        ) : (
          <>
            <p className="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-2">Top fixes</p>
            <ul className="space-y-2.5">
              {topIssues.map(issue => <IssueLine key={issue.id} issue={issue} />)}
            </ul>

            {extraCount > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowAll(v => !v)}
                  aria-expanded={showAll}
                  className="text-[11px] font-bold text-gold-light hover:underline flex items-center gap-1"
                >
                  {showAll ? 'Show fewer' : `Show all ${report.issues.length.toLocaleString()}`}
                  <ICONS.ChevronDown className={`w-3 h-3 transition-transform ${showAll ? 'rotate-180' : ''}`} />
                </button>

                {showAll && (
                  <div className="mt-3 space-y-3 max-h-72 overflow-y-auto pr-1">
                    {grouped.map(g => (
                      <div key={g.cat}>
                        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1.5">
                          {CATEGORY_LABEL[g.cat]} ({g.items.length.toLocaleString()})
                        </p>
                        <ul className="space-y-2 pl-2 border-l border-white/10">
                          {g.items.map(issue => <IssueLine key={issue.id} issue={issue} />)}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!report.available && (
          <p className="mt-3 text-[11px] text-gray-500 flex flex-wrap items-center gap-x-1.5">
            <span>Grammar check not connected &mdash; showing readability only.</span>
            <button type="button" onClick={openSettings} className="text-gold-light hover:underline font-bold">
              Set up
            </button>
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-gray-400 leading-snug">
        {report.aiAnswerNote}
      </div>
    </div>
  );
};
