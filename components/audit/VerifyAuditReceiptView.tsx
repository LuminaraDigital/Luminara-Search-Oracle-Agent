import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { VerificationCardSkeleton } from '../ui/Skeleton';
import { apiBase } from '../../services/apiClient';
import { checkSignedAuditReceipt, parsePastedAuditReceipt, type AuditReceiptCheck } from '../../services/auditReceipt/check';
import type { SignedAuditReceiptPayload } from '../../services/auditReceipt/payload';
import type { ReceiptPublicJwk } from '../../services/trust/receiptCrypto';
import { auditReceiptIdFromLocation } from '../../utils/marketingRoutes';

type FieldName = 'crawl' | 'engineResponses' | 'promptSet' | 'models' | 'observedAt';

const FIELD_LABEL: Record<FieldName, string> = {
  crawl: 'Crawl',
  engineResponses: 'Engine responses',
  promptSet: 'Prompt set',
  models: 'Models',
  observedAt: 'Observed at',
};

function formatWhen(iso: string | null): string {
  if (!iso) return 'Not measured';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : iso;
}

function statusLine(check: AuditReceiptCheck, revoked: boolean): { title: string; detail: string } {
  if (revoked && check.signature === 'valid' && check.contentHash === 'match') {
    return {
      title: 'Revoked',
      detail: 'The account holder revoked this receipt. The signature still matches the signed fields. Submitted by the account holder. Luminara did not run this audit.',
    };
  }
  if (check.signature === 'key_not_published') {
    return { title: 'Key not published', detail: 'This key id is not in the published set, so the signature was not checked.' };
  }
  if (check.signature === 'invalid') {
    return { title: 'Signature invalid', detail: 'The signature does not match this receipt.' };
  }
  if (!check.payload || check.contentHash === 'unread') {
    return { title: 'Not a Signed Audit Receipt', detail: 'The signature may check out, but this payload is not a Signed Audit Receipt.' };
  }
  if (check.contentHash === 'mismatch') {
    return { title: 'Content hash mismatch', detail: 'The signature is valid, and the content hash does not match the fields.' };
  }
  return {
    title: 'Signature valid',
    detail: 'The content hash matches the signed fields. Submitted by the account holder. Luminara did not run this audit.',
  };
}

const FieldList: React.FC<{ payload: SignedAuditReceiptPayload }> = ({ payload }) => (
  <dl className="divide-y divide-white/5">
    {(Object.keys(FIELD_LABEL) as FieldName[]).map((name) => {
      const status = payload.fieldStatus[name];
      const hash = name === 'observedAt' ? null : payload.hashes[name];
      return (
        <div key={name} className="grid grid-cols-[9rem_1fr] gap-3 py-2 text-sm">
          <dt className="text-gray-500">{FIELD_LABEL[name]}</dt>
          <dd className="text-gray-100 min-w-0 break-all">
            {status === 'not_measured' ? 'Not measured' : name === 'observedAt' ? formatWhen(payload.observedAt) : hash}
          </dd>
        </div>
      );
    })}
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-gray-500">Signed at</dt>
      <dd className="text-gray-100">{formatWhen(payload.issuedAt)}</dd>
    </div>
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-gray-500">Domain</dt>
      <dd className="text-gray-100">{payload.domain}</dd>
    </div>
  </dl>
);

