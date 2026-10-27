import React from 'react';
import { EvidenceGlyph } from './EvidenceGlyph';
import { SerpResultCard } from './SerpResultCard';
import {
  HOMEPAGE_FAILURE_TEXT,
  snippetChecks,
  type HomepageHead,
  type HomepageReadFailure,
  type SnippetCheckState,
} from '../../services/marketing/homepageSnippet';

const STATE_TEXT: Record<SnippetCheckState, string> = { ok: 'OK', fix: 'Fix', warn: 'Check' };

interface HomepageSnippetResultProps {
  page: HomepageHead | null;
  pageReason: HomepageReadFailure | null;
  /** ISO time of the read; a cached result shows its original time. */
  checkedAt?: string;
}

function readTime(checkedAt?: string): string | null {
  if (!checkedAt) return null;
  const at = new Date(checkedAt);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * "What your homepage tells Google" in the free check result: the page's own tags (Measured as
 * page facts), an Estimated preview of the result they make, then one line per field with the free
 * tool that writes the fix. Google itself is never read here and stays Not measured.
 */
export const HomepageSnippetResult: React.FC<HomepageSnippetResultProps> = ({ page, pageReason, checkedAt }) => {
  if (!page) {
    return (
      <div className="border-b border-[var(--color-rule)] pb-4">
        <p className="lx-eyebrow">What your homepage tells Google</p>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-[var(--color-ink-2)]">
          <span className="mt-[0.4em]">
            <EvidenceGlyph state="Not measured" />
          </span>
          <span>
            Not measured. {pageReason ? HOMEPAGE_FAILURE_TEXT[pageReason] : HOMEPAGE_FAILURE_TEXT.unreachable}
          </span>
        </p>
      </div>
    );
  }

  const time = readTime(checkedAt);
  // On a phone, show the mobile result Google would show there: it wraps the title instead of cutting it.
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches;
  return (
    <div className="border-b border-[var(--color-rule)] pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="lx-eyebrow">What your homepage tells Google</p>
        <p className="inline-flex items-center gap-1.5 text-[12px] text-gold-light">
          <EvidenceGlyph state="Measured" />
          Measured · read from your homepage{time ? ` at ${time}` : ''}
        </p>
      </div>
      <div className="mt-3">
        <p className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-2)]">
          <EvidenceGlyph state="Estimated" />
          Estimated preview
        </p>
        <SerpResultCard
          url={page.finalUrl}
          title={page.title ?? ''}
          description={page.description ?? ''}
          device={narrow ? 'mobile' : 'desktop'}
          label="Estimated Google result from your homepage tags"
        />
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-2)]">
        Google can rewrite titles and snippets, so your real result may differ. We did not check Google.
      </p>
      <ul className="mt-4 m-0 list-none space-y-2 p-0">
        {snippetChecks(page, narrow ? 'mobile' : 'desktop').map((check) => (
          <li key={check.id} className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-2 text-sm">
            <span
              className={`text-xs font-medium ${
                check.state === 'fix' || check.state === 'warn' ? 'text-[var(--gold-light)]' : 'text-[var(--color-ink-2)]'
              }`}
            >
              {STATE_TEXT[check.state]}
            </span>
            <span className="min-w-0">
              <span className="text-[var(--color-ink)]">{check.label}:</span>{' '}
              <span className="text-[var(--color-ink-2)]">{check.text}</span>{' '}
              {check.fixPath && (
                <a
                  href={check.fixPath}
                  className="lx-link whitespace-nowrap text-xs"
                  aria-label={`Write the fix (free): ${check.label.toLowerCase()}`}
                >
                  Write the fix (free)
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
