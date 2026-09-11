import React, { useState, useEffect } from 'react';
import { ICONS } from '../../constants';

interface WhiteLabelExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  markdownText: string;
  targetDomain?: string;
  dnaName?: string;
}

const STORAGE_KEY_AGENCY = 'luminara_whitelabel_config';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const WhiteLabelExportModal: React.FC<WhiteLabelExportModalProps> = ({
  isOpen,
  onClose,
  markdownText,
  targetDomain,
  dnaName,
}) => {
  const [agencyName, setAgencyName] = useState('Apex Growth Partners');
  const [agencyLogoUrl, setAgencyLogoUrl] = useState('');
  const [clientName, setClientName] = useState(dnaName || targetDomain || 'Strategic Client');
  const [preparedBy, setPreparedBy] = useState('AI Strategy Practice');
  const [executiveNotes, setExecutiveNotes] = useState('Prepared exclusively for executive leadership. Priority remediation recommended within 14 days.');
  const [primaryColor, setPrimaryColor] = useState('#BF953F');
  const [savedLocally, setSavedLocally] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_AGENCY) || '{}');
      if (saved.agencyName) setAgencyName(saved.agencyName);
      if (saved.agencyLogoUrl) setAgencyLogoUrl(saved.agencyLogoUrl);
      if (saved.preparedBy) setPreparedBy(saved.preparedBy);
      if (saved.primaryColor) setPrimaryColor(saved.primaryColor);
    } catch {
      // ignore
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveBrand = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY_AGENCY,
        JSON.stringify({ agencyName, agencyLogoUrl, preparedBy, primaryColor })
      );
      setSavedLocally(true);
      setTimeout(() => setSavedLocally(false), 2000);
    } catch (e) {
      console.warn('Failed to save agency brand', e);
    }
  };

  const handleDownloadPdf = async () => {
    handleSaveBrand();
    setIsExportingPdf(true);
    setExportError(null);
    try {
      const { downloadExecutiveReportPdf } = await import('../pdf/pdfService');
      await downloadExecutiveReportPdf({
        agencyName,
        agencyLogoUrl: agencyLogoUrl || undefined,
        clientName,
        targetDomain,
        preparedBy,
        executiveNotes,
        primaryColor,
        markdownText,
      });
    } catch (err: any) {
      console.error('Failed to generate PDF:', err);
      setExportError(
        err?.message || 'Failed to render PDF client-side. You can still use Print / Browser Dialog below.'
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handlePrintPdf = () => {
    handleSaveBrand();

    // Create a printable iframe or print document
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print executive PDF report.');
      return;
    }

    const safeAgency = escapeHtml(agencyName);
    const safeClient = escapeHtml(clientName);
    const safePreparedBy = escapeHtml(preparedBy);
    const safeNotes = escapeHtml(executiveNotes);
    const safeDomain = escapeHtml(targetDomain || 'Target Entity');
    const safeMarkdown = escapeHtml(markdownText);
    const safeColor = /^#[0-9A-Fa-f]{3,8}$/.test(primaryColor) ? primaryColor : '#BF953F';
    const safeLogo =
      agencyLogoUrl && /^https:\/\/[^\s"'<>]+$/i.test(agencyLogoUrl.trim())
        ? escapeHtml(agencyLogoUrl.trim())
        : '';

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeAgency} - Strategic AEO Brief for ${safeClient}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #111827;
      background: #ffffff;
      line-height: 1.6;
      padding: 40px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid ${safeColor};
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .agency-name {
      font-size: 24px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.02em;
    }
    .meta-box {
      text-align: right;
      font-size: 12px;
      color: #6b7280;
    }
    .client-title {
      font-size: 28px;
      font-weight: 800;
      color: #000;
      margin-bottom: 8px;
    }
    .notes-banner {
      background: #f9fafb;
      border-left: 4px solid ${safeColor};
      padding: 14px 18px;
      margin: 20px 0 32px;
      font-size: 13px;
      color: #374151;
      border-radius: 4px;
    }
    .report-body {
      font-size: 13px;
      color: #1f2937;
    }
    .report-body h1, .report-body h2 {
      color: #111827;
      margin-top: 28px;
      margin-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
    }
    .report-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 12px;
    }
    .report-body th, .report-body td {
      border: 1px solid #e5e7eb;
      padding: 8px 12px;
      text-align: left;
    }
    .report-body th {
      background: #f3f4f6;
      font-weight: 700;
    }
    .report-body pre {
      background: #111827;
      color: #10b981;
      padding: 14px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      margin: 16px 0;
    }
    .footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #9ca3af;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      ${safeLogo ? `<img src="${safeLogo}" alt="${safeAgency}" style="max-height: 48px; margin-bottom: 8px;" />` : ''}
      <div class="agency-name">${safeAgency}</div>
      <div style="font-size: 12px; color: #6b7280;">${safePreparedBy}</div>
    </div>
    <div class="meta-box">
      <div><strong>Target:</strong> ${safeClient}</div>
      <div><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      <div><strong>Confidentiality:</strong> STRICT PRIVILEGE</div>
    </div>
  </div>

  <div class="client-title">AEO & Search Intelligence Audit</div>
  <div style="font-size: 14px; color: #4b5563;">Prepared exclusively for ${safeClient} (${safeDomain})</div>

  <div class="notes-banner">
    <strong>Executive Strategic Context:</strong> ${safeNotes}
  </div>

  <div class="report-body">
    <pre style="white-space: pre-wrap; font-family: inherit; background: transparent; color: inherit; padding: 0;">${safeMarkdown}</pre>
  </div>

  <div class="footer">
    <div>Generated via ${safeAgency} Enterprise Intelligence Practice</div>
    <div>Page 1 &bull; Strictly Confidential</div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 500);
    };
  </script>
