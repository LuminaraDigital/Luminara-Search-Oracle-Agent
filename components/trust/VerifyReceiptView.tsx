import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { ICONS } from '../ui/icons';
import { receiptIdFromLocation } from '../../utils/marketingRoutes';
import {
  fetchReceipt,
  isTrustDisabledError,
  receiptLevelSentence,
  verifyReceiptOffline,
  type OfflineVerifyResult,
} from '../../services/trust/trustClient';
import { RECEIPT_CLAIM_LABELS, type TrustReceiptPayload, type TrustReceiptView } from '../../services/trust/receiptTypes';

type SigState = 'checking' | 'valid' | 'invalid' | 'key_not_found';

function sigStateFrom(result: OfflineVerifyResult): SigState {
  if (!result.kidFound) return 'key_not_found';
  return result.valid ? 'valid' : 'invalid';
}

function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return 'unknown';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown';
}

/** Display the signed bytes, not the server's convenience copy, so what you read is what was signed. */
function signedPayload(receipt: TrustReceiptView): TrustReceiptPayload {
  try {
    return JSON.parse(receipt.payloadJson) as TrustReceiptPayload;
  } catch {
    return receipt.payload;
  }
}

const SmallCopy: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded px-1 text-gray-400 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-gold"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable: value stays visible in Raw receipt */
        }
      }}
    >
      {copied ? <ICONS.Check className="w-3 h-3" /> : <ICONS.Copy className="w-3 h-3" />}
    </button>
  );
};

const SIG_COPY: Record<SigState, { label: string; detail: string; className: string }> = {
  checking: { label: 'Checking signature', detail: 'Verifying in your browser with the published key.', className: 'border-white/15 text-gray-300' },
  valid: {
    label: 'Valid signature',
    detail: 'Checked in your browser. This receipt was signed by Luminara and has not been altered.',
    className: 'border-gold/50 text-gold-light',
  },
  invalid: {
    label: 'Invalid signature',
    detail: 'The signature does not match the receipt contents. Do not rely on this receipt.',
    className: 'border-danger-500/50 text-danger-300',
  },
  key_not_found: {
    label: 'Key not found',
    detail: 'The signing key for this receipt is not in the published key set, so it cannot be checked.',
    className: 'border-danger-500/50 text-danger-300',
  },
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-3 py-2 text-sm">
    <dt className="text-gray-500">{label}</dt>
    <dd className="text-gray-100 min-w-0 break-words">{children}</dd>
  </div>
);

