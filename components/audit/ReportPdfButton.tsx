import React, { useState } from 'react';
import { formatAuDate } from '../../utils/formatAuDate';

interface ReportPdfButtonProps {
  markdownText: string;
  domain?: string;
  clientName?: string;
}

/** PDF of the report on screen, using the existing executive report renderer. */
export const ReportPdfButton: React.FC<ReportPdfButtonProps> = ({ markdownText, domain, clientName }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (busy || !markdownText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { downloadExecutiveReportPdf } = await import('../pdf/pdfService');
      const name = clientName?.trim() || domain || 'Report';
      await downloadExecutiveReportPdf({
        agencyName: 'Luminara Suite',
        clientName: name,
        targetDomain: domain,
        preparedBy: 'Luminara Suite',
        markdownText,
        auditDate: formatAuDate(new Date()),
      });
    } catch {
      setError('PDF export failed. Try again.');
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
        className="px-4 py-1.5 rounded-lg glass-morphism border border-white/10 text-xs text-gray-300 hover:text-white uppercase tracking-wider font-bold transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:opacity-50"
      >
        {busy ? 'Preparing PDF...' : 'Download PDF'}
      </button>
      {error && <span role="alert" className="text-xs text-gold-light">{error}</span>}
    </span>
  );
};