</body>
</html>
`;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleDownloadMarkdown = () => {
    const header = `# ${agencyName} - Strategic AEO Intelligence Brief\n**Client:** ${clientName}\n**Date:** ${new Date().toISOString().split('T')[0]}\n**Prepared by:** ${preparedBy}\n\n> Executive Note: ${executiveNotes}\n\n---\n\n`;
    const blob = new Blob([header + markdownText], { type: 'text/markdown' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = `${clientName.replace(/\s+/g, '_')}_AEO_Brief.md`;
    a.click();
    URL.revokeObjectURL(u);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl glass-morphism rounded-2xl border border-gold/40 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden bg-black/95">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gold/10 border border-gold/30 text-gold-light">
              <ICONS.Download className="w-5 h-5 text-gold-light" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                White-Label Agency PDF Export
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gold/20 text-gold-light border border-gold/30">
                  Client Deliverable
                </span>
              </h3>
              <p className="text-xs text-gray-400">
                Brand this executive report with your agency styling and unbranded layout.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ICONS.X className="w-5 h-5" />
          </button>
        </div>

        {/* Branding Configuration Inputs */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                Your Agency / Firm Name
              </label>
              <input
                type="text"
                value={agencyName}
                onChange={(e) => setAgencyName(e.target.value)}
                placeholder="e.g. Apex Growth Partners"
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                Client Organization Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                Practice / Prepared By
              </label>
              <input
                type="text"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                placeholder="e.g. AI Strategy & Search Practice"
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                Agency Logo URL (Optional)
              </label>
              <input
                type="text"
                value={agencyLogoUrl}
                onChange={(e) => setAgencyLogoUrl(e.target.value)}
                placeholder="https://youragency.com/logo.png"
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
              Custom Executive Brief Note / Callout
            </label>
            <textarea
              rows={2}
              value={executiveNotes}
              onChange={(e) => setExecutiveNotes(e.target.value)}
              placeholder="Custom advisory note for the client..."
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none leading-relaxed"
            />
          </div>

          {/* Quick Preview Badge */}
          <div className="p-4 rounded-xl border border-white/10 glass-morphism space-y-2">
            <span className="text-[10px] font-mono uppercase text-gray-400 block tracking-wider">
              Deliverable Preview
            </span>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">{agencyName}</span>
              <span className="text-gold-light font-mono">Deliverable for {clientName}</span>
            </div>
            <p className="text-[11px] text-gray-400 italic">
              &ldquo;{executiveNotes}&rdquo;
            </p>
          </div>

          {exportError && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-200 text-xs flex items-center gap-2">
              <ICONS.AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-white/10 bg-black/70">
          <button
            onClick={handleSaveBrand}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 transition-colors"
          >
            {savedLocally ? <ICONS.Check className="w-3.5 h-3.5 text-success-400" /> : <ICONS.Shield className="w-3.5 h-3.5" />}
            <span>{savedLocally ? 'Branding Saved' : 'Save Default Agency Settings'}</span>
          </button>

          <div className="flex flex-wrap items-center justify-end gap-2.5 w-full sm:w-auto">
            <button
              onClick={handleDownloadMarkdown}
              className="px-3.5 py-2 rounded-xl glass-morphism border border-white/10 text-xs font-bold text-gray-300 hover:text-white uppercase tracking-wider transition-colors"
            >
              Markdown
            </button>
            <button
              onClick={handlePrintPdf}
              title="Open browser print dialog"
              className="px-3.5 py-2 rounded-xl border border-white/20 text-xs font-bold text-gray-300 hover:text-white hover:bg-white/5 uppercase tracking-wider transition-colors"
            >
              Print Dialog
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-black uppercase text-xs tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gold/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isExportingPdf ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>Rendering PDF...</span>
                </>
              ) : (
                <>
                  <ICONS.Download className="w-4 h-4" />
                  <span>Export Executive PDF</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
