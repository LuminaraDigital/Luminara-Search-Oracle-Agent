/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5
 * Probe as tool surface: form + engine rows. No glow plate, no constellation bloom.
 */
import React, { useEffect, useRef, useState } from 'react';
import { DEMO_PRESETS, DemoEngineId, DemoFocus, DemoPhase } from './demo/demoFixtures';
import { useDemoPlayback } from './demo/useDemoPlayback';
import type { AuditHandoff } from '../../services/activation/auditHandoff';
import type { ReportFocus } from '../../types';

interface VisibilityProbeProps {
  isAuthenticated?: boolean;
  onOpenAudit: (handoff?: AuditHandoff) => void;
  /** Carries the typed domain so sign-in / sign-up can return to Instant Audit with it. */
  onSignIn: (handoff?: AuditHandoff) => void;
  onSignUp?: (handoff?: AuditHandoff) => void;
  onSeePricing: () => void;
}

const FOCI: DemoFocus[] = ['SEO', 'AEO', 'GEO'];

/** Pure phase rules for progressive disclosure (unit-tested). */
export function probeUiForPhase(phase: DemoPhase): {
  showPresets: boolean;
  showFocusTune: boolean;
  showEngineRows: boolean;
  showReveal: boolean;
  primaryAction: 'run' | 'open_audit' | 'none';
} {
  switch (phase) {
    case 'empty':
      return {
        showPresets: false,
        showFocusTune: false,
        showEngineRows: true,
        showReveal: false,
        primaryAction: 'run',
      };
    case 'typing':
      return {
        showPresets: true,
        showFocusTune: true,
        showEngineRows: true,
        showReveal: false,
        primaryAction: 'run',
      };
    case 'analyzing':
      return {
        showPresets: false,
        showFocusTune: false,
        showEngineRows: true,
        showReveal: false,
        primaryAction: 'none',
      };
    case 'results_sample':
      return {
        showPresets: false,
        showFocusTune: false,
        showEngineRows: true,
        showReveal: true,
        primaryAction: 'open_audit',
      };
    case 'error':
      return {
        showPresets: true,
        showFocusTune: false,
        showEngineRows: true,
        showReveal: false,
        primaryAction: 'run',
      };
    default:
      return {
        showPresets: false,
        showFocusTune: false,
        showEngineRows: true,
        showReveal: false,
        primaryAction: 'run',
      };
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'measured':
      return 'Measured';
    case 'estimated':
      return 'Estimated';
    case 'pending':
      return 'Checking';
    case 'not_measured':
      return 'Not measured';
    default:
      return 'Ready';
  }
}

