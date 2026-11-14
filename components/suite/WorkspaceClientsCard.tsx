import React, { useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';

type ClientCard = {
  clientId: string;
  name: string;
  domain: string;
  latestAudit: { measurement: 'measured'; score: number } | { measurement: 'not_measured'; score: null };
  monitor: 'on' | 'off' | 'not_set';
};

const MONITOR_LABEL = { on: 'On', off: 'Off', not_set: 'Not set' } as const;

export function WorkspaceClientsCard({ signedIn }: { signedIn: boolean }) {
  const [clients, setClients] = useState<ClientCard[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const base = apiBase();
    if (!base) return;
    workerFetchWithAuthRetry(`${base}/api/workspaces/current/clients`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404) {
          setMissing(true);
          setClients([]);
          return;
        }
        if (!response.ok) {
          setError('Could not load clients.');
          setClients([]);
          return;
        }
        const body = (await response.json()) as { clients?: ClientCard[] };
        setClients(body.clients || []);
        setMissing(false);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load clients.');
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn) return null;

  async function createWorkspace() {
    const base = apiBase();
    if (!base || !name.trim()) return;
    setError('');
    const response = await workerFetchWithAuthRetry(`${base}/api/workspaces/current`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!response.ok) {
      setError('Could not create the workspace.');
      return;
    }
    setMissing(false);
    setClients([]);
  }

  return (
    <section className="mb-10 mkt-chassis p-6" aria-labelledby="workspace-clients-heading">
      <h2 id="workspace-clients-heading" className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--color-accent)]">
        Clients
      </h2>
      <p className="text-sm text-[var(--color-ink-2)] mt-1">Latest audit score and whether the scheduled check is on.</p>
      {error && (
        <p className="text-sm text-warning-300 mt-3" role="alert">
          {error}
        </p>
      )}
      {clients === null && !error && (
        <p className="text-sm text-[var(--color-ink-2)] mt-3" aria-busy="true">
          Loading clients.
        </p>
      )}
      {missing && (
        <form
          className="mt-4 flex flex-col sm:flex-row gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createWorkspace();
          }}
        >
          <label className="text-xs text-[var(--color-ink-2)] flex-1 flex flex-col gap-1">
            Workspace name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="bg-black/60 border border-[var(--color-rule)] text-[var(--color-ink)] text-sm px-2 py-2 min-h-11"
              required
            />
          </label>
          <button type="submit" className="lx-btn lx-btn-gold self-end">
            Create workspace
          </button>
        </form>
      )}
      {clients && clients.length === 0 && !missing && (
        <p className="text-sm text-[var(--color-ink)] mt-3">No clients yet.</p>
      )}
      {clients && clients.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--color-rule)]">
          {clients.map((client) => (
            <li key={client.clientId || client.domain} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <div>
                <p className="text-sm text-[var(--color-ink)]">{client.clientId ? client.name : 'This account'}</p>
                <p className="text-xs text-[var(--color-ink-2)]">{client.domain}</p>
              </div>
              <p className="text-sm text-[var(--color-ink)]">
                {client.latestAudit.measurement === 'measured' ? `Score ${client.latestAudit.score}` : 'Not measured'}
                {' - '}
                Check {MONITOR_LABEL[client.monitor]}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
