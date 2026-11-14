import React, { useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';

export type WorkspaceInviteNotice = {
  id: string;
  workspaceName: string;
  role: 'staff' | 'client_viewer';
};

export const VERIFY_INVITE_COPY = 'You have a workspace invite. Verify your email to accept it.';

export function showsVerifyInviteBanner(body: {
  emailVerified?: boolean;
  pendingInviteCount?: number;
}): boolean {
  return body.emailVerified === false && typeof body.pendingInviteCount === 'number' && body.pendingInviteCount > 0;
}

function roleLabel(role: WorkspaceInviteNotice['role']): string {
  return role === 'client_viewer' ? 'a client viewer' : 'staff';
}

export function InviteBannerList({
  invites,
  busyId,
  onAccept,
  onDecline,
}: {
  invites: WorkspaceInviteNotice[];
  busyId: string | null;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  if (invites.length === 0) return null;
  return (
    <div role="region" aria-label="Workspace invites" className="shrink-0 border-b border-[color:var(--color-rule)] bg-[var(--color-paper)] px-4 py-3 space-y-2">
      {invites.map((invite) => (
        <div key={invite.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-ink)]">
            {invite.workspaceName} invited you as {roleLabel(invite.role)}.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="lx-btn lx-btn-gold min-h-11"
              disabled={busyId === invite.id}
              onClick={() => onAccept(invite.id)}
            >
              Accept
            </button>
            <button
              type="button"
              className="lx-btn min-h-11"
              disabled={busyId === invite.id}
              onClick={() => onDecline(invite.id)}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VerifyEmailInviteNotice({
  busy,
  onResend,
}: {
  busy: boolean;
  onResend: () => void;
}) {
  return (
    <div role="region" aria-label="Workspace invites" className="shrink-0 border-b border-[color:var(--color-rule)] bg-[var(--color-paper)] px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--color-ink)]">{VERIFY_INVITE_COPY}</p>
        <button type="button" className="lx-btn lx-btn-gold min-h-11" disabled={busy} onClick={onResend}>
          Resend verification email
        </button>
      </div>
    </div>
  );
}

type InviteListBody = {
  invites?: WorkspaceInviteNotice[];
  emailVerified?: boolean;
  pendingInviteCount?: number;
};

export function WorkspaceInviteBanner() {
  const [invites, setInvites] = useState<WorkspaceInviteNotice[]>([]);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const base = apiBase();
    if (!base || typeof window === 'undefined') return;
    let cancelled = false;
    let generation = 0;

    async function load(refreshToken: boolean) {
      const ticket = ++generation;
      if (refreshToken) {
        // The ID token keeps the old email_verified claim until a forced refresh.
        const { getFirebaseIdToken } = await import('../../services/auth/firebaseAuthService');
        await getFirebaseIdToken(true).catch(() => undefined);
      }
      if (cancelled || ticket !== generation) return;
      try {
        const response = await workerFetchWithAuthRetry(`${base}/api/workspaces/invites`);
        if (cancelled || ticket !== generation || !response.ok) return;
        const body = (await response.json()) as InviteListBody;
        if (cancelled || ticket !== generation) return;
        setNeedsVerify(showsVerifyInviteBanner(body));
        setInvites(Array.isArray(body.invites) ? body.invites : []);
      } catch {
        if (!cancelled && ticket === generation) {
          setNeedsVerify(false);
          setInvites([]);
        }
      }
    }

    void load(false);
    const onVisible = () => {
      if (document.visibilityState === 'hidden') return;
      void load(true);
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function answer(id: string, decision: 'accept' | 'decline') {
    const base = apiBase();
    if (!base) return;
    setBusyId(id);
    setError('');
    const response = await workerFetchWithAuthRetry(`${base}/api/workspaces/invites/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
    });
    setBusyId(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error || 'Could not update the invite.');
      return;
    }
    setInvites((current) => current.filter((invite) => invite.id !== id));
  }

  async function resend() {
    const base = apiBase();
    if (!base) return;
    setResendBusy(true);
    setError('');
    setNote('');
    const response = await workerFetchWithAuthRetry(`${base}/api/auth/send-verification`, { method: 'POST' });
    setResendBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error || 'Could not send the verification email.');
      return;
    }
    setNote('Check your inbox for the verification email, then come back to this tab.');
  }

  return (
    <>
      {needsVerify ? (
        <VerifyEmailInviteNotice busy={resendBusy} onResend={() => void resend()} />
      ) : (
        <InviteBannerList
          invites={invites}
          busyId={busyId}
          onAccept={(id) => void answer(id, 'accept')}
          onDecline={(id) => void answer(id, 'decline')}
        />
      )}
      {note ? <p className="px-4 py-2 text-sm text-[var(--color-ink)]">{note}</p> : null}
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-warning-300">
          {error}
        </p>
      ) : null}
    </>
  );
}
