import React from 'react';
import type { ExecutiveReportData } from './ExecutiveReportDocument';
import { ExecutiveReportDocument } from './ExecutiveReportDocument';

/**
 * Renders the Executive Report Document to raw PDF bytes using Forme's WASM engine.
 * Lazily loads @formepdf/core to keep initial page bundle small.
 */
export async function generateExecutiveReportPdfBytes(
  data: ExecutiveReportData
): Promise<Uint8Array> {
  // Dynamically import to ensure code-splitting in Vite/Rollup
  let renderDocFn: typeof import('@formepdf/core/browser').renderDocument;

  try {
    const browserModule = await import('@formepdf/core/browser');
    renderDocFn = browserModule.renderDocument;
  } catch {
    // Fallback if imported in a non-browser / node testing environment
    const coreModule = await import('@formepdf/core');
    renderDocFn = coreModule.renderDocument;
  }

  const documentElement = React.createElement(ExecutiveReportDocument, data);
  const pdfBytes = await renderDocFn(documentElement);
  return pdfBytes;
}

/**
 * Client-side helper to render and immediately trigger a browser download for the PDF.
 */
export async function downloadExecutiveReportPdf(
  data: ExecutiveReportData,
  suggestedFilename?: string
): Promise<void> {
  const pdfBytes = await generateExecutiveReportPdfBytes(data);
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);

  const cleanClient = (data.clientName || 'Executive').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = suggestedFilename || `${cleanClient}_AEO_Executive_Brief.pdf`;

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up object URL after brief delay to allow browser download initiation
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}
