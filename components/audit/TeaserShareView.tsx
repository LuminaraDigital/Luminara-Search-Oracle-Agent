import React, { useEffect, useMemo, useState } from 'react';
import { fetchShareTeaser, type TeaserPublic } from '../../services/share/shareReportClient';
import { TELEGRAM_MINI_APP_URL } from '../paywall/paymentOptions';

function tokenFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/\/share\/teaser\/([a-f0-9]{64})/i);
  return match?.[1]?.toLowerCase() || '';
}

export const TeaserShareView: React.FC<{ onOpenApp?: () => void }> = ({ onOpenApp }) => {
  const token = useMemo(() => tokenFromLocation(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teaser, setTeaser] = useState<TeaserPublic | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError('This teaser link is not valid.');
        setLoading(false);
        return;
      }
      const res = await fetchShareTeaser(token);
      if (cancelled) return;
      if (!res.ok || !res.teaser) {
        setError(res.error || 'This teaser is unavailable.');
        setTeaser(null);
      } else {
        setTeaser(res.teaser);
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const cta = teaser?.domain
    ? `${TELEGRAM_MINI_APP_URL}?startapp=${encodeURIComponent(`audit_${teaser.domain}`)}`
    : TELEGRAM_MINI_APP_URL;

  return (
    <div className="min-h-[100dvh] bg-black text-gray-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-gold-light font-bold">Luminara Suite</p>
          <h1 className="text-lg font-semibold text-white">Redacted scout</h1>
        </div>
        <a
          href={cta}
          className="min-h-11 inline-flex items-center rounded-lg bg-gradient-to-r from-gold to-gold-dark px-4 text-[11px] font-black uppercase tracking-widest text-black"
          onClick={(event) => {
            if (!onOpenApp) return;
            event.preventDefault();
            onOpenApp();
          }}
        >
          Open Mini App
        </a>
      </header>
      <main className="max-w-2xl mx-auto px-5 py-10">
        {loading && <p className="text-sm text-gray-400">Loading teaser...</p>}
        {!loading && error && <p className="text-sm text-gray-300">{error}</p>}
        {!loading && teaser && (
          <article>
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Redacted teaser, not a verified measurement</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white [overflow-wrap:anywhere]">{teaser.domain}</h2>
            <p className="mt-5 text-[15px] leading-relaxed text-gray-200">{teaser.verdict}</p>
            <h3 className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Your next move</h3>
            <p className="mt-2 text-sm text-white">{teaser.topFix}</p>
            <h3 className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Evidence</h3>
            <p className="mt-2 text-sm text-gray-300">{teaser.evidenceNote}</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {teaser.badges.map((badge) => (
                <li key={`${badge.label}-${badge.status}`} className="rounded-full border border-white/15 px-3 py-1 text-[11px] text-gray-300">
                  {badge.label}: {badge.status === 'not_measured' ? 'not measured' : badge.value || badge.status}
                </li>
              ))}
            </ul>
            {teaser.failed.length > 0 && (
              <>
                <h3 className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">What failed</h3>
                <ul className="mt-2 list-disc pl-5 text-sm text-gray-300 space-y-1">
                  {teaser.failed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-10 text-[12px] leading-relaxed text-gray-500">
              This page is a redacted teaser, not a verified measurement. It omits the full report, sources list, and any account data. Open the Mini App to run your own scout. Full branded share links are a Growth and Agency feature.
            </p>
          </article>
        )}
      </main>
    </div>
  );
};
