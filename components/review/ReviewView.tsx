import React, { useState } from 'react';
import { ICONS } from '../../constants';
import {
  actionQuestion,
  isOpen,
  type ActionRequestDetail,
  type ActionRequestRow,
  type DecideResult,
  type Decision,
} from './useActionRequests';

interface ReviewViewProps {
  signedIn: boolean;
  onSignIn: () => void;
  rows: ActionRequestRow[];
  open: ActionRequestRow[];
  details: Record<string, ActionRequestDetail>;
  state: 'idle' | 'loading' | 'ready' | 'error';
  onRefresh: () => void;
  onDecide: (id: string, decision: Decision) => Promise<DecideResult>;
}

function prettyArgs(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function minutesLeft(expiresAt: number): string {
  const m = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000));
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const OUTCOME_TEXT: Record<DecideResult, string> = {
  approved: 'Go back to your agent and ask it to continue.',
  denied: 'Nothing ran.',
  conflict: 'This request was already decided or has expired. Ask the agent to try again.',
  signedOut: 'Your sign-in has ended. Sign in again, then reopen Review.',
  error: 'The decision could not be sent. Check your connection and try again.',
};

function statusWord(row: ActionRequestRow): { text: string; color: string } {
  if (row.status === 'approved') return { text: 'Approved', color: 'var(--lg-ok)' };
  if (row.status === 'consumed') return { text: 'Approved and used', color: 'var(--lg-ok)' };
  if (row.status === 'denied') return { text: 'Denied', color: 'var(--lg-fg-3)' };
  return { text: 'Expired', color: 'var(--lg-fg-3)' };
}

const ApprovalCard: React.FC<{
  row: ActionRequestRow;
  detail?: ActionRequestDetail;
  onDecide: ReviewViewProps['onDecide'];
}> = ({ row, detail, onDecide }) => {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DecideResult | null>(null);
  const reviewable = detail ? !detail.argsTruncated : false;

  const decide = async (d: Decision) => {
    if (busy) return;
    setBusy(true);
    setOutcome(await onDecide(row.id, d));
    setBusy(false);
  };

  return (
    <article className="lg-card lg-approve" aria-labelledby={`req-${row.id}`}>
      <div className="lg-approve-h">
        <span className="lg-pill">Waiting for you · expires in {minutesLeft(row.expires_at)}</span>
        <span className="lg-mono" style={{ color: 'var(--lg-fg-3)' }}>{clock(row.created_at)}</span>
      </div>
      <h3 id={`req-${row.id}`}>{actionQuestion(row)}</h3>
      <dl className="lg-facts">
        <dt>What happens</dt>
        <dd>{detail ? detail.consequence : 'Loading what this does.'}</dd>
        <dt>Site</dt>
        <dd>{detail?.domain ?? 'Not tied to a site'}</dd>
        <dt>Why I’m asking</dt>
        <dd>Actions that change something outside Luminara always need your OK.</dd>
        <dt>What you allow</dt>
        <dd>One run, with exactly the details below, within 30 minutes of the request.</dd>
        <dt>Details sent</dt>
        <dd><pre className="lg-args">{prettyArgs(detail?.args ?? row.args_json)}</pre></dd>
      </dl>
      {detail?.argsTruncated && (
        <p className="lg-outcome" style={{ borderTop: 0 }}>
          These details are too long to show in full, so this request can only be denied. Ask the agent for a shorter one.
        </p>
      )}
      {outcome ? (
        <p className="lg-outcome" role="status"><b>{outcome === 'approved' ? 'Approved.' : outcome === 'denied' ? 'Denied.' : 'Not sent.'}</b> {OUTCOME_TEXT[outcome]}</p>
      ) : (
        <div className="lg-approve-f">
          <button
            type="button"
            className="lg-btn lg-btn--primary"
            onClick={() => void decide('approve')}
            disabled={busy || !reviewable}
          >
            <ICONS.Check className="w-4 h-4" />
            Approve once
          </button>
          <button type="button" className="lg-btn" onClick={() => void decide('deny')} disabled={busy}>
            Deny
          </button>
        </div>
      )}
    </article>
  );
};

/** Review: the agent actions waiting for the owner, the rules that decide what waits, and recent decisions. */
export const ReviewView: React.FC<ReviewViewProps> = ({ signedIn, onSignIn, rows, open, details, state, onRefresh, onDecide }) => {
  const recent = rows.filter((r) => !isOpen(r)).slice(0, 10);

  return (
    <div className="lg-page">
      <div className="lg-page-in">
        <h1 className="lg-h1">Waiting for your OK</h1>
        <p className="lg-lede">
          When an agent wants to change something outside Luminara, it stops and asks here first. Nothing on this list has run.
        </p>

        <div className="lg-review">
          <section aria-label="Requests" className="lg-cards">
            {!signedIn ? (
              <div className="lg-empty-card">
                <b>Sign in to see what your agents are asking.</b>
                <span>Requests belong to your account, so they only show once you are signed in.</span>
                <div><button type="button" className="lg-btn lg-btn--primary lg-btn--sm" onClick={onSignIn}>Sign in</button></div>
              </div>
            ) : state === 'error' && open.length === 0 ? (
              <div className="lg-empty-card" role="alert">
                <b>Could not load your requests.</b>
                <span>Nothing was approved or denied. Check your connection and try again.</span>
                <div><button type="button" className="lg-btn lg-btn--sm" onClick={onRefresh}>Try again</button></div>
              </div>
            ) : state !== 'ready' && open.length === 0 ? (
              <div className="lg-empty-card" aria-busy="true"><span>Loading your requests.</span></div>
            ) : open.length === 0 ? (
              <div className="lg-empty-card">
                <b>Nothing is waiting for you.</b>
                <span>When an agent connected to your account asks to act, the request appears here.</span>
              </div>
            ) : (
              open.map((row) => <ApprovalCard key={row.id} row={row} detail={details[row.id]} onDecide={onDecide} />)
            )}

            {recent.length > 0 && (
              <>
                <h2 className="lg-label" style={{ marginTop: 18 }}>Decided recently</h2>
                <ul className="lg-history">
                  {recent.map((row) => {
                    const s = statusWord(row);
                    return (
                      <li key={row.id}>
                        <span>{actionQuestion(row).replace(/\?$/, '')}<small className="lg-mono">{clock(row.decided_at ?? row.created_at)}</small></span>
                        <span className="lg-pill" style={{ color: s.color }}>{s.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <aside className="lg-rules" aria-labelledby="rules-h">
            <h2 id="rules-h" className="lg-label">What needs your OK</h2>
            <dl>
              <div>
                <dt>Reading</dt>
                <dd>Reading your site, reports and project data runs without asking.</dd>
              </div>
              <div>
                <dt>Saving inside Luminara</dt>
                <dd>Saving reports, projects and monitors runs without asking. Paid research needs an active plan.</dd>
              </div>
              <div>
                <dt>Acting outside Luminara</dt>
                <dd>Website changes, browser goals and appointment decisions always wait here. Each approval allows one run.</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ReviewView;
