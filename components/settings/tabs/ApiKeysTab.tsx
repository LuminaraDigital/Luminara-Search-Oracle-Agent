import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../../services/apiClient';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import {
  ApiKeyRow,
  EMPTY_STATE_COPY,
  REVEAL_ONCE_WARNING,
  formatKeyRow,
  parseApiKeyList,
  redactKey,
} from './apiKeysTabUtils';

type CreatedKey = { key: string; name: string };

/**
 * Settings tab for Luminara-hosted MCP API keys (lm_live_*). The full key is
 * returned by the server only once, at creation: it lives exclusively in the
 * `created` state below and is wiped when the reveal modal closes. List and
 * revoke calls only ever touch id / name / prefix metadata.
 */
export const ApiKeysTab: React.FC = () => {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const base = apiBase();
    if (!base) {
      setLoading(false);
      return;
    }
    try {
      const r = await workerFetchWithAuthRetry(`${base}/api/api-keys`, { method: 'GET' });
      if (r.status === 401) {
        setSignedOut(true);
        setKeys([]);
        return;
      }
      if (r.status === 403) {
        setAccessDenied(true);
        setKeys([]);
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSignedOut(false);
      setAccessDenied(false);
      setKeys(parseApiKeyList(await r.json()));
    } catch (e) {
      setError('Could not load API keys. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(copyTimer.current);
  }, [load]);

  const createKey = async () => {
    const base = apiBase();
    if (!base || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await workerFetchWithAuthRetry(`${base}/api/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'MCP key' }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        key?: string;
        error?: string;
      };
      if (!r.ok || !data.ok || typeof data.key !== 'string') {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      // Reveal-once: full material goes into the modal, never the row list.
      setCreated({ key: data.key, name: name.trim() || 'MCP key' });
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Key creation failed.');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (row: ApiKeyRow) => {
    const base = apiBase();
    if (!base || revokingId) return;
    setRevokingId(row.id);
    setError(null);
    try {
      const r = await workerFetchWithAuthRetry(`${base}/api/api-keys/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setKeys((prev) => prev.filter((k) => k.id !== row.id));
    } catch {
      setError('Revoke failed. Try again.');
    } finally {
      setRevokingId(null);
    }
  };

  const copyCreated = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed. Select the key text and copy it manually.');
    }
  };

  const closeReveal = () => {
    setCreated(null);
    setCopied(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">
        Hosted keys let MCP clients (Cursor, Claude, the Luminara plugin) call your account. Key material exists only in the reveal dialog after you create it; after that the server stores a hash and shows just the prefix.
      </p>

      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
        <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-400" htmlFor="mcp-api-key-name">
          New key name
        </label>
        <div className="flex items-center gap-2">
          <input
            id="mcp-api-key-name"
            type="text"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cursor on my laptop"
            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-gray-200 placeholder:text-gray-600 outline-none focus-visible:ring-2 focus-visible:ring-gold"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={createKey}
            loading={creating}
            disabled={creating || !apiBase()}
          >
            Create key
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-danger-300 leading-relaxed" role="alert">
          {error}
        </p>
      )}
      {signedOut && (
        <p className="text-[11px] text-gray-400 leading-relaxed" role="status">
          Sign in (Overview tab) to manage hosted MCP keys.
        </p>
      )}
      {accessDenied && (
        <p className="text-[11px] text-warning-300 leading-relaxed" role="status">
          API keys require the Growth or Agency plan. Upgrade to create and manage hosted MCP keys.
        </p>
      )}

      {loading ? (
        <p className="text-[11px] text-gray-500" role="status">Loading keys…</p>
      ) : !signedOut && !accessDenied && keys.length === 0 ? (
        <p className="text-[11px] text-gray-400 leading-relaxed" role="status">
          {EMPTY_STATE_COPY}
        </p>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => {
            const fmt = formatKeyRow(k);
            return (
              <li
                key={k.id}
                className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-gray-200 truncate">{fmt.label}</span>
                  <span className="block text-[10px] font-mono text-gray-400">
                    {redactKey(k.prefix)} · created {fmt.created} · {fmt.lastUsed}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-danger-400 hover:text-danger-300 hover:bg-danger-500/10"
                  onClick={() => setRevokeTarget(k)}
                  loading={revokingId === k.id}
                >
                  Revoke
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Reveal-once dialog: the ONLY place the full key ever exists client-side. */}
      {created && (
        <div
          className="fixed inset-0 z-[210] overflow-y-auto flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeReveal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Key created"
            className="glass-morphism rounded-2xl shadow-2xl w-full max-w-md my-auto overflow-hidden bg-black/95 border border-gold/40 animate-in zoom-in-95 duration-200"
          >
            <div className="px-6 py-4 border-b bg-gradient-to-r from-gold/20 to-transparent border-gold/20">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gold-light">
                Key created: {created.name}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-xs text-warning-300 leading-relaxed font-bold">{REVEAL_ONCE_WARNING}</p>
              <p className="px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-gray-100 break-all select-all">
                {created.key}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-white/5 bg-black/40 flex items-center justify-end gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={copyCreated}>
                {copied ? 'Copied' : 'Copy key'}
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={closeReveal}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={revokeTarget !== null}
        title="Revoke this key?"
        description={
          revokeTarget
            ? `"${revokeTarget.name}" (${redactKey(revokeTarget.prefix)}) stops working immediately. Clients using it will get 401. This cannot be undone.`
            : undefined
        }
        confirmLabel="Revoke key"
        variant="danger"
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          const target = revokeTarget;
          setRevokeTarget(null);
          if (target) void revokeKey(target);
        }}
      />
    </div>
  );
};
