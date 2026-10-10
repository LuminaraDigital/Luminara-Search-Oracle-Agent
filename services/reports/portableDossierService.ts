/**
 * Zero-Dependency Standalone Dossier Generator (Track OP)
 *
 * Compiles audit and citation intelligence into a self-contained, editorial HTML document.
 * Zero external scripts, zero CDN fonts, zero tracking pixels.
 * Supports auto-generated sticky TOC, system themes, print CSS, and a content fingerprint line.
 * Inspired by the Odysseus visual report generator (`src/visual_report.py`).
 *
 * Invariant: No em dashes (U+2014) in copy or code comments. Use '-', ':', or '.'.
 * Invariant: the dossier prints no score, grade or badge that a check did not produce.
 * A missing score renders "Not measured". The fingerprint is a checksum, not a signature.
 */

import { fastHash } from '../audit/evidenceLedgerService';

export interface DossierSection {
  id: string;
  title: string;
  badge?: string;
  contentHtml: string;
}

export interface PortableDossierData {
  title: string;
  targetDomain: string;
  /** A 0-100 score that a check in this audit measured. Null or omitted renders "Not measured". */
  overallScore?: number | null;
  generatedAt: number;
  /** Short non-cryptographic checksum of the report text. Omitted: the line is left out. */
  contentFingerprint?: string;
  sections: DossierSection[];
}

/** What the audit report screen has when a founder downloads the dossier. */
export interface AuditDossierInput {
  domain: string;
  markdownText: string;
  generatedAt: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Builds an editorial, self-contained HTML page from structured dossier data.
 */
export function generatePortableDossierHtml(data: PortableDossierData): string {
  const formattedDate = new Date(data.generatedAt).toUTCString();
  const safeTitle = escapeHtml(data.title);
  const safeDomain = escapeHtml(data.targetDomain);
  const scoreText =
    typeof data.overallScore === 'number' && Number.isFinite(data.overallScore)
      ? `${data.overallScore}/100`
      : 'Not measured';
  const fingerprintBlock = data.contentFingerprint
    ? `
        <div style="margin-top: 1rem;">
          <div style="font-size: 0.75rem; color: var(--text-secondary);">Content fingerprint (a short checksum of the report text, not a signature):</div>
          <div class="content-fingerprint">${escapeHtml(data.contentFingerprint)}</div>
        </div>`
    : '';

  // Generate Table of Contents items
  const tocItems = data.sections
    .map(
      sec => `<li><a href="#${escapeHtml(sec.id)}">${escapeHtml(sec.title)}</a></li>`
    )
    .join('\n');

  // Generate Sections
  const sectionBlocks = data.sections
    .map(sec => {
      const badgeHtml = sec.badge
        ? `<span class="section-badge">${escapeHtml(sec.badge)}</span>`
        : '';
      return `
      <section id="${escapeHtml(sec.id)}" class="card">
        <div class="card-header">
          <h2>${escapeHtml(sec.title)}</h2>
          ${badgeHtml}
        </div>
        <div class="card-body">
          ${sec.contentHtml}
        </div>
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} - Luminara Executive Dossier</title>
  <style>
    :root {
      --bg: #090d16;
      --surface: #111827;
      --surface-border: #1f2937;
      --text-primary: #f9fafb;
      --text-secondary: #9ca3af;
      --accent: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.15);
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --card-radius: 10px;
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --surface: #ffffff;
        --surface-border: #e2e8f0;
        --text-primary: #0f172a;
        --text-secondary: #64748b;
        --accent: #2563eb;
        --accent-glow: rgba(37, 99, 235, 0.1);
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background-color: var(--bg);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem 1rem;
    }

    .container {
      max-width: 1080px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 2rem;
    }

    aside.sidebar {
      position: sticky;
      top: 2rem;
      height: fit-content;
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--card-radius);
      padding: 1.25rem;
    }

    .brand-title {
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
      font-weight: 700;
      margin-bottom: 0.75rem;
    }

    .toc-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-size: 0.9rem;
    }

    .toc-list a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.2s;
    }

    .toc-list a:hover {
      color: var(--text-primary);
    }

    .hero-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--card-radius);
      padding: 1.75rem;
      margin-bottom: 1.5rem;
    }

    .hero-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--surface-border);
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    .score-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 0.9rem;
      background: var(--accent-glow);
      color: var(--accent);
      border: 1px solid var(--accent);
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--card-radius);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--surface-border);
    }

    .card-header h2 {
      font-size: 1.25rem;
    }

    .section-badge {
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: var(--surface-border);
      color: var(--text-secondary);
    }

    .content-fingerprint {
      font-family: monospace;
      font-size: 0.75rem;
      background: var(--bg);
      padding: 0.5rem;
      border-radius: 6px;
      border: 1px solid var(--surface-border);
      word-break: break-all;
      margin-top: 0.5rem;
    }

    @media (max-width: 800px) {
      .container { grid-template-columns: 1fr; }
      aside.sidebar { position: static; margin-bottom: 1rem; }
    }

    @media print {
      body { background: #fff; color: #000; padding: 0; }
      .container { display: block; max-width: 100%; }
      aside.sidebar { display: none; }
      .card, .hero-card { border: 1px solid #ddd; margin-bottom: 1rem; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <aside class="sidebar">
      <div class="brand-title">Luminara Suite</div>
      <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem;">
        Executive Audit Dossier
      </p>
      <ul class="toc-list">
        ${tocItems}
      </ul>
      <div style="margin-top: 2rem; font-size: 0.75rem; color: var(--text-secondary);">
        Self-contained report. Zero external dependencies.
      </div>
    </aside>

    <main class="content">
      <div class="hero-card">
        <h1>${safeTitle}</h1>
        <p style="color: var(--text-secondary); margin-top: 0.5rem;">Target Entity: <strong>${safeDomain}</strong></p>
        <div class="hero-meta">
          <div>
            <span>Score: </span>
            <span class="score-badge">${scoreText}</span>
          </div>
          <div>${formattedDate}</div>
        </div>${fingerprintBlock}
      </div>

      ${sectionBlocks}
    </main>
  </div>
</body>
</html>`;
}

/**
 * Builds the dossier a founder downloads from an audit report.
 * The report carries no measured overall score, so the score line says "Not measured".
 * The section has no badge: nothing checked the text after the model wrote it.
 */
export function buildAuditDossierHtml(input: AuditDossierInput): string {
  const text = input.markdownText || '';
  return generatePortableDossierHtml({
    title: `${input.domain} Executive AEO Dossier`,
    targetDomain: input.domain,
    overallScore: null,
    generatedAt: input.generatedAt,
    // fastHash repeats one 16-character value four times. Print it once.
    contentFingerprint: fastHash(text || input.domain).slice(0, 16),
    sections: [
      {
        id: 'executive-summary',
        title: 'Executive Audit Analysis',
        contentHtml: `<div style="white-space: pre-wrap; font-size: 0.95rem; line-height: 1.7;">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
      },
    ],
  });
}
