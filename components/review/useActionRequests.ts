import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';

/** One row of GET /api/mcp-action-requests (worker/mcpGovernance.ts ActionRequestRow, minus the user id). */
export interface ActionRequestRow {
  id: string;
  project_id: string | null;
  tool_name: string;
  args_json: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  kind: 'tool' | 'budget_override';
  decided_at: number | null;
  expires_at: number;
  created_at: number;
}

/** GET /api/mcp-action-requests/:id: what approving does and the site, worded by the worker. */
export interface ActionRequestDetail {
  id: string;
  toolName: string;
  domain: string | null;
  args: string;
  argsTruncated: boolean;
  consequence: string;
  status: ActionRequestRow['status'];
  expiresAt: number;
}

export type Decision = 'approve' | 'deny';
export type DecideResult = 'approved' | 'denied' | 'conflict' | 'signedOut' | 'error';

const POLL_MS = 60_000;

/** The action as a question to the owner. Unknown tools fall back to their name. */
const ACTION_QUESTIONS: Record<string, string> = {
  prepare_cms_mcp_call: 'Prepare a change to your website?',
  browse_goal: 'Let the hosted browser carry out a goal on your site?',
  browse_close: 'Close a hosted browser session?',
  decide_booking_signoff: 'Decide on a proposed appointment?',
};

export function actionQuestion(row: Pick<ActionRequestRow, 'tool_name' | 'kind'>): string {
  if (row.kind === 'budget_override') return 'Go past this run’s spending cap?';
  const known = ACTION_QUESTIONS[row.tool_name];
  if (known) return known;
  const words = row.tool_name.replace(/_/g, ' ').trim();
  return `Run “${words}” once?`;
}

export function isOpen(row: Pick<ActionRequestRow, 'status' | 'expires_at'>, now = Date.now()): boolean {
  return row.status === 'pending' && row.expires_at > now;
}

function call(path: string, init?: RequestInit): Promise<Response> {
  return workerFetchWithAuthRetry(`${apiBase()}/api${path}`, init);
}

/**
 * The account's agent action requests, refreshed every minute and when the tab regains focus.
 * Signed-out visitors get an empty list and no requests are made.
 */
export function useActionRequests(signedIn: boolean) {
  const [rows, setRows] = useState<ActionRequestRow[]>([]);
  const [details, setDetails] = useState<Record<string, ActionRequestDetail>>({});
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const detailsRef = useRef(details);
  detailsRef.current = details;

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setState((s) => (s === 'ready' ? s : 'loading'));
    try {
      const res = await call('/mcp-action-requests?limit=50');
      const body = res.ok ? await res.json() : null;
      const list: ActionRequestRow[] = Array.isArray(body?.requests) ? body.requests : [];
      setRows(list);
      setState(res.ok ? 'ready' : 'error');
      // The worker words the consequence and names the site, so open tool requests are read one by one.
      const missing = list.filter((r) => r.kind === 'tool' && isOpen(r) && !detailsRef.current[r.id]).slice(0, 10);
      const fetched = await Promise.all(missing.map(async (r) => {
        try {
          const one = await call(`/mcp-action-requests/${encodeURIComponent(r.id)}`);
          const data = one.ok ? await one.json() : null;
          return data?.request ? (data.request as ActionRequestDetail) : null;
        } catch {
          return null;
        }
      }));
      const add = fetched.filter((d): d is ActionRequestDetail => d !== null);
      if (add.length) setDetails((prev) => Object.fromEntries([...Object.entries(prev), ...add.map((d) => [d.id, d])]));
    } catch {
      setState('error');
    }
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) {
      setRows([]);
      setDetails({});
      setState('idle');
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [signedIn, refresh]);

  const decide = useCallback(async (id: string, decision: Decision): Promise<DecideResult> => {
    try {
      const res = await call(`/mcp-action-requests/${encodeURIComponent(id)}/${decision}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15000),
      });
      void refresh();
      if (res.ok) return decision === 'approve' ? 'approved' : 'denied';
      if (res.status === 409 || res.status === 404) return 'conflict';
      if (res.status === 401) return 'signedOut';
      return 'error';
    } catch {
      return 'error';
    }
  }, [refresh]);

  const open = rows.filter((r) => r.kind === 'tool' && isOpen(r));
  return { rows, open, details, state, refresh, decide };
}
