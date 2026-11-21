import React, { useCallback, useEffect, useState } from 'react';
import type { AgentToday } from '../../services/enquiries/agentToday';
import { decideBookingAppointmentApi, fetchAgentTodayApi } from '../../services/enquiries/enquiryApiClient';
import {
  formatRange,
  formatWhen,
  googleCalendarLink,
  icsDataUrl,
  mailLink,
  scorecardIsEmpty,
  scorecardLine,
  segmentTag,
  smsLink,
  telLink,
  waitingText,
} from '../../services/enquiries/agentTodayView';

type LoadState = 'loading' | 'ready' | 'signed_out' | 'error';

const ERROR_TEXT = 'That did not go through. Nothing was changed. Try again.';
const CARD = 'rounded-2xl border border-gold/30 bg-black/80 p-4 space-y-3';
const BTN = 'min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold border outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50 inline-flex items-center justify-center text-center';
const BTN_GOLD = `${BTN} border-gold/40 bg-gold/15 text-gold-light hover:bg-gold/25`;
const BTN_PLAIN = `${BTN} border-white/15 bg-white/5 text-gray-200 hover:bg-white/10`;

/** Small home-screen entry. Shows only when someone is waiting for sign-off. */
export const AgentWaitingNotice: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void fetchAgentTodayApi().then((r) => {
      if (live && r.ok && r.today) setCount(r.today.needsSignOff.length);
    });
    return () => {
      live = false;
    };
  }, []);
  if (count < 1) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-h-[44px] mb-6 px-4 py-3 rounded-2xl border border-gold/40 bg-gold/10 text-left text-sm text-gold-light hover:bg-gold/20 outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      <span>{waitingText(count)}</span>
      <span className="ml-2 font-semibold underline">Open Today</span>
    </button>
  );
};

const SegmentTag: React.FC<{ segment: string }> = ({ segment }) => (
  <span className="inline-block mb-1 px-2 py-0.5 rounded-full border border-gold/30 text-[11px] text-gold-light">{segmentTag(segment)}</span>
);

const ContactButtons: React.FC<{ phone: string | null; email: string | null }> = ({ phone, email }) => {
  const tel = telLink(phone);
  const sms = smsLink(phone);
  const mail = mailLink(email);
  return (
    <div className="flex flex-wrap gap-2">
      {tel && <a href={tel} className={BTN_GOLD}>Call</a>}
      {sms && <a href={sms} className={BTN_PLAIN}>Text</a>}
      {mail && <a href={mail} className={BTN_PLAIN}>Email</a>}
      {!tel && !mail && <span className="text-xs text-gray-400">No phone or email on file.</span>}
    </div>
  );
};

