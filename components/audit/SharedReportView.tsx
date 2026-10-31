import React, { useEffect, useMemo, useState } from 'react';
import { ReportDisplay } from './ReportDisplay';
import { fetchSharedReport, type SharedReportResponse } from '../../services/share/shareReportClient';
import { Button } from '../ui/Button';
import { AuditReportSkeleton } from '../ui/Skeleton';
import { productTelemetry } from '../../services/analytics/productTelemetry';

function tokenFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const pathMatch = window.location.pathname.match(/\/share\/([a-f0-9]{64})/i);
  if (pathMatch?.[1]) return pathMatch[1].toLowerCase();
  const hash = window.location.hash.replace(/^#/, '');
  const hashMatch = hash.match(/^share\/([a-f0-9]{64})$/i);
  return hashMatch?.[1]?.toLowerCase() || '';
}

export const SharedReportView: React.FC<{
  onBack?: () => void;
  onOpenInstantAudit?: () => void;
  onSeePricing?: () => void;
}> = ({ onBack, onOpenInstantAudit, onSeePricing }) => {
  const token = useMemo(() => tokenFromLocation(), []);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SharedReportResponse['report'] | null>(null);

  const load = async (pw?: string) => {
    if (!token) {
      setError('Invalid share link');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetchSharedReport(token, pw);
    if (res.code === 'SHARE_PASSWORD_REQUIRED' || res.passwordRequired) {
      setNeedsPassword(true);
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!res.ok || !res.report) {
      setError(res.error || 'Could not load shared report');
      setPayload(null);
      setLoading(false);
      return;
    }
    setNeedsPassword(false);
    setPayload(res.report);
    productTelemetry.track('share_link_opened', { hasPassword: Boolean(pw) });
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const branding = payload?.branding;
  // White-labelled reports belong to the agency; every other report carries Luminara's badge and CTA.
  const showLuminaraCta = Boolean(payload) && !branding?.agencyName;
  const openInstantAudit = () => {
    productTelemetry.track('shared_report_cta_clicked', { domain: payload?.domain || null });
    onOpenInstantAudit?.();
  };

  return (
    <div className="min-h-[100dvh] bg-black text-gray-100">
      <header className="border-b border-white/10 px-4 py-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gold-light font-mono">
            {branding?.agencyName || 'Luminara Suite'}
          </p>
          <h1 className="text-lg font-semibold text-white">
            {branding?.clientName || payload?.dnaName || payload?.domain || 'Shared audit report'}
          </h1>
        </div>
        {onBack && (
          <Button variant="secondary" size="sm" onClick={onBack}>
            Home
          </Button>
        )}
      </header>

      <main id="main" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8 outline-none">
        {loading && <AuditReportSkeleton message="Loading shared report..." />}

        {!loading && needsPassword && (
          <form
            className="max-w-sm space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void load(password);
            }}
          >
            <p className="text-sm text-gray-300">This report is password protected.</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-sm text-white"
              autoFocus
            />
            <Button type="submit" variant="primary" size="sm">
              Unlock
            </Button>
          </form>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-danger-500/30 bg-danger-950/10 p-5 flex items-center justify-between gap-4" role="alert">
            <p className="text-sm text-danger-400 font-mono">{error}</p>
            {token && (
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            )}
          </div>
        )}

        {!loading && payload && (
          <>
            {branding?.preparedBy && (
              <p className="text-xs text-gray-500 mb-4 font-mono">Prepared by {branding.preparedBy}</p>
            )}
            {showLuminaraCta && (
              <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-gold/30 bg-gold/[0.04] px-4 py-3">
                <p className="text-sm text-gray-200">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-gold-light mr-2">Audited by Luminara</span>
                  How do AI answer engines see your site?
                </p>
                {onOpenInstantAudit && (
                  <Button variant="primary" size="sm" onClick={openInstantAudit}>
                    Check your site free
                  </Button>
                )}
              </div>
            )}
            <ReportDisplay
              markdownText={payload.markdownText}
              sources={payload.sources}
              targetDomain={payload.domain}
              dnaName={payload.dnaName}
              hideAgencyActions
            />
            {showLuminaraCta && (onOpenInstantAudit || onSeePricing) && (
              <footer className="mt-10 pt-6 border-t border-white/10 space-y-3">
                <p className="text-sm text-gray-300 leading-relaxed">
                  Get the same report for your own site. The Instant Audit and share links are free.
                </p>
                <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                  {onOpenInstantAudit && (
                    <Button variant="primary" size="sm" onClick={openInstantAudit}>
                      Run a free Instant Audit
                    </Button>
                  )}
                  {onSeePricing && (
                    <Button variant="secondary" size="sm" onClick={onSeePricing}>
                      See pricing
                    </Button>
                  )}
                </div>
              </footer>
            )}
          </>
        )}
      </main>
    </div>
  );
};