export const VerifyAuditReceiptView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const receiptId = useMemo(
    () => (typeof window === 'undefined' ? '' : auditReceiptIdFromLocation(window.location.pathname, window.location.hash)),
    [],
  );
  const [paste, setPaste] = useState('');
  const [loading, setLoading] = useState(Boolean(receiptId));
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<AuditReceiptCheck | null>(null);
  const [revokedAt, setRevokedAt] = useState<string | null>(null);

  async function loadKeys(): Promise<ReceiptPublicJwk[]> {
    const response = await fetch(`${apiBase()}/api/audit-receipts/keys`);
    const data = (await response.json()) as { keys?: ReceiptPublicJwk[]; error?: string };
    if (!response.ok || !Array.isArray(data.keys)) {
      throw new Error(data.error || 'The public key could not be loaded.');
    }
    return data.keys;
  }

  async function checkText(text: string) {
    const parsed = parsePastedAuditReceipt(text);
    if ('error' in parsed) {
      setCheck(null);
      setError(parsed.error);
      return;
    }
    const keys = await loadKeys();
    setCheck(await checkSignedAuditReceipt({ ...parsed, keys }));
    const remoteRevoked = await lookupRevoked(parsed);
    if (remoteRevoked) setRevokedAt(remoteRevoked);
    setError(null);
  }

  async function lookupRevoked(parsed: { payloadJson: string; signature: string; kid: string }): Promise<string | null> {
    try {
      const response = await fetch(`${apiBase()}/api/audit-receipts/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = (await response.json()) as { revokedAt?: string | null };
      return response.ok && typeof data.revokedAt === 'string' ? data.revokedAt : null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!receiptId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${apiBase()}/api/audit-receipts/${encodeURIComponent(receiptId)}`);
        const data = (await response.json()) as { receipt?: { payloadJson: string; signature: string; kid: string }; error?: string };
        if (cancelled) return;
        if (!response.ok || !data.receipt) {
          setError(data.error || 'Receipt not found.');
          setLoading(false);
          return;
        }
        const text = JSON.stringify(data.receipt);
        setPaste(text);
        const revoked = typeof data.receipt === 'object' && data.receipt && 'revokedAt' in data.receipt
          ? (data.receipt as { revokedAt?: string | null }).revokedAt
          : null;
        setRevokedAt(typeof revoked === 'string' ? revoked : null);
        await checkText(text);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The receipt could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // checkText closes over setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  const line = check ? statusLine(check, Boolean(revokedAt)) : null;

  return (
    <div className="min-h-[100dvh] bg-black text-gray-100">
      <header className="border-b border-white/10 px-4 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gold-light font-mono">Luminara Suite</p>
          <h1 className="text-lg font-semibold text-white">Signed Audit Receipt</h1>
        </div>
        {onBack && (
          <Button variant="secondary" size="sm" onClick={onBack}>
            Home
          </Button>
        )}
      </header>
      <main className="max-w-xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm text-gray-300">
          Paste a receipt, or open a link that already has one. A Signed Audit Receipt is submitted by the account holder. Luminara signs the hashes. Luminara does not run the audit.
        </p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setLoading(true);
            setRevokedAt(null);
            checkText(paste)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : 'The receipt could not be checked.'))
              .finally(() => setLoading(false));
          }}
        >
          <label htmlFor="audit-receipt-json" className="block text-xs uppercase tracking-widest text-gray-500 font-mono">
            Receipt JSON
          </label>
          <textarea
            id="audit-receipt-json"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            rows={8}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 font-mono text-xs text-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-gold"
            placeholder='{"payloadJson":"...","signature":"...","kid":"..."}'
          />
          <Button type="submit" variant="primary" size="sm">
            Check receipt
          </Button>
        </form>
        {loading && <VerificationCardSkeleton title="Checking the receipt" />}
        {error && (
          <p className="text-sm text-danger-400 font-mono" role="alert">
            {error}
          </p>
        )}
        {line && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4" aria-live="polite">
            <div>
              <h2 className="text-xl font-semibold text-white">{line.title}</h2>
              <p className="text-sm text-gray-400">{line.detail}</p>
            </div>
            {check?.payload && check.contentHash === 'match' && check.signature === 'valid' && <FieldList payload={check.payload} />}
          </section>
        )}
        <p className="text-xs text-gray-500">
          A valid signature means the receipt was not changed after Luminara signed it. A field marked Not measured was not included. Revoked is shown when this page can read that mark from Luminara. This page does not re-crawl the site or call an engine.
        </p>
      </main>
    </div>
  );
};