export const VisibilityProbe: React.FC<VisibilityProbeProps> = ({
  isAuthenticated,
  onOpenAudit,
  onSignIn,
  onSignUp,
  onSeePricing,
}) => {
  const demo = useDemoPlayback();
  const [selected, setSelected] = useState<DemoEngineId | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ui = probeUiForPhase(demo.phase);
  const host =
    demo.fixture?.domain ||
    (demo.url.trim() ? demo.url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') : '');

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('luminara:focus-probe', focusInput);
    return () => window.removeEventListener('luminara:focus-probe', focusInput);
  }, []);

  const liveHandoff = (): AuditHandoff => ({
    url: demo.fixture?.domain || demo.url.trim() || host || '',
    focus: (demo.focus || 'AEO') as ReportFocus,
    sampleSource: false,
  });

  const openLiveAudit = () => onOpenAudit(liveHandoff());
  const openFreeAccount = () => {
    const handoff = liveHandoff();
    if (onSignUp) onSignUp(handoff);
    else onSignIn(handoff);
  };

  const runLabel = demo.phase === 'analyzing' ? 'Running…' : 'Run sample scout';
  const badge =
    demo.phase === 'results_sample' && demo.resultKind === 'live_crawl'
      ? 'Live crawl'
      : demo.phase === 'results_sample' && demo.resultKind === 'mixed'
        ? 'Mixed'
        : 'Sample';
  const primaryResultsLabel = isAuthenticated
    ? host
      ? `Run Instant Audit on ${host}`
      : 'Open Instant Audit'
    : host
      ? `Run it live on ${host}: free account`
      : 'Create a free account';

  return (
    <div className="relative min-w-0 border border-[var(--color-rule)] bg-[var(--color-paper)]">
      <div className="flex items-baseline justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-[var(--color-rule)]">
        <p className="text-[13px] font-medium text-[var(--color-ink)]">Visibility Probe</p>
        <p
          className={`shrink-0 text-[12px] font-mono tracking-wide ${
            badge === 'Sample'
              ? 'text-[var(--color-ink)] border border-[var(--color-rule)] px-2 py-0.5'
              : 'text-[var(--color-accent)] border border-[var(--color-accent)]/40 px-2 py-0.5'
          }`}
        >
          {badge}
        </p>
      </div>

      <div className="px-4 sm:px-5 pt-4 pb-5 space-y-4">
        <label htmlFor="visibility-probe-url" className="sr-only">
          Domain
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={inputRef}
            id="visibility-probe-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="yourbrand.com"
            value={demo.url}
            onChange={(e) => demo.setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && demo.phase !== 'analyzing') demo.runSample();
            }}
            disabled={demo.phase === 'analyzing'}
            className="flex-1 min-w-0 min-h-11 border border-[var(--color-rule)] bg-[var(--color-paper)] px-3.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-2)] focus:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] disabled:opacity-60"
          />
          {ui.primaryAction === 'run' && (
            <button
              type="button"
              className="mkt-cta-primary w-full sm:w-auto whitespace-nowrap !min-h-11"
              onClick={demo.runSample}
              disabled={demo.phase === 'analyzing'}
            >
              {runLabel}
            </button>
          )}
          {ui.primaryAction === 'open_audit' && (
            <button
              type="button"
              className="mkt-cta-primary w-full sm:w-auto whitespace-nowrap !min-h-11"
              onClick={isAuthenticated ? openLiveAudit : openFreeAccount}
            >
              {primaryResultsLabel}
            </button>
          )}
        </div>

        {demo.phase === 'empty' && (
          <p className="text-[13px] text-[var(--color-ink-2)]">
            Enter a domain for a Sample engine layout plus a Live crawl check when available.
          </p>
        )}

        {ui.showPresets && (
          <p className="text-[12px] text-[var(--color-ink-2)]">
            Try{' '}
            {DEMO_PRESETS.map((p, i) => (
              <React.Fragment key={p}>
                {i > 0 && <span className="text-[var(--color-ink-2)]/40"> · </span>}
                <button
                  type="button"
                  className="text-[var(--color-ink)] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
                  onClick={() => demo.setUrl(p)}
                >
                  {p}
                </button>
              </React.Fragment>
            ))}
          </p>
        )}

        {ui.showFocusTune && (
          <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Scout focus">
            {FOCI.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => demo.setFocus(f)}
                className={`text-[12px] min-h-10 px-1 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none ${
                  demo.focus === f
                    ? 'text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {demo.error && (
          <p className="text-sm text-red-300" role="alert">
            {demo.error}
          </p>
        )}

        {demo.phase === 'analyzing' && demo.stageLabel && (
          <p className="text-[12px] font-mono text-[var(--color-ink-2)]" aria-live="polite">
            {demo.stageLabel}
          </p>
        )}

        {ui.showEngineRows && (
          <ul
            className="border-t border-[var(--color-rule)] divide-y divide-[var(--color-rule)] -mx-4 sm:-mx-5"
            aria-live={demo.phase === 'analyzing' ? 'polite' : undefined}
          >
            {demo.engines.map((row) => {
              const active = selected === row.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelected((prev) => (prev === row.id ? null : row.id))}
                    className={`w-full text-left flex items-baseline justify-between gap-4 px-4 sm:px-5 py-3.5 min-h-11 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none ${
                      active
                        ? 'text-[var(--color-ink)]'
                        : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <span className="text-sm min-w-0 truncate">{row.label}</span>
                    <span className="shrink-0 text-[12px] font-mono tracking-wide text-[var(--color-ink)]">
                      {statusLabel(row.status)}
                    </span>
                  </button>
                  {active && (
                    <p className="px-4 sm:px-5 pb-3 text-[13px] text-[var(--color-ink-2)] leading-relaxed">
                      {row.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {ui.showReveal && demo.fixture && (
          <div className="pt-1 space-y-3" aria-live="polite">
            <p className="text-sm text-[var(--color-ink)] leading-relaxed">{demo.fixture.verdict}</p>
            <p className="text-sm text-[var(--color-ink-2)] leading-relaxed">
              <span className="text-[var(--color-ink)] font-medium">Next: </span>
              {demo.fixture.shipAction}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              {!isAuthenticated && (
                <button type="button" className="mkt-cta-tertiary min-h-10" onClick={() => onSignIn(liveHandoff())}>
                  Sign in
                </button>
              )}
              {isAuthenticated && (
                <button type="button" className="mkt-cta-tertiary min-h-10" onClick={openLiveAudit}>
                  Instant Audit
                </button>
              )}
              <button type="button" className="mkt-cta-tertiary min-h-10" onClick={onSeePricing}>
                Pricing
              </button>
              <button type="button" className="mkt-cta-tertiary min-h-10" onClick={demo.reset}>
                Reset
              </button>
            </div>
          </div>
        )}

        {demo.phase === 'error' && (
          <button type="button" className="mkt-cta-tertiary min-h-10" onClick={demo.reset}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
};
