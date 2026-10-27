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
  llmsPresent: boolean;
}

/**
 * "Your homepage in search" inside the free check result: the snippet the page writes, then one
 * line per field with the free tool that fixes it. Labeled as read from the page, never as what
 * Google shows (Google stays Not measured in the engine row above).
 */
export const HomepageSnippetResult: React.FC<HomepageSnippetResultProps> = ({ page, pageReason, llmsPresent }) => {
  if (!page) {
    return (
      <div className="mt-5 border-t border-[var(--color-rule)] pt-4">
        <p className="lx-eyebrow">Your homepage in search</p>
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

  return (
    <div className="mt-5 border-t border-[var(--color-rule)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="lx-eyebrow">Your homepage in search</p>
        <p className="inline-flex items-center gap-1.5 text-[12px] text-gold-light">
          <EvidenceGlyph state="Measured" />
          Read from your homepage
        </p>
      </div>
      <div className="mt-3">
        <SerpResultCard
          url={page.finalUrl}
          title={page.title ?? ''}
          description={page.description ?? ''}
          label="Your homepage as a Google result, estimated from its tags"
        />
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-2)]">
        As your page writes it. Google can rewrite titles and snippets, so this is not a reading of Google.
      </p>
      <ul className="mt-4 m-0 list-none space-y-2 p-0">
        {snippetChecks(page, llmsPresent).map((check) => (
          <li key={check.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span
              className={`w-12 shrink-0 text-xs font-medium ${
                check.state === 'ok' ? 'text-[var(--color-ink-2)]' : 'text-[var(--gold-light)]'
              }`}
            >
              {STATE_TEXT[check.state]}
            </span>
            <span className="text-[var(--color-ink)]">{check.label}:</span>
            <span className="text-[var(--color-ink-2)]">{check.text}</span>
            {check.fixPath && (
              <a href={check.fixPath} className="lx-link text-xs">
                Fix it free
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