export const VerifyReceiptView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const receiptId = useMemo(
    () => (typeof window === 'undefined' ? '' : receiptIdFromLocation(window.location.pathname, window.location.hash)),
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TrustReceiptView | null>(null);
  const [sig, setSig] = useState<SigState>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!receiptId) {
        setError('This verification link is not valid.');
        setLoading(false);
        return;
      }
      try {
        const res = await fetchReceipt(receiptId);
        if (cancelled) return;
        setReceipt(res.receipt);
        setLoading(false);
        const result = await verifyReceiptOffline(res.receipt);
        if (!cancelled) setSig(sigStateFrom(result));
      } catch (err) {
        if (cancelled) return;
        setError(
          isTrustDisabledError(err)
            ? 'Receipts are not enabled on this deployment yet.'
            : 'Receipt not found. It may be private, or the link may be mistyped.',
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  const payload = receipt ? signedPayload(receipt) : null;
  const idMismatch = Boolean(receipt && payload && payload.id !== receipt.id);
  const sigCopy = SIG_COPY[idMismatch ? 'invalid' : sig];
  const selfReported = payload?.level === 'self_reported';

  return (
    <div className="min-h-[100dvh] bg-black text-gray-100">
      <header className="border-b border-white/10 px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gold-light font-mono">Luminara trust receipt</p>
          <h1 className="text-lg font-semibold text-white">Receipt check</h1>
        </div>
        {onBack && (
          <Button variant="secondary" size="sm" onClick={onBack}>
            Home
          </Button>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {loading && <p className="text-sm text-gray-400 font-mono">Loading receipt...</p>}
        {error && (
          <p className="text-sm text-gray-300" role="alert">
            {error}
          </p>
        )}

        {receipt && payload && (
          <>
            {receipt.revokedAt && (
              <div role="alert" className="rounded-xl border border-danger-500/50 bg-danger-500/10 px-4 py-3 text-sm text-danger-200">
                Revoked {formatDateTime(receipt.revokedAt)}
                {receipt.revokedReason ? `: ${receipt.revokedReason}` : '.'} This receipt no longer stands.
              </div>
            )}

            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Claim</p>
                <h2 className="text-xl font-semibold text-white">{RECEIPT_CLAIM_LABELS[payload.claim] ?? payload.claim}</h2>
                <p className="font-mono text-sm text-gray-300 break-all">{payload.subject.id}</p>
              </div>

              <div
                role="status"
                aria-live="polite"
                className={`rounded-xl border px-4 py-3 text-sm ${sigCopy.className}`}
              >
                <p className="font-semibold">{sigCopy.label}</p>
                <p className="text-gray-400">{idMismatch ? 'The signed receipt id does not match this link.' : sigCopy.detail}</p>
              </div>

              <dl className="divide-y divide-white/5">
                <Row label="Level">
                  <span className={selfReported ? 'text-gray-200 font-semibold' : ''}>{receiptLevelSentence(payload.level)}</span>
                </Row>
                <Row label="Method">
                  <span className="font-mono">{payload.method}</span>
                </Row>
                <Row label="Issued">{formatDateTime(payload.issuedAt)}</Row>
                {payload.expiresAt && <Row label="Expires">{formatDateTime(payload.expiresAt)}</Row>}
                <Row label="Measurement">
                  <span className="font-mono">{payload.measurementStatus}</span>
                </Row>
                <Row label="Issuer">
                  <span className="font-mono">{payload.iss}</span>
                </Row>
              </dl>

              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Evidence</p>
                {payload.evidence.length === 0 ? (
                  <p className="text-sm text-gray-400">No evidence recorded.</p>
                ) : (
                  <ul className="space-y-2">
                    {payload.evidence.map((ev, i) => (
                      <li key={`${ev.ref}-${i}`} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono space-y-1">
                        <p className="text-gray-300 break-all">{ev.url || ev.ref}</p>
                        {ev.sha256 && (
                          <p className="text-gray-500 flex items-center gap-1">
                            sha256 <span className="text-gray-300" title={ev.sha256}>{ev.sha256.slice(0, 16)}...</span>
                            <SmallCopy value={ev.sha256} label="sha256" />
                          </p>
                        )}
                        {ev.fetchedAt && <p className="text-gray-500">fetched {formatDateTime(ev.fetchedAt)}</p>}
                        {typeof ev.httpStatus === 'number' && <p className="text-gray-500">HTTP {ev.httpStatus}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-xs">
              <summary className="cursor-pointer text-sm text-gray-300 outline-none focus-visible:ring-2 focus-visible:ring-gold rounded">
                Raw receipt
              </summary>
              <div className="mt-4 space-y-3 font-mono">
                <div>
                  <p className="text-gray-500 flex items-center gap-1">
                    payloadJson <SmallCopy value={receipt.payloadJson} label="payload JSON" />
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-black/60 p-3 text-gray-300">{receipt.payloadJson}</pre>
                </div>
                <div>
                  <p className="text-gray-500 flex items-center gap-1">
                    signature <SmallCopy value={receipt.signature} label="signature" />
                  </p>
                  <p className="mt-1 break-all text-gray-300">{receipt.signature}</p>
                </div>
                <div>
                  <p className="text-gray-500">kid</p>
                  <p className="mt-1 text-gray-300">{receipt.kid}</p>
                </div>
                <p className="text-gray-400 font-sans">
                  To check independently: fetch the public key with this kid from{' '}
                  <a className="underline underline-offset-4 hover:text-white" href="/api/trust/keys">
                    /api/trust/keys
                  </a>{' '}
                  and verify the Ed25519 signature (base64url) over the UTF-8 bytes of payloadJson.
                </p>
              </div>
            </details>
          </>
        )}
      </main>
    </div>
  );
};

export default VerifyReceiptView;
