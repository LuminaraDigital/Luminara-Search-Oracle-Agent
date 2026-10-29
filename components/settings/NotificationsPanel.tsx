import React, { useEffect, useState } from 'react';
import { accountKnownSignedIn, apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { getFirebaseIdToken } from '../../services/auth/firebaseAuthService';

type EmailPreferences = {
  available: boolean;
  email: string | null;
  weeklyDigest: boolean;
  timeZone: string | null;
};

type PreferencesResult = { prefs: EmailPreferences | null; error: string | null };

const SAVE_FAILED = 'That did not save. Try again.';

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** GET with no body. PUT with the new choice; turning it on also sends a fresh ID token so the Worker can check the address. */
async function emailPreferencesRequest(body?: { weeklyDigest: boolean; timeZone?: string; idToken?: string }): Promise<PreferencesResult> {
  const base = apiBase();
  if (!base) return { prefs: null, error: null };
  const res = await workerFetchWithAuthRetry(`${base}/api/email/preferences`, body
    ? { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const data = (await res.json().catch(() => ({}))) as Partial<EmailPreferences> & { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) return { prefs: null, error: body ? data.error || SAVE_FAILED : null };
  return {
    prefs: {
      available: data.available === true,
      email: typeof data.email === 'string' ? data.email : null,
      weeklyDigest: data.weeklyDigest === true,
      timeZone: typeof data.timeZone === 'string' ? data.timeZone : null,
    },
    error: null,
  };
}

/**
 * The weekly email is an account setting stored by the Worker (spec 0031). It shows only once the
 * owner turns the digest on. The weekly Telegram briefing is still a browser flag on the decision card.
 */
export const NotificationsPanel: React.FC = () => {
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!accountKnownSignedIn()) return;
    let cancelled = false;
    void emailPreferencesRequest().then((result) => {
      if (!cancelled && result.prefs) setPrefs(result.prefs);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDigest = async () => {
    if (!prefs) return;
    setBusy(true);
    setNote(null);
    const turnOn = !prefs.weeklyDigest;
    const result = await (async () => {
      const idToken = turnOn ? (await getFirebaseIdToken(true)) || undefined : undefined;
      return emailPreferencesRequest({ weeklyDigest: turnOn, timeZone: browserTimeZone(), idToken });
    })().catch((): PreferencesResult => ({ prefs: null, error: SAVE_FAILED }));
    setBusy(false);
    if (result.prefs) setPrefs(result.prefs);
    setNote(result.error);
  };

  return (
    <section className="rounded-xl border border-white/10 p-4 space-y-2" aria-label="Notifications">
      <h2 className="text-sm font-bold text-white">Notifications</h2>
      {prefs?.available && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs text-white">
            <input
              type="checkbox"
              checked={prefs.weeklyDigest}
              disabled={busy || (!prefs.email && !prefs.weeklyDigest)}
              onChange={() => void toggleDigest()}
            />
            Weekly email
          </label>
          <p className="text-xs text-gray-300 leading-relaxed">
            Once a week, on Monday in your time zone: the one fix to do next and what moved in the last seven days. Every number says whether it was measured, estimated or not measured. Each email has a one-click unsubscribe.
          </p>
          <p className="text-xs text-gray-400">
            {prefs.email ? `Sent to ${prefs.email}, once you have verified that address.` : 'Add an email address to your account to get it.'}
          </p>
          {note && <p className="text-xs text-red-300" role="status">{note}</p>}
        </div>
      )}
      <p className="text-xs text-gray-300 leading-relaxed">
        Weekly Telegram briefing stays off until you turn it on. After an audit, open the decision card and press Weekly Telegram Briefing. That choice is saved in this browser.
      </p>
    </section>
  );
};
