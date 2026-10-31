import React, { useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { LUMEN_PUBLIC_NOTE } from '../../services/lumen/lumenCopy';

type LumenEntry = { id: string; label: string };
type LumenView = { balance: number; entries: LumenEntry[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseLumenView(data: unknown): LumenView | null {
  if (!isRecord(data) || data.ok !== true || typeof data.balance !== 'number') return null;
  const entries: LumenEntry[] = [];
  if (Array.isArray(data.entries)) {
    for (const row of data.entries) {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.label !== 'string') continue;
      entries.push({ id: row.id, label: row.label });
    }
  }
  return { balance: data.balance, entries };
}

export async function fetchLumenBalance(): Promise<LumenView | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/lumen`);
    if (!res.ok) return null;
    return parseLumenView(await res.json());
  } catch {
    return null;
  }
}

/** Settings balance. The number refreshes while the panel is open. No price. */
export const LumenBalance: React.FC = () => {
  const [view, setView] = useState<LumenView | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => {
      void fetchLumenBalance().then((next) => {
        if (!stop && next) setView(next);
      });
    };
    load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="space-y-1" aria-live="polite">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Lumen</h2>
      <p className="text-2xl tabular-nums text-white">{view ? view.balance : '...'}</p>
      <p>{LUMEN_PUBLIC_NOTE}</p>
      {view?.entries.slice(0, 3).map((entry) => (
        <p key={entry.id} className="text-xs text-gray-400">{entry.label}</p>
      ))}
    </section>
  );
};
