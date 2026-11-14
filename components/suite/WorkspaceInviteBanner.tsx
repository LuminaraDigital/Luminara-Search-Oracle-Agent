import React, { useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';

export type WorkspaceInviteNotice = {
  id: string;
  workspaceName: string;
  role: 'staff' | 'client_viewer';
};

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

export function WorkspaceInviteBanner() {
  const [invites, setInvites] = useState<WorkspaceInviteNotice[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const base = apiBase();
    if (!base) return;
    let cancelled = false;
    workerFetchWithAuthRetry(`${base}/api/workspaces/invites`)
      .then(async (response) => {
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as { invites?: WorkspaceInviteNotice[] };
        setInvites(Array.isArray(body.invites) ? body.invites : []);
      })
      .catch(() => {
        if (!cancelled) setInvites([]);
      });
    return () => {
      cancelled = true;
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

  return (
    <>
      <InviteBannerList
        invites={invites}
        busyId={busyId}
        onAccept={(id) => void answer(id, 'accept')}
        onDecline={(id) => void answer(id, 'decline')}
      />
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-warning-300">
          {error}
        </p>
      ) : null}
    </>
  );
}
