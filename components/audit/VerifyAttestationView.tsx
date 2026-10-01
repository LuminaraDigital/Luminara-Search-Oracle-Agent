import React, { useEffect, useMemo, useState } from 'react';
import { fetchAttestationByDigest } from '../../services/share/shareReportClient';
import { AUDIT_DIGEST_DISCLOSURE } from '../../services/agentCore/tonAttestationService';
import { Button } from '../ui/Button';

function digestFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const pathMatch = window.location.pathname.match(/\/verify\/([a-f0-9]{64})/i);
  if (pathMatch?.[1]) return pathMatch[1].toLowerCase();
  const hash = window.location.hash.replace(/^#/, '');
  const hashMatch = hash.match(/^verify\/([a-f0-9]{64})$/i);
  return hashMatch?.[1]?.toLowerCase() || '';
}

export const VerifyAttestationView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const digest = useMemo(() => digestFromLocation(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!digest) {
        setError('Invalid verification link');
        setLoading(false);
        return;
      }
      const res = await fetchAttestationByDigest(digest);
      if (cancelled) return;
      if (!res.ok || !res.attestation) {
        setError(res.error || 'Digest not found');
        setLoading(false);
        return;
      }
      setAttestation(res.attestation);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [digest]);

  return (
    <div className="min-h-[100dvh] bg-black text-gray-100">
      <header className="border-b border-white/10 px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gold-light font-mono">Luminara-recorded digest</p>
          <h1 className="text-lg font-semibold text-white">Audit digest lookup</h1>
        </div>
        {onBack && (
          <Button variant="secondary" size="sm" onClick={onBack}>
            Home
          </Button>
        )}
      </header>
      <main className="max-w-xl mx-auto px-4 py-8 space-y-4">
        {loading && <p className="text-sm text-gray-400 font-mono">Looking up digest...</p>}
        {error && (
          <p className="text-sm text-danger-400 font-mono" role="alert">
            {error}
          </p>
        )}
        {attestation && (
          <div className="rounded-2xl border border-gold/30 bg-white/[0.03] p-5 space-y-2 font-mono text-xs">
            <p>
              <span className="text-gray-500">Domain: </span>
              <span className="text-white">{String(attestation.domain || '')}</span>
            </p>
            <p>
              <span className="text-gray-500">Health score: </span>
              <span className="text-gold-light">{String(attestation.healthScore ?? '')}</span>
            </p>
            <p>
              <span className="text-gray-500">Citation rate: </span>
              <span className="text-white">{String(attestation.citationRatePercent ?? '')}%</span>
            </p>
            <p className="break-all">
              <span className="text-gray-500">Digest: </span>
              <span className="text-gray-300">{digest}</span>
            </p>
            <p className="text-gray-400 pt-2">{AUDIT_DIGEST_DISCLOSURE}</p>
          </div>
        )}
      </main>
    </div>
  );
};
