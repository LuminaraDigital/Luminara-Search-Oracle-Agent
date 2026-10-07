import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { ICONS } from '../ui/icons';
import { useConfirm } from '../ui/ConfirmModal';
import {
  DOMAIN_METHOD_LABELS,
  checkDomain,
  fetchTrustFlags,
  isTrustDisabledError,
  listDomains,
  listMyReceipts,
  receiptLevelSentence as levelSentence,
  removeDomain,
  setReceiptVisibility,
  startDomainVerification,
  verifyLinkFor,
  type DomainCheckResult,
  type DomainInstructions,
  type DomainVerificationRow,
  type DomainVerificationStatus,
} from '../../services/trust/trustClient';
import { RECEIPT_CLAIM_LABELS, type TrustReceiptView } from '../../services/trust/receiptTypes';

type SectionState = 'loading' | 'ready' | 'disabled' | 'error';

type PendingProof = {
  domain: string;
  tokenExpiresAt: string;
  instructions: DomainInstructions;
};

const COMING_NEXT = [
  { title: 'Business register', detail: 'Match your ABN or NZBN against the official register.' },
  { title: 'Linked profiles', detail: 'Prove the social and directory profiles that belong to you.' },
  { title: 'Team members', detail: 'Confirm the people who work on this business.' },
  { title: 'Public profile page', detail: 'One page that lists every public receipt.' },
];

function normaliseDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'not yet';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const CopyButton: React.FC<{ value: string; label?: string }> = ({ value, label = 'Copy' }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        const ok = await copyText(value);
        setState(ok ? 'copied' : 'failed');
        window.setTimeout(() => setState('idle'), 1800);
      }}
      aria-label={`${label}: ${value}`}
    >
      {state === 'copied' ? <ICONS.Check className="w-3.5 h-3.5" /> : <ICONS.Copy className="w-3.5 h-3.5" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
};

const CopyField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="space-y-1">
    <p className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">{label}</p>
    <div className="flex items-start gap-2">
      <code className="flex-1 min-w-0 break-all rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono text-gray-200">
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  </div>
);

const STATUS_CHIP: Record<DomainVerificationStatus, { label: string; className: string }> = {
  verified: { label: 'Verified', className: 'border-gold/50 text-gold-light' },
  pending: { label: 'Pending', className: 'border-white/20 text-gray-300' },
  lapsed: { label: 'Lapsed', className: 'border-white/20 text-gray-400 line-through decoration-white/30' },
  revoked: { label: 'Revoked', className: 'border-danger-500/40 text-danger-300' },
};

const StatusChip: React.FC<{ status: DomainVerificationStatus }> = ({ status }) => {
  const chip = STATUS_CHIP[status] ?? STATUS_CHIP.pending;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest ${chip.className}`}>
      {chip.label}
    </span>
  );
};

const NotEnabled: React.FC<{ what: string }> = ({ what }) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-gray-400">
    {what} is not enabled on this deployment yet.
  </div>
);

const StepHeader: React.FC<{ step: number; title: string; done?: boolean; subtitle: string }> = ({ step, title, done, subtitle }) => (
  <div className="flex items-start gap-3">
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-mono ${
        done ? 'border-gold bg-gold/15 text-gold-light' : 'border-white/20 text-gray-400'
      }`}
      aria-hidden="true"
    >
      {done ? <ICONS.Check className="w-3.5 h-3.5" /> : step}
    </span>
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-sm text-gray-400">{subtitle}</p>
    </div>
  </div>
);

const CheckOutcome: React.FC<{ result: DomainCheckResult }> = ({ result }) => {
  if (result.status === 'verified') {
    return (
      <div role="status" className="rounded-xl border border-gold/40 bg-gold/[0.06] px-4 py-3 text-sm space-y-1">
        <p className="text-gold-light font-semibold">Domain verified with {DOMAIN_METHOD_LABELS[result.method] ?? result.method}.</p>
        {result.receiptIssued && result.receiptId ? (
          <a className="text-gray-200 underline underline-offset-4 hover:text-white" href={`/verify/r/${result.receiptId}`}>
            Open the signed receipt
          </a>
        ) : (
          <p className="text-gray-300">
            No receipt was issued{result.receiptError ? `: ${result.receiptError}` : '.'}
          </p>
        )}
      </div>
    );
  }
  if (result.status === 'not_found') {
    return (
      <div role="status" className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-gray-300 space-y-1">
        <p className="text-white font-semibold">Token not found yet.</p>
        <p>{result.error}</p>
        <p className="text-gray-400">
          DNS changes can take a few minutes to an hour to appear. Check the record name and value match exactly, or use the
          file or meta tag method instead.
        </p>
      </div>
    );
  }
  if (result.status === 'unreachable') {
    return (
      <div role="status" className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-gray-300 space-y-1">
        <p className="text-white font-semibold">Not measured: we could not reach DNS or the site.</p>
        <p>{result.error} This does not count against your domain. Try again shortly.</p>
      </div>
    );
  }
  return (
    <p role="alert" className="text-sm text-danger-400">
      {result.error}
    </p>
  );
};

