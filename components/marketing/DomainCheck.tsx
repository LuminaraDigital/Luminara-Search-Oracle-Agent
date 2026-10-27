/* Landing domain check: one input, one button, an honest inline result.
 * Runs the anonymous live check (homepage head, robots.txt, llms.txt) on this page, keeps the
 * engines labeled Not measured, then hands off to the full audit.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useDemoPlayback } from './demo/useDemoPlayback';
import { normalizeDemoUrl, visibleProbeHost } from './demo/demoFixtures';
import { EngineStatusChip } from './EvidenceGlyph';
import { HomepageSnippetResult } from './HomepageSnippetResult';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import type { AuditHandoff } from '../../services/activation/auditHandoff';
import { GUEST_FULL_AUDIT_CTA } from '../../services/audit/hostedScoutRail';
import { checkPathForHost } from '../../services/marketing/homepageSnippet';

interface DomainCheckProps {
  inputId: string;
  isAuthenticated?: boolean;
  /** Guests go to sign-up with the handoff; signed-in users go straight to the audit. */
  onFullAudit: (handoff?: AuditHandoff) => void;
  /** Where the check ran, for `probe_completed`. */
  surface?: string;
  /** From a /check/<host> link: run the check on this host once, on first render. */
  autoRunHost?: string | null;
}

export const DomainCheck: React.FC<DomainCheckProps> = ({
  inputId,
  isAuthenticated,
  onFullAudit,
  surface = 'landing_inline',
  autoRunHost = null,
}) => {
  const demo = useDemoPlayback();
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = demo.phase === 'analyzing';

  useEffect(() => {
    if (running) setLinkCopied(false);
  }, [running]);

  // Runs once per host. No "already ran" flag: a remount (React StrictMode in development)
  // cancels the first run in useDemoPlayback's cleanup, and this effect must start it again.
  useEffect(() => {
    if (autoRunHost) demo.runSample(autoRunHost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunHost]);

  const copyCheckLink = (domain: string) => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(`${window.location.origin}${checkPathForHost(domain)}`)
      .then(() => {
        setLinkCopied(true);
        productTelemetry.track('share_clicked', { channel: 'check_link', surface });
      })
      .catch(() => undefined);
  };

  // Count a check only once it has finished, with how it ended.
  useEffect(() => {
    if (demo.phase !== 'results_sample' || !demo.fixture) return;
    productTelemetry.track('probe_completed', {
      domain: demo.fixture.domain,
      focus: 'AEO',
      surface,
      resultKind: demo.resultKind,
    });
  }, [demo.phase, demo.fixture, demo.resultKind, surface]);

  const handoffFor = (raw: string): AuditHandoff | undefined => {
    const parsed = normalizeDemoUrl(raw);
    return parsed.ok ? { url: parsed.host, focus: 'AEO', sampleSource: false } : undefined;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (running) return;
    const parsed = normalizeDemoUrl(demo.url);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    demo.runSample();
  };

  const showResult = running || demo.phase === 'results_sample';
  const crawl = demo.engines.find((r) => r.id === 'crawl_readiness');
  const engines = demo.engines.filter((r) => r.id !== 'crawl_readiness');
  const host = demo.fixture?.domain ?? demo.url;
  const message = error || demo.error;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form onSubmit={submit} noValidate className="lx-domain">
        <label htmlFor={inputId} className="sr-only">
          Your website
        </label>
        <span aria-hidden className="hidden sm:inline pl-4 pr-1 text-sm text-[var(--color-ink-2)] select-none">
          https://
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={visibleProbeHost(demo.url)}
          readOnly={running}
          onChange={(e) => {
            demo.setUrl(visibleProbeHost(e.target.value));
            if (error) setError(null);
          }}
          placeholder="yoursite.com"
          aria-invalid={Boolean(message)}
          aria-describedby={message ? `${inputId}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent pl-4 sm:pl-0 pr-2 py-3 text-base text-[var(--color-ink)] placeholder:text-ink/45 focus:outline-none"
        />
        <button
          type="submit"
          aria-disabled={running}
          className={`lx-btn lx-btn-gold shrink-0 ${running ? 'cursor-progress opacity-70' : ''}`}
        >
          {running ? 'Checking...' : 'Check my site'}
        </button>
      </form>

      {message && (
        <p id={`${inputId}-error`} role="alert" className="mt-3 text-sm text-[var(--gold-light)]">
          {message}
        </p>
      )}

      {showResult && (
        <div aria-live="polite" className="lx-glass mt-4 rounded-2xl p-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-[var(--color-ink)]">
              <span className="text-[var(--color-ink-2)]">{running ? 'Checking ' : 'Results for '}</span>
              <span className="font-medium">{host}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                demo.reset();
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded-full px-2.5 py-1 text-xs text-[var(--color-ink-2)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
            >
              Close
            </button>
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 list-none m-0 p-0">
            {crawl && (
              <li className="col-span-2 sm:col-span-1 min-w-0">
                <p className="text-[13px] text-[var(--color-ink)]">Crawl access</p>
                <EngineStatusChip status={crawl.status} />
              </li>
            )}
            {engines.map((row) => (
              <li key={row.id} className="min-w-0">
                <p className="truncate text-[13px] text-[var(--color-ink)]">{row.label}</p>
                <EngineStatusChip status={row.status} />
              </li>
            ))}
          </ul>

          {running && demo.stageLabel && (
            <p className="mt-4 text-sm text-[var(--color-ink-2)]">{demo.stageLabel}</p>
          )}

          {demo.fixture && demo.resultKind === 'live_crawl' && demo.fixture.page !== undefined && (
            <HomepageSnippetResult
              page={demo.fixture.page}
              pageReason={demo.fixture.pageReason ?? null}
              llmsPresent={Boolean(demo.fixture.llmsPresent)}
            />
          )}

          {demo.fixture && (
            <div className="mt-5 border-t border-[var(--color-rule)] pt-4">
              <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
                {demo.resultKind === 'live_crawl'
                  ? crawl?.note
                  : 'We could not reach the site for a live crawl just now. Try again, or run the full audit.'}
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  onClick={() => onFullAudit(handoffFor(demo.fixture?.domain || demo.url))}
                  className="lx-btn lx-btn-gold"
                >
                  {isAuthenticated ? 'Run the full audit' : GUEST_FULL_AUDIT_CTA}
                </button>
                {demo.resultKind === 'live_crawl' && (
                  <button
                    type="button"
                    onClick={() => copyCheckLink(demo.fixture?.domain || '')}
                    className="lx-link text-sm"
                  >
                    {linkCopied ? 'Link copied' : 'Copy link to this check'}
                  </button>
                )}
                {!isAuthenticated && (
                  <span className="text-xs text-[var(--color-ink-2)]">Hosted engines stay off until you sign in or add your own keys.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
