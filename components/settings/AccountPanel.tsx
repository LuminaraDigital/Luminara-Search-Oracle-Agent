import React, { useEffect, useState } from 'react';
import { apiBase, fetchQuotaStatus, workerFetchWithAuthRetry, type QuotaInfo } from '../../services/apiClient';
import { requestPrivacyExport } from '../../services/privacy/privacyClient';
import {
  changeEmailAddress,
  deleteCurrentFirebaseUser,
  getFirebaseUserSync,
  reauthenticateForDelete,
  resetPasswordWithEmail,
  signOutFirebase,
} from '../../services/auth/firebaseAuthService';
import { getInitDataRaw, isInTelegram } from '../../services/telegram/tma';
import { TELEGRAM_MINI_APP_URL } from '../paywall/paymentOptions';
import { checksLeftLine, planDetailLine, planTitle } from '../../services/account/accountSummary';
import { Button } from '../ui/Button';

function signInKind(user: { providerData?: { providerId: string }[] } | null): 'google' | 'password' | 'none' {
  const ids = user?.providerData?.map((row) => row.providerId) || [];
  if (ids.includes('google.com') && !ids.includes('password')) return 'google';
  if (ids.includes('password')) return 'password';
  return 'none';
}

async function downloadExport(): Promise<string | null> {
  const started = await requestPrivacyExport();
  if (!started.ok || !started.jobId || !started.downloadToken) return started.error || 'Export failed.';
  const base = apiBase();
  if (!base) return 'Export failed.';
  const res = await workerFetchWithAuthRetry(`${base}/api/privacy/export/${started.jobId}/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ downloadToken: started.downloadToken }),
  });
  if (!res.ok) return 'Export failed.';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `luminara-export-${started.jobId}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return null;
}

/**
 * Settings > Account. Plan and today's allowance come from /api/auth/quota.
 * Telegram linking still happens inside the Mini App. There is no one-time code.
 */
export const AccountPanel: React.FC = () => {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const kind = signInKind(getFirebaseUserSync());
  const inTg = isInTelegram();

  useEffect(() => {
    void fetchQuotaStatus().then(setQuota);
  }, []);

  const usage = quota
    ? checksLeftLine(quota.remaining, quota.limit, quota.isUnlimited)
    : 'Sign in to see your plan.';

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await task();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-sm text-gray-300">
      <section className="space-y-1">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Plan</h2>
        <p className="text-white">{quota ? planTitle(quota.plan) : 'Account'}</p>
        <p>{quota ? planDetailLine(quota.plan, quota.expiresAt) : usage}</p>
        {quota ? <p>{usage}</p> : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Sign-in</h2>
        {kind === 'google' ? <p>Managed by Google.</p> : null}
        {kind === 'password' ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await changeEmailAddress(email);
                setNote('Check the new inbox and confirm the address.');
                setEmail('');
              });
            }}
          >
            <label className="block text-xs" htmlFor="account-email">New email</label>
            <input
              id="account-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !email.trim()}>Send confirmation</Button>
          </form>
        ) : null}
        {kind === 'password' ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(async () => {
              const current = getFirebaseUserSync();
              if (!current?.email) throw new Error('Sign in again to reset the password.');
              const result = await resetPasswordWithEmail(current.email);
              setNote(result.message);
            })}
          >
            Email a password reset
          </Button>
        ) : null}
        {kind === 'none' && !inTg ? <p>Sign in to change the email or password.</p> : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Telegram</h2>
        <p>
          Plans share only after you confirm the link inside the Mini App. Sign in there with this account and confirm. There is no one-time code.
        </p>
        <a
          href={TELEGRAM_MINI_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex text-xs font-bold text-gold underline underline-offset-2"
        >
          Open Telegram
        </a>
      </section>

      <section className="space-y-2 border-t border-white/10 pt-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Your data</h2>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void run(async () => {
            const error = await downloadExport();
            if (error) throw new Error(error);
            setNote('Export downloaded.');
          })}
        >
          Export my data
        </Button>
        <label className="block text-xs" htmlFor="account-delete">Type DELETE to remove this account</label>
        <input
          id="account-delete"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="off"
          className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white"
        />
        {kind === 'password' ? (
          <>
            <label className="block text-xs" htmlFor="account-password">Current password</label>
            <input
              id="account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white"
            />
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={busy || confirm !== 'DELETE' || (kind === 'password' && !password)}
          onClick={() => void run(async () => {
            const proof = inTg && !getFirebaseUserSync()
              ? { initData: getInitDataRaw() }
              : { idToken: await reauthenticateForDelete(kind === 'password' ? password : undefined) };
            const base = apiBase();
            if (!base) throw new Error('Sign in again, then delete the account.');
            const res = await workerFetchWithAuthRetry(`${base}/api/privacy/account`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ confirm: 'DELETE', ...proof }),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; firebaseDeleted?: boolean };
            if (!res.ok || !data.ok) throw new Error(data.error || 'Could not delete the account.');
            if (data.firebaseDeleted === false && getFirebaseUserSync()) await deleteCurrentFirebaseUser();
            localStorage.removeItem('luminara_findings_board_v1');
            await signOutFirebase();
            window.location.assign('/');
          })}
        >
          Delete account
        </Button>
        {note ? <p role="status">{note}</p> : null}
      </section>
    </div>
  );
};