export const AgentTodayView: React.FC<{ onOpenEnquiryDesk?: () => void; onSignIn?: () => void }> = ({
  onOpenEnquiryDesk,
  onSignIn,
}) => {
  const [state, setState] = useState<LoadState>('loading');
  const [today, setToday] = useState<AgentToday | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    const r = await fetchAgentTodayApi();
    if (r.ok && r.today) {
      setToday(r.today);
      setState('ready');
    } else {
      setState(r.status === 401 ? 'signed_out' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (appointmentId: string, decision: 'approve' | 'decline', selectedSlotId?: string) => {
    setBusyId(appointmentId);
    setNotice(null);
    const r = await decideBookingAppointmentApi(appointmentId, { decision, selectedSlotId });
    setBusyId(null);
    if (!r.ok) {
      setNotice(ERROR_TEXT);
      return;
    }
    setNotice(decision === 'approve' ? 'Booking approved.' : 'Booking declined.');
    await load();
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-gold-light">Today</span>
          <h2 className="text-xl font-bold">What needs you today</h2>
          <p className="text-xs text-gray-400 mt-1">Luminara never sends a message for you. You approve every booking and make every call.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={state === 'loading'} className={BTN_PLAIN}>
            {state === 'loading' ? 'Loading...' : 'Refresh'}
          </button>
          {onOpenEnquiryDesk && (
            <button type="button" onClick={onOpenEnquiryDesk} className={BTN_PLAIN}>
              Open Enquiry Desk
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="p-3 rounded-xl border border-gold/30 bg-gold/10 text-sm text-gold-light">
          {notice}
        </div>
      )}

      {state === 'loading' && !today && <p className="text-sm text-gray-400">Loading your day...</p>}

      {state === 'signed_out' && (
        <div role="alert" className={CARD}>
          <p className="text-sm">Sign in to see your day.</p>
          {onSignIn && (
            <button type="button" onClick={onSignIn} className={`${BTN_PLAIN} mt-3`}>Sign in</button>
          )}
        </div>
      )}

      {state === 'error' && (
        <div role="alert" className="p-4 rounded-xl border border-danger-500/40 bg-danger-500/10 text-sm text-danger-200">
          <p>{ERROR_TEXT}</p>
          <button type="button" onClick={() => void load()} className={`${BTN_PLAIN} mt-3`}>Try again</button>
        </div>
      )}

      {today && state !== 'signed_out' && (
        <>
          <section aria-labelledby="today-signoff" className="space-y-3">
            <h3 id="today-signoff" className="text-sm font-semibold text-gold-light">Needs your sign-off</h3>
            {today.needsSignOff.length === 0 && <p className="text-sm text-gray-400">Nothing is waiting for your sign-off.</p>}
            {today.needsSignOff.map((item) => (
              <div key={item.appointmentId} className={CARD}>
                <div>
                  <SegmentTag segment={item.segment} />
                  <div className="font-semibold">{item.name}</div>
                  {item.address && <div className="text-xs text-gray-400">{item.address}</div>}
                </div>
                <ContactButtons phone={item.phone} email={item.email} />
                <p className="text-sm text-gray-300">Pick a time to approve the appraisal:</p>
                <div className="flex flex-col gap-2">
                  {item.slots.map((slot) => (
                    <button
                      key={slot.slotId}
                      type="button"
                      disabled={busyId === item.appointmentId}
                      onClick={() => void decide(item.appointmentId, 'approve', slot.slotId)}
                      className={BTN_GOLD}
                    >
                      Approve {slot.label.trim() || slot.slotId}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busyId === item.appointmentId}
                    onClick={() => void decide(item.appointmentId, 'decline')}
                    className={BTN_PLAIN}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section aria-labelledby="today-callback" className="space-y-3">
            <h3 id="today-callback" className="text-sm font-semibold text-gold-light">Call back</h3>
            {today.callBack.length === 0 && <p className="text-sm text-gray-400">No call-backs right now.</p>}
            {today.callBack.map((item) => (
              <div key={item.enquiryId} className={CARD}>
                <div>
                  <SegmentTag segment={item.segment} />
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-sm text-gray-300">{item.reason}</div>
                </div>
                <ContactButtons phone={item.phone} email={item.email} />
              </div>
            ))}
          </section>

          <section aria-labelledby="today-upcoming" className="space-y-3">
            <h3 id="today-upcoming" className="text-sm font-semibold text-gold-light">Coming up</h3>
            {today.upcoming.length === 0 && <p className="text-sm text-gray-400">No approved appraisals coming up.</p>}
            {today.upcoming.map((item) => (
              <div key={item.appointmentId} className={CARD}>
                <div>
                  <SegmentTag segment={item.segment} />
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-sm text-gray-300">{formatWhen(item.startAt)}</div>
                  {item.address && <div className="text-xs text-gray-400">{item.address}</div>}
                </div>
                <ContactButtons phone={item.phone} email={item.email} />
                <div className="flex flex-wrap gap-2">
                  <a href={googleCalendarLink(item)} target="_blank" rel="noopener noreferrer" className={BTN_GOLD}>
                    Add to Google Calendar
                  </a>
                  <a href={icsDataUrl(item)} download={`appraisal-${item.appointmentId}.ics`} className={BTN_PLAIN}>
                    Add to Apple or Outlook calendar
                  </a>
                </div>
              </div>
            ))}
          </section>

          <section aria-labelledby="today-week" className={CARD}>
            <h3 id="today-week" className="text-sm font-semibold text-gold-light">Last 7 days</h3>
            <p className="text-xs text-gray-400">{formatRange(today.scorecard.since, today.scorecard.until)}</p>
            {scorecardIsEmpty(today.scorecard) ? (
              <p className="text-sm text-gray-400">Nothing recorded in the last 7 days yet.</p>
            ) : (
              <div className="space-y-2">
                {today.scorecard.segments.map((s) => (
                  <div key={s.segment} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm border-t border-white/10 pt-2 first:border-0 first:pt-0">
                    <span className="font-semibold">{s.label}</span>
                    <span className="text-gray-300">{scorecardLine(s)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
