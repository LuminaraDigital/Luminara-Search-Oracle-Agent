import React, { useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { Button } from '../ui/Button';

/** Opt in to the weekly homepage email. The send still needs an email on the account. */
export const WeeklyReportToggle: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [hasEmail, setHasEmail] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const base = apiBase();
    if (!base) return;
    void workerFetchWithAuthRetry(`${base}/api/email/weekly-report`).then(async (res) => {
      if (!res.ok) return;
      const data = (await res.json()) as { enabled?: boolean; hasEmail?: boolean };
      setEnabled(Boolean(data.enabled));
      setHasEmail(data.hasEmail !== false);
    });
  }, []);

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Weekly visibility email</h2>
      <p>
        Once a week we re-read the public homepage of your latest saved audit and email what changed, plus one next fix.
        It uses one audit from that day&apos;s allowance. Rankings and Google Business Profile are not measured.
      </p>
      {hasEmail ? null : <p>Add an email address on this account before the weekly report can be sent.</p>}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !hasEmail}
        onClick={() => {
          const base = apiBase();
          if (!base) return;
          setBusy(true);
          setNote(null);
          const next = !enabled;
          void workerFetchWithAuthRetry(`${base}/api/email/weekly-report`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: next }),
          }).then(async (res) => {
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; enabled?: boolean };
            if (!res.ok || !data.ok) setNote(data.error || 'That did not work. Try again.');
            else {
              setEnabled(Boolean(data.enabled));
              setNote(data.enabled ? 'The weekly email is on. Each email has an unsubscribe link.' : 'The weekly email is off.');
            }
            setBusy(false);
          });
        }}
      >
        {enabled ? 'Turn off the weekly email' : 'Email me the weekly read'}
      </Button>
      {note ? <p role="status">{note}</p> : null}
    </section>
  );
};

/** Search Console connect. The route answers 404 while the flag is off. */
export const GscConnectPanel: React.FC = () => {
  const [mode, setMode] = useState<'loading' | 'off' | 'ready' | 'connected'>('loading');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const base = apiBase();
    if (!base) return;
    void workerFetchWithAuthRetry(`${base}/api/gsc/status`).then(async (res) => {
      if (res.status === 404) {
        setMode('off');
        return;
      }
      if (!res.ok) {
        setMode('off');
        return;
      }
      const data = (await res.json()) as { connected?: boolean };
      setMode(data.connected ? 'connected' : 'ready');
    });
  }, []);

  if (mode === 'loading') return null;
  if (mode === 'off') {
    return (
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Search Console</h2>
        <p>Search Console connect is off until Google verifies the read-only scope. A CSV upload in Instant Audit still works.</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Search Console</h2>
      <p>Read-only. The connection cannot change your Search Console property.</p>
      {mode === 'connected' ? <p>Connected.</p> : null}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          const base = apiBase();
          if (!base) return;
          setNote(null);
          if (mode === 'connected') {
            void workerFetchWithAuthRetry(`${base}/api/gsc/disconnect`, { method: 'POST' }).then(async (res) => {
              if (!res.ok) setNote('Could not disconnect.');
              else setMode('ready');
            });
            return;
          }
          void workerFetchWithAuthRetry(`${base}/api/gsc/connect`, { method: 'POST' }).then(async (res) => {
            const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
            if (!res.ok || !data.url) setNote(data.error || 'Could not start the connection.');
            else window.location.assign(data.url);
          });
        }}
      >
        {mode === 'connected' ? 'Disconnect Search Console' : 'Connect Search Console'}
      </Button>
      {note ? <p role="status">{note}</p> : null}
    </section>
  );
};
