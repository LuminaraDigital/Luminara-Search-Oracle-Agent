import React from 'react';
import { VisibilityConstellation } from './VisibilityConstellation';
import { DEMO_PRESETS, DemoFocus } from './demo/demoFixtures';
import { useDemoPlayback } from './demo/useDemoPlayback';

interface VisibilityProbeProps {
  isAuthenticated?: boolean;
  onOpenAudit: () => void;
  onSignIn: () => void;
  onSeePricing: () => void;
}

const FOCI: DemoFocus[] = ['SEO', 'AEO', 'GEO'];

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
      return 'Idle';
  }
}

/**
 * Interactive Instant Audit micro-stage for the landing Workbench hero.
 * Sample path is offline fixtures only. Live hosted spend never starts here.
 */
export const VisibilityProbe: React.FC<VisibilityProbeProps> = ({
  isAuthenticated,
  onOpenAudit,
  onSignIn,
  onSeePricing,
}) => {
  const demo = useDemoPlayback();
  const host =
    demo.fixture?.domain ||
    (demo.url.trim() ? demo.url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') : 'your site');

  return (
    <div className="relative border border-white/[0.08] rounded-2xl p-4 sm:p-6 bg-[var(--color-paper-2)]/90 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-ink)] truncate">Visibility Probe</p>
          <p className="text-[11px] text-[var(--color-ink-2)] mt-0.5">
            Instant Audit stage · answer engines
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-[var(--color-rule)] text-[var(--gold-light)]">
          {demo.phase === 'results_sample' ? 'Sample UI' : 'Sample until you run'}
        </span>
      </div>

      <VisibilityConstellation engines={demo.engines} domainLabel={host} className="mb-4" />

      <label htmlFor="visibility-probe-url" className="block text-[11px] text-[var(--color-ink-2)] mb-1.5">
        Domain
      </label>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          id="visibility-probe-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="yourbrand.com"
          value={demo.url}
          onChange={(e) => demo.setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') demo.runSample();
          }}
          className="flex-1 min-w-0 min-h-11 rounded-xl bg-black/50 border border-white/10 px-3.5 text-sm text-white placeholder:text-gray-600 focus:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
        />
        <button type="button" className="mkt-cta-primary w-full sm:w-auto whitespace-nowrap" onClick={demo.runSample}>
          {demo.phase === 'analyzing' ? 'Running…' : 'Run quick scout'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {FOCI.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => demo.setFocus(f)}
            className={`min-h-9 px-3 rounded-lg text-[11px] font-medium border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none ${
              demo.focus === f
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--gold-light)]'
                : 'border-white/10 text-[var(--color-ink-2)] hover:border-white/25'
            }`}
          >
            {f}
          </button>
        ))}
        {DEMO_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => demo.setUrl(p)}
            className="min-h-9 px-2.5 rounded-lg text-[10px] font-mono text-gray-500 border border-transparent hover:border-white/10 hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:outline-none"
          >
            {p}
          </button>
        ))}
      </div>

      {demo.error && (
        <p className="text-sm text-red-300 mb-3" role="alert">
          {demo.error}
        </p>
      )}

      {demo.phase === 'analyzing' && demo.stageLabel && (
        <p className="text-[12px] text-[var(--color-ink-2)] mb-3 font-mono" aria-live="polite">
          {demo.stageLabel}
        </p>
      )}

      <ul className="space-y-2 mb-4">
        {demo.engines.map((row) => (
          <li
            key={row.id}
            className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/35 px-3 py-2.5 min-w-0"
          >
            <div className="min-w-0">
              <p className="text-[12px] text-[var(--color-ink)] truncate">{row.label}</p>
              <p className="text-[11px] text-[var(--color-ink-2)] mt-0.5 leading-snug">{row.note}</p>
            </div>
            <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {statusLabel(row.status)}
            </span>
          </li>
        ))}
      </ul>

      {demo.fixture && (
        <div className="rounded-xl border border-[var(--color-rule)] bg-black/40 p-3.5 mb-4 space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--gold-light)]">
            Sample · illustrative · not live data
          </p>
          <p className="text-sm text-[var(--color-ink)] leading-relaxed">{demo.fixture.verdict}</p>
          <p className="text-sm text-[var(--color-ink-2)]">
            <span className="text-[var(--color-ink)] font-medium">Ship action: </span>
            {demo.fixture.shipAction}
          </p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row flex-wrap gap-2">
        <button type="button" className="mkt-cta-primary w-full sm:w-auto" onClick={onOpenAudit}>
          Open Instant Audit
        </button>
        {!isAuthenticated && (
          <button type="button" className="mkt-cta-secondary w-full sm:w-auto" onClick={onSignIn}>
            Sign in to save
          </button>
        )}
        <button type="button" className="mkt-cta-secondary w-full sm:w-auto" onClick={onSeePricing}>
          See pricing
        </button>
        {(demo.phase === 'results_sample' || demo.phase === 'error') && (
          <button type="button" className="mkt-cta-tertiary self-center px-2 py-2" onClick={demo.reset}>
            Reset sample
          </button>
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--color-ink-2)] leading-relaxed">
        This stage is a labeled sample. Open Instant Audit to run a live guest scout with your own
        API keys in Settings. Hosted AI, save, share, and MCP need an account.
      </p>
    </div>
  );
};
