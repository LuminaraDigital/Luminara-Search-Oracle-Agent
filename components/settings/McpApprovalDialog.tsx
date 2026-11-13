import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { Button } from '../ui/Button';

interface ActionRequest {
  id: string;
  toolName: string;
  domain: string | null;
  args: string;
  consequence: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  expiresAt: number;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; request: ActionRequest }
  | { kind: 'notFound' }
  | { kind: 'error' };

type Outcome = 'approved' | 'denied' | 'conflict' | 'error' | null;

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function call(path: string, init?: RequestInit): Promise<Response> {
  return workerFetchWithAuthRetry(`${apiBase()}/api${path}`, init);
}

function prettyArgs(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function timeLeft(expiresAt: number): string {
  const minutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000));
  return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function statusMessage(load: Load, outcome: Outcome): string | null {
  if (load.kind === 'loading') return 'Loading the request.';
  if (load.kind === 'notFound') return 'This request was not found. It may belong to a different Luminara account, or the link is wrong.';
  if (load.kind === 'error') return 'The request could not be loaded. Check your connection and try again.';
  if (outcome === 'approved') return 'Approved. Go back to your agent and ask it to continue.';
  if (outcome === 'denied') return 'Denied. Nothing was run.';
  if (outcome === 'conflict') return 'This request was already decided or has expired. Ask the agent to try again.';
  if (outcome === 'error') return 'The decision could not be sent. Check your connection and try again.';
  const { status, expiresAt } = load.request;
  if (status === 'denied') return 'This request was already denied.';
  if (status === 'approved') return 'This request was already approved.';
  if (status === 'consumed') return 'This request was already approved and used.';
  if (expiresAt <= Date.now()) return 'This request has expired. Ask the agent to try again.';
  return null;
}

/** Opened by ?mcp_approval=<id>: the owner reviews one agent action and approves or denies it once. */
export const McpApprovalDialog: React.FC<{ requestId: string; onClose: () => void }> = ({ requestId, onClose }) => {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [deciding, setDeciding] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const path = `/mcp-action-requests/${encodeURIComponent(requestId)}`;

  const fetchRequest = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const res = await call(path);
      if (res.status === 404) return setLoad({ kind: 'notFound' });
      const body = res.ok ? await res.json() : null;
      setLoad(body?.request ? { kind: 'ready', request: body.request as ActionRequest } : { kind: 'error' });
    } catch {
      setLoad({ kind: 'error' });
    }
  }, [path]);

  useEffect(() => {
    void fetchRequest();
  }, [fetchRequest]);

  const decide = async (decision: 'approve' | 'deny', domain: string | null) => {
    if (deciding) return;
    setDeciding(true);
    try {
      const res = await call(`${path}/${decision}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decision === 'deny' ? { reason: '', domain } : {}),
      });
      setOutcome(res.ok ? (decision === 'approve' ? 'approved' : 'denied') : res.status === 409 ? 'conflict' : 'error');
    } catch {
      setOutcome('error');
    } finally {
      setDeciding(false);
    }
  };

  // Same focus handling as ConfirmModal, which cannot be reused here because it has only two buttons and Escape would deny.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (!first) return e.preventDefault();
        if (e.shiftKey && (active === first || active === dialogRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  const message = statusMessage(load, outcome);
  const request = load.kind === 'ready' && !message ? load.request : null;
  const retry = load.kind === 'error' ? fetchRequest : outcome === 'error' ? () => setOutcome(null) : null;
  const rowClass = 'flex justify-between gap-4 py-1';

  return (
    <div
      className="fixed inset-0 z-[200] overflow-y-auto flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="glass-morphism rounded-2xl shadow-2xl w-full max-w-md my-auto overflow-hidden bg-black/95 border border-gold/40 outline-none"
      >
        <div className="px-6 py-4 border-b bg-gradient-to-r from-gold/20 to-transparent border-gold/20">
          <h3 id={titleId} className="text-sm font-bold uppercase tracking-widest text-gold-light">
            {request ? 'An agent is asking for your approval' : 'Agent approval'}
          </h3>
        </div>
        <div className="px-6 py-4 text-xs text-gray-300 leading-relaxed" aria-live="polite">
          {request ? (
            <>
              <p className="mb-3">{request.consequence}</p>
              <dl className="mb-3">
                <div className={rowClass}><dt className="text-gray-400">Action</dt><dd className="text-white break-all text-right">{request.toolName}</dd></div>
                <div className={rowClass}><dt className="text-gray-400">Site</dt><dd className="text-white break-all text-right">{request.domain ?? 'Not tied to a site'}</dd></div>
                <div className={rowClass}><dt className="text-gray-400">Expires</dt><dd className="text-white text-right">{timeLeft(request.expiresAt)}</dd></div>
              </dl>
              <span className="block mb-1 text-gray-400">Details the agent sent</span>
              <pre className="mb-3 max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/60 p-2 font-mono text-[11px] whitespace-pre-wrap break-all">{prettyArgs(request.args)}</pre>
              <p>Approve only if you asked an agent to do this. This allows it once.</p>
            </>
          ) : (
            <p>{message}</p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-white/5 bg-black/40 flex items-center justify-end gap-3">
          {request ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={deciding}>Close</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void decide('deny', request.domain)} disabled={deciding}>Deny</Button>
              <Button type="button" variant="primary" size="sm" onClick={() => void decide('approve', request.domain)} disabled={deciding}>Approve once</Button>
            </>
          ) : (
            <>
              {retry && <Button type="button" variant="secondary" size="sm" onClick={() => void retry()}>Try again</Button>}
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
