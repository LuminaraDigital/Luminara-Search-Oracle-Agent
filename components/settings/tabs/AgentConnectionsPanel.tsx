import React, { useCallback, useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../../services/apiClient';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';

type AgentConnection = { id: string; name: string; scope: string; createdAt: number };

/** Agents the owner approved through OAuth (Grok connectors, IDEs). Revoking ends the token at once. */
export const AgentConnectionsPanel: React.FC = () => {
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AgentConnection | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const base = apiBase();
    if (!base) return;
    try {
      const r = await workerFetchWithAuthRetry(`${base}/api/agent-connections`, { method: 'GET' });
      if (r.status === 401) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { connections?: AgentConnection[] };
      setConnections(data.connections ?? []);
      setError(null);
    } catch {
      setError('Could not load connected agents. Try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (target: AgentConnection) => {
    setRevokingId(target.id);
    try {
      const r = await workerFetchWithAuthRetry(`${apiBase()}/api/agent-connections/${target.id}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
      setConnections((rows) => rows.filter((row) => row.id !== target.id));
    } catch {
      setError(`Could not disconnect ${target.name}. Try again.`);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-2 pt-2">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-400">Connected agents</h3>
      {error && (
        <p className="text-[11px] text-danger-300 leading-relaxed" role="alert">
          {error}
        </p>
      )}
      {connections.length === 0 && !error ? (
        <p className="text-[11px] text-gray-400 leading-relaxed" role="status">
          No agents connected. Add {apiBase()}/api/mcp as a connector in your agent to start.
        </p>
      ) : (
        <ul className="space-y-2">
          {connections.map((c) => (
            <li
              key={c.id}
              className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <span className="block text-xs font-bold text-gray-200 truncate">{c.name}</span>
                <span className="block text-[10px] font-mono text-gray-400">
                  connected {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="shrink-0 text-danger-400 hover:text-danger-300 hover:bg-danger-500/10"
                onClick={() => setRevokeTarget(c)}
                loading={revokingId === c.id}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        open={revokeTarget !== null}
        title="Disconnect this agent?"
        description={revokeTarget ? `"${revokeTarget.name}" loses access to your account. It must ask you again to reconnect.` : undefined}
        confirmLabel="Disconnect"
        variant="danger"
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          const target = revokeTarget;
          setRevokeTarget(null);
          if (target) void revoke(target);
        }}
      />
    </div>
  );
};
