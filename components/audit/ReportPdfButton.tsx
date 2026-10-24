import React, { useState } from 'react';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { formatAuDate } from '../../utils/formatAuDate';
import { Spinner } from '../ui/Button';

interface ReportPdfButtonProps {
  markdownText: string;
  domain?: string;
  clientName?: string;
  measured?: boolean;
  findings?: ReadonlyArray<Pick<BoardFinding, 'title' | 'severity' | 'description' | 'evidence'>>;
}

/** PDF of the report on screen, using the existing executive report renderer. */
export const ReportPdfButton: React.FC<ReportPdfButtonProps> = ({
  markdownText,
  domain,
  clientName,
  measured = false,
  findings = [],
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const download = async () => {
    if (busy || !markdownText.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { downloadExecutiveReportPdf } = await import('../pdf/pdfService');
      const { withReportLead } = await import('../../services/audit/reportBlocks');
      const name = clientName?.trim() || domain || 'Report';
      await downloadExecutiveReportPdf({
        agencyName: 'Luminara Suite',
        clientName: name,
        targetDomain: domain,
        preparedBy: 'Luminara Suite',
        markdownText: withReportLead(markdownText, measured, findings),
        auditDate: formatAuDate(new Date()),
      });
      setSaved(true);
    } catch {
      setError('PDF export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        aria-busy={busy || undefined}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg glass-morphism border border-white/10 text-xs text-gray-300 hover:text-white uppercase tracking-wider font-bold transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:opacity-50"
      >
        {busy && <Spinner />}
        {busy ? 'Preparing PDF' : 'Download PDF'}
      </button>
      {saved && !busy && !error && (
        <span role="status" className="text-xs text-gray-300">PDF downloaded.</span>
      )}
      {error && (
        <span role="alert" className="inline-flex items-center gap-2 text-xs text-gold-light">
          {error}
          <button
            type="button"
            onClick={() => void download()}
            className="underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Retry
          </button>
        </span>
      )}
    </span>
  );
};