export const TrustCenterView: React.FC<{ initialDomain?: string }> = ({ initialDomain = '' }) => {
  const { requestConfirm, confirmModal } = useConfirm();

  const [domainState, setDomainState] = useState<SectionState>('loading');
  const [receiptState, setReceiptState] = useState<SectionState>('loading');
  const [domains, setDomains] = useState<DomainVerificationRow[]>([]);
  const [receipts, setReceipts] = useState<TrustReceiptView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [domainInput, setDomainInput] = useState(() => normaliseDomain(initialDomain));
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingProof | null>(null);
  const [checkingDomain, setCheckingDomain] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<string, DomainCheckResult>>({});
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const loadDomains = useCallback(async () => {
    try {
      setDomains(await listDomains());
      setDomainState('ready');
    } catch (err) {
      if (isTrustDisabledError(err)) setDomainState('disabled');
      else {
        setDomainState('error');
        setLoadError(err instanceof Error ? err.message : 'Could not load domains.');
      }
    }
  }, []);

  const loadReceipts = useCallback(async () => {
    try {
      setReceipts(await listMyReceipts());
      setReceiptState('ready');
    } catch (err) {
      if (isTrustDisabledError(err)) setReceiptState('disabled');
      else {
        setReceiptState('error');
        setLoadError(err instanceof Error ? err.message : 'Could not load receipts.');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const flags = await fetchTrustFlags();
      if (cancelled) return;
      if (flags && !flags.domainVerifyEnabled) setDomainState('disabled');
      else void loadDomains();
      if (flags && !flags.receiptsEnabled) setReceiptState('disabled');
      else void loadReceipts();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDomains, loadReceipts]);

  const start = async (rawDomain: string) => {
    const domain = normaliseDomain(rawDomain);
    if (!domain) {
      setStartError('Enter a domain like example.com.');
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const res = await startDomainVerification(domain);
      if (res.alreadyVerified) {
        setPending(null);
      } else {
        setPending({ domain: res.domain, tokenExpiresAt: res.tokenExpiresAt, instructions: res.instructions });
        setCheckResults((prev) => {
          const next = { ...prev };
          delete next[res.domain];
          return next;
        });
      }
      await loadDomains();
    } catch (err) {
      if (isTrustDisabledError(err)) setDomainState('disabled');
      else setStartError(err instanceof Error ? err.message : 'Could not start verification.');
    } finally {
      setStarting(false);
    }
  };

  const runCheck = async (domain: string) => {
    setCheckingDomain(domain);
    try {
      const result = await checkDomain(domain);
      setCheckResults((prev) => ({ ...prev, [domain]: result }));
      if (result.status === 'verified') {
        if (pending?.domain === domain) setPending(null);
        await Promise.all([loadDomains(), receiptState === 'disabled' ? Promise.resolve() : loadReceipts()]);
      }
    } catch (err) {
      setCheckResults((prev) => ({
        ...prev,
        [domain]: { ok: false, status: 'error', error: err instanceof Error ? err.message : 'Check failed. Try again.' },
      }));
    } finally {
      setCheckingDomain(null);
    }
  };

  const confirmRemove = (domain: string) => {
    requestConfirm(
      {
        title: `Remove ${domain}?`,
        description: 'This stops checking the domain. Any receipt already issued for it stays on record until revoked.',
        confirmLabel: 'Remove',
        variant: 'danger',
      },
      async () => {
        try {
          await removeDomain(domain);
          if (pending?.domain === domain) setPending(null);
          await loadDomains();
        } catch (err) {
          setStartError(err instanceof Error ? err.message : 'Could not remove domain.');
        }
      },
    );
  };

  const toggleVisibility = async (receipt: TrustReceiptView) => {
    const next = receipt.visibility === 'public' ? 'private' : 'public';
    setReceiptBusy(receipt.id);
    setReceiptError(null);
    try {
      await setReceiptVisibility(receipt.id, next);
      setReceipts((prev) => prev.map((r) => (r.id === receipt.id ? { ...r, visibility: next } : r)));
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Could not change visibility.');
    } finally {
      setReceiptBusy(null);
    }
  };

  const hasVerifiedDomain = domains.some((d) => d.status === 'verified');
  const pendingCheck = pending ? checkResults[pending.domain] : undefined;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">
      {confirmModal}
      <header className="space-y-2 border-b border-white/10 pb-6">
        <p className="text-[10px] uppercase tracking-widest text-gold-light font-mono">Trust</p>
        <h1 className="text-2xl font-semibold text-white">Prove what is true about your business</h1>
        <p className="text-sm text-gray-400">
          Each check produces a signed receipt anyone can verify with our public key. Nothing here is marked verified unless a
          receipt says so.
        </p>
      </header>

      {loadError && (
        <p role="alert" className="text-sm text-danger-400">
          {loadError}
        </p>
      )}

      {/* Step 1: domain */}
      <section className="space-y-5" aria-labelledby="trust-step-domain">
        <div id="trust-step-domain">
          <StepHeader step={1} title="Verify your domain" done={hasVerifiedDomain} subtitle="Show you control the website you list." />
        </div>

        {domainState === 'loading' && (
          <div className="space-y-2">
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        )}
        {domainState === 'disabled' && <NotEnabled what="Domain verification" />}

        {(domainState === 'ready' || domainState === 'error') && (
          <>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void start(domainInput);
              }}
            >
              <label htmlFor="trust-domain" className="sr-only">
                Domain
              </label>
              <input
                id="trust-domain"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="example.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                className="flex-1 min-h-11 rounded-xl border border-white/15 bg-black/40 px-4 text-sm text-white placeholder:text-gray-600 outline-none focus-visible:ring-2 focus-visible:ring-gold"
              />
              <Button type="submit" variant="primary" size="md" loading={starting} className="min-h-11">
                Start verification
              </Button>
            </form>
            {startError && (
              <p role="alert" className="text-sm text-danger-400">
                {startError}
              </p>
            )}

            {pending && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-5">
                <div>
                  <p className="text-sm text-white">
                    Add one of these to <span className="font-mono text-gold-light">{pending.domain}</span>, then check.
                  </p>
                  <p className="text-xs text-gray-500">Token expires {formatDate(pending.tokenExpiresAt)}. You only need one method.</p>
                </div>

                <div className="space-y-3 border-t border-white/5 pt-4">
                  <h3 className="text-sm font-semibold text-white">Option A: {DOMAIN_METHOD_LABELS.dns_txt}</h3>
                  <p className="text-xs text-gray-400">Type: {pending.instructions.dns_txt.type}</p>
                  <CopyField label="Name / host" value={pending.instructions.dns_txt.name} />
                  <CopyField label="Value" value={pending.instructions.dns_txt.value} />
                  {pending.instructions.dns_txt.note && <p className="text-xs text-gray-500">{pending.instructions.dns_txt.note}</p>}
                </div>

                <div className="space-y-3 border-t border-white/5 pt-4">
                  <h3 className="text-sm font-semibold text-white">Option B: {DOMAIN_METHOD_LABELS.well_known}</h3>
                  <CopyField label="Publish at" value={pending.instructions.well_known.url} />
                  <CopyField label="File content" value={pending.instructions.well_known.content} />
                </div>

                <div className="space-y-3 border-t border-white/5 pt-4">
                  <h3 className="text-sm font-semibold text-white">Option C: {DOMAIN_METHOD_LABELS.meta_tag}</h3>
                  <p className="text-xs text-gray-400">
                    Add inside the &lt;head&gt; of <span className="font-mono">{pending.instructions.meta_tag.url}</span>
                  </p>
                  <CopyField label="Tag" value={pending.instructions.meta_tag.tag} />
                </div>

                <div className="flex items-center gap-3 border-t border-white/5 pt-4">
                  <Button variant="primary" size="md" loading={checkingDomain === pending.domain} onClick={() => void runCheck(pending.domain)}>
                    Check now
                  </Button>
                </div>
                {pendingCheck && <CheckOutcome result={pendingCheck} />}
              </div>
            )}

            {domains.length > 0 && (
              <ul className="divide-y divide-white/5 rounded-2xl border border-white/10" aria-label="Your domains">
                {domains.map((d) => {
                  const result = pending?.domain === d.domain ? undefined : checkResults[d.domain];
                  return (
                    <li key={d.domain} className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-sm text-white">{d.domain}</span>
                        <StatusChip status={d.status} />
                        {d.method && <span className="text-xs text-gray-500">{DOMAIN_METHOD_LABELS[d.method] ?? d.method}</span>}
                        <span className="ml-auto flex flex-wrap items-center gap-2">
                          {d.status === 'verified' && d.receiptId && (
                            <a
                              className="text-xs text-gray-300 underline underline-offset-4 hover:text-white"
                              href={`/verify/r/${d.receiptId}`}
                            >
                              Receipt
                            </a>
                          )}
                          {d.status !== 'verified' && pending?.domain !== d.domain && (
                            <>
                              <Button variant="secondary" size="sm" loading={checkingDomain === d.domain} onClick={() => void runCheck(d.domain)}>
                                Check now
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={starting}
                                onClick={() =>
                                  requestConfirm(
                                    {
                                      title: `New token for ${d.domain}?`,
                                      description: 'This replaces the current token. A record, file, or tag you already added with the old token will stop matching.',
                                      confirmLabel: 'Get new token',
                                    },
                                    () => void start(d.domain),
                                  )
                                }
                              >
                                New token
                              </Button>
                            </>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => confirmRemove(d.domain)}>
                            Remove
                          </Button>
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {d.status === 'verified' ? `Verified ${formatDate(d.verifiedAt)}. ` : ''}Last checked {formatDate(d.lastCheckedAt)}.
                      </p>
                      {result && <CheckOutcome result={result} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Step 2: receipts */}
      <section className="space-y-5" aria-labelledby="trust-step-receipts">
        <div id="trust-step-receipts">
          <StepHeader step={2} title="Your receipts" done={receipts.some((r) => !r.revokedAt)} subtitle="Signed records of each check. Make one public to share it." />
        </div>

        {receiptState === 'loading' && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        )}
        {receiptState === 'disabled' && <NotEnabled what="Trust receipts" />}
        {receiptState === 'ready' && receipts.length === 0 && (
          <p className="text-sm text-gray-400">No receipts yet. Verify a domain to get your first one.</p>
        )}
        {receiptError && (
          <p role="alert" className="text-sm text-danger-400">
            {receiptError}
          </p>
        )}
        {receiptState === 'ready' && receipts.length > 0 && (
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10" aria-label="Your receipts">
            {receipts.map((r) => {
              const revoked = Boolean(r.revokedAt);
              const selfReported = r.payload.level === 'self_reported';
              return (
                <li key={r.id} className={`p-4 space-y-2 ${revoked ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{RECEIPT_CLAIM_LABELS[r.payload.claim] ?? r.payload.claim}</span>
                    <span className="font-mono text-xs text-gray-400">{r.payload.subject.id}</span>
                    {revoked && (
                      <span className="rounded-full border border-danger-500/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-danger-300">
                        Revoked
                      </span>
                    )}
                    {!revoked && (
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-gray-400">
                        {r.visibility === 'public' ? 'Public' : 'Private'}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs ${selfReported ? 'text-gray-300' : 'text-gray-400'}`}>
                    {levelSentence(r.payload.level)} Issued {formatDate(r.payload.issuedAt)}.
                    {revoked && ` Revoked ${formatDate(r.revokedAt)}${r.revokedReason ? `: ${r.revokedReason}` : ''}.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={revoked && r.visibility !== 'public'}
                      loading={receiptBusy === r.id}
                      onClick={() => void toggleVisibility(r)}
                      aria-pressed={r.visibility === 'public'}
                    >
                      {r.visibility === 'public' ? 'Make private' : 'Make public'}
                    </Button>
                    <CopyButton value={verifyLinkFor(r.id)} label="Copy verify link" />
                    <a className="text-xs text-gray-300 underline underline-offset-4 hover:text-white" href={`/verify/r/${r.id}`}>
                      Open
                    </a>
                    {r.visibility === 'private' && !revoked && (
                      <span className="text-xs text-gray-500">Only you can open a private link.</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2" aria-label="Coming next">
          <p className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Coming next</p>
          <ul className="divide-y divide-white/5 rounded-2xl border border-dashed border-white/10">
            {COMING_NEXT.map((item) => (
              <li key={item.title} className="flex items-start gap-3 p-4 text-gray-500" aria-disabled="true">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-white/20" aria-hidden="true" />
                <div>
                  <p className="text-sm">{item.title}</p>
                  <p className="text-xs text-gray-600">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
};

export default TrustCenterView;
