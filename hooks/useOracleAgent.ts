import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  decideOracleAction,
  getServerHealthSync,
  loadOracleActions,
  loadServerHealth,
  type streamOracleChat,
} from '../services/apiClient';
import { listSeoProjects } from '../services/projects/projectClient';
import type { Message, OracleApprovalCardData, OracleStep } from '../types';

type OracleEvent = ReturnType<typeof streamOracleChat> extends AsyncGenerator<infer E> ? E : never;

/** After the server closes the step-by-step Oracle (a cap, or no answer), use the simple chat this long. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
let closedUntil = 0;

/** Steps and approval cards collected from one Oracle reply's stream. */
export function createOracleTurnCollector() {
  let steps: OracleStep[] = [];
  const cards: OracleApprovalCardData[] = [];
  return {
    onEvent(ev: OracleEvent): void {
      if (ev.type === 'error' && (ev.code === 'AGENT_CAP' || ev.fallback)) closedUntil = Date.now() + RETRY_AFTER_MS;
      if (ev.type === 'tool' && ev.stage === 'needs_approval' && ev.actionId) {
        cards.push({
          actionId: ev.actionId,
          preview: ev.preview || '',
          costNote: ev.costNote || '',
          tainted: ev.tainted !== false,
          // The server always sends the session object's expiry; a card without one is not shown as live.
          expiresAt: ev.expiresAt ?? 0,
          status: 'pending',
        });
      }
      if (ev.type === 'done' && ev.receipts) {
        steps = ev.receipts.map((r) => ({ summary: r.summary, status: r.status, measured: r.measured }));
      }
    },
    reset(): void {
      steps = [];
      cards.length = 0;
    },
    /** Fields to set on the reply message, or null when there is nothing to show. */
    extras(): Pick<Message, 'oracleSteps' | 'approvalCards'> | null {
      return steps.length > 0 || cards.length > 0 ? { oracleSteps: steps, approvalCards: [...cards] } : null;
    },
  };
}

/**
 * Oracle chat's step-by-step mode on the client: whether it is open, which project it reads,
 * pending cards after a reload, and deciding a card. Agency keeps the server chat regardless.
 */
export function useOracleAgent(opts: { authenticated: boolean; setMessages: Dispatch<SetStateAction<Message[]>> }) {
  const { authenticated, setMessages } = opts;

  const isOpen = useCallback(() => getServerHealthSync().oracleAgent === true && Date.now() >= closedUntil, []);

  // The account's only project, or its most recently updated one; the step list names the domain
  // it read. A failed lookup is not remembered, so the next message tries again.
  const projectRef = useRef<{ forAuth: boolean; id: string } | null>(null);
  const resolveProjectId = useCallback(async (): Promise<string | null> => {
    if (projectRef.current?.forAuth === authenticated) return projectRef.current.id;
    try {
      const projects = await listSeoProjects();
      const id = [...projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.id ?? null;
      if (id) projectRef.current = { forAuth: authenticated, id };
      return id;
    } catch {
      return null;
    }
  }, [authenticated]);

  // Cards survive a reload: show the session's pending cards once after sign-in.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!authenticated || hydratedRef.current) return;
    let cancelled = false;
    void (async () => {
      const health = await loadServerHealth();
      if (cancelled || health.oracleAgent !== true) return;
      const pending = (await loadOracleActions()).filter((a) => a.status === 'pending' && a.expiresAt > Date.now());
      if (cancelled || pending.length === 0) return;
      hydratedRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          id: `oracle-pending-${Date.now()}`,
          role: 'model',
          content: pending.length === 1 ? 'One action is waiting for your approval.' : `${pending.length} actions are waiting for your approval.`,
          timestamp: Date.now(),
          approvalCards: pending.map((a) => ({
            actionId: a.actionId,
            preview: a.preview,
            costNote: a.costNote,
            tainted: a.tainted,
            expiresAt: a.expiresAt,
            status: a.status,
            summary: a.summary,
          })),
        },
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, setMessages]);

  /** Decide a card, show the outcome on it, and continue the chat when it was decided. */
  const decide = useCallback(
    async (messageId: string, actionId: string, approved: boolean, onContinue: (actionId: string, approved: boolean) => void) => {
      const res = await decideOracleAction(actionId, approved).catch(() => ({ ok: false, status: 'network', summary: undefined, action: undefined }));
      // A network failure decided nothing: the card stays pending so the user can try again.
      const status = res.status === 'network' ? 'pending' : res.action?.status || res.status;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                approvalCards: m.approvalCards?.map((c) =>
                  c.actionId === actionId
                    ? {
                        ...c,
                        status,
                        summary:
                          res.summary ??
                          res.action?.summary ??
                          (res.status === 'network' ? 'Could not reach Luminara. Nothing was decided; try again.' : null),
                      }
                    : c,
                ),
              }
            : m,
        ),
      );
      if (status === 'approved_done' || status === 'denied') onContinue(actionId, approved);
    },
    [setMessages],
  );

  return { isOpen, resolveProjectId, decide };
}
