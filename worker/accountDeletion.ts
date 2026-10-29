/**
 * Immediate account deletion from Settings.
 * Auth is the existing session. Re-auth is a Firebase token or Telegram initData
 * signed in the last five minutes. The log line is a row count and nothing else.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { verifyFirebaseIdToken } from './firebaseAuth';
import { validateInitData } from './telegramAuth';
import { billingId, json } from './workerUtils';
import { identityToolkitHeaders } from './identityToolkit';
import { findErasedLogin, markFirebaseEraseDone, markFirebaseErasePending } from './accountMirror';

export const REAUTH_WINDOW_SEC = 5 * 60;

export function authTimeIsRecent(authTime: number, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return Number.isFinite(authTime) && authTime > 0 && nowSec - authTime <= REAUTH_WINDOW_SEC && authTime <= nowSec + 60;
}

type DeleteBody = { confirm?: unknown; idToken?: unknown; initData?: unknown };

/** True when this Firebase uid is the caller, or a login linked to the caller's account. */
export async function firebaseOwnsAccount(env: Pick<Env, 'DB'>, user: HostedIdentity, uid: string): Promise<boolean> {
  if (user.id === `fb:${uid}`) return true;
  if (!env.DB) return false;
  const row = await env.DB.prepare(`SELECT account_id FROM users WHERE firebase_uid = ? LIMIT 1`)
    .bind(uid)
    .first<{ account_id: string | null }>();
  const accountId = billingId(user);
  return Boolean(row?.account_id && (row.account_id === accountId || row.account_id === user.id));
}

async function telegramOwnsAccount(env: Env, user: HostedIdentity, telegramId: string): Promise<boolean> {
  if (user.id === telegramId) return true;
  if (!env.DB) return false;
  const row = await env.DB.prepare(`SELECT account_id FROM users WHERE id = ? OR telegram_id = ? LIMIT 1`)
    .bind(telegramId, telegramId)
    .first<{ account_id: string | null }>();
  return Boolean(row?.account_id && row.account_id === billingId(user));
}

const IDENTITY_DELETE = 'https://identitytoolkit.googleapis.com/v1/accounts:delete';

export const LOGIN_DELETE_ERROR = "We couldn't finish deleting your login. We've logged it and will retry.";
export const ACCOUNT_ERASED_ERROR = 'This account was deleted.';

type FirebaseDeleteResult = { ok: true } | { ok: false; status: number; code: string };

export type FirebaseEraseDecision =
  | { kind: 'allow' }
  | { kind: 'reject'; status: number; error: string; code: string };

const TOKEN_REJECTED = ['INVALID_ID_TOKEN', 'TOKEN_EXPIRED', 'CREDENTIAL_TOO_OLD'];

function providerCode(raw: string): string {
  const head = raw.toUpperCase().split(/[^A-Z0-9_]/)[0] || '';
  if (!head || head.length > 80) return 'unknown';
  return head;
}

function logFirebaseDeleteFailure(failure: { status: number; code: string }): void {
  console.warn(JSON.stringify({
    event: 'firebase_account_delete_failed',
    status: failure.status,
    code: failure.code,
  }));
}

async function deleteFirebaseAccount(
  env: Env,
  idToken: string,
  opts?: { fetchImpl?: typeof fetch; appCheckToken?: string },
): Promise<FirebaseDeleteResult> {
  const key = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!key) return { ok: false, status: 0, code: 'misconfigured' };
  const fetchImpl = opts?.fetchImpl || fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${IDENTITY_DELETE}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: identityToolkitHeaders(env, opts?.appCheckToken),
      body: JSON.stringify({ idToken }),
    });
  } catch {
    return { ok: false, status: 0, code: 'provider_error' };
  }
  if (res.ok) return { ok: true };
  let code = 'unknown';
  try {
    const parsed = (await res.json()) as { error?: { message?: string } };
    code = providerCode(String(parsed.error?.message || ''));
  } catch {
    code = 'unknown';
  }
  if (code === 'USER_NOT_FOUND') return { ok: true };
  return { ok: false, status: res.status, code };
}

export async function settleFirebaseErase(
  env: Env,
  uid: string,
  idToken: string | null,
  opts?: { fetchImpl?: typeof fetch; appCheckToken?: string; healDone?: boolean },
): Promise<FirebaseEraseDecision> {
  if (!env.DB || !uid) return { kind: 'allow' };
  const loginId = uid.startsWith('fb:') ? uid : `fb:${uid}`;
  const row = await findErasedLogin(env.DB, loginId);
  if (!row) return { kind: 'allow' };
  const token = typeof idToken === 'string' ? idToken.trim() : '';
  const retryDelete = row.status === 'pending_firebase' || opts?.healDone === true;
  if (!token || !retryDelete) {
    if (row.status === 'pending_firebase') {
      return { kind: 'reject', status: 502, error: LOGIN_DELETE_ERROR, code: 'FIREBASE_DELETE_FAILED' };
    }
    return { kind: 'reject', status: 401, error: ACCOUNT_ERASED_ERROR, code: 'ACCOUNT_ERASED' };
  }
  const deleted = await deleteFirebaseAccount(env, token, opts);
  if (deleted.ok) {
    if (row.status === 'pending_firebase') await markFirebaseEraseDone(env.DB, row.accountId);
    return { kind: 'reject', status: 401, error: ACCOUNT_ERASED_ERROR, code: 'ACCOUNT_ERASED' };
  }
  const tokenRejected = TOKEN_REJECTED.some((code) => deleted.code.includes(code));
  if (tokenRejected && row.status === 'done') {
    return { kind: 'reject', status: 401, error: ACCOUNT_ERASED_ERROR, code: 'ACCOUNT_ERASED' };
  }
  await markFirebaseErasePending(env.DB, row.accountId);
  logFirebaseDeleteFailure(deleted);
  return { kind: 'reject', status: 502, error: LOGIN_DELETE_ERROR, code: 'FIREBASE_DELETE_FAILED' };
}

async function deleteAccountObjects(env: Env, accountId: string, user: HostedIdentity): Promise<number> {
  let n = 0;
  if (env.LUMINARA_KV) {
    for (const key of [`sub:${accountId}`, `sub:${user.id}`, `user:${accountId}`, `user:${user.id}`]) {
      await env.LUMINARA_KV.delete(key);
      n += 1;
    }
  }
  const bucket = env.DESKTOP_RELEASES;
  if (bucket && typeof bucket.list === 'function') {
    const listed = await bucket.list({ prefix: `privacy-exports/${accountId}/` });
    for (const obj of listed.objects || []) {
      await bucket.delete(obj.key);
      n += 1;
    }
  }
  return n;
}

export async function deleteHostedAccount(request: Request, env: Env, user: HostedIdentity): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable', code: 'DB_UNBOUND' }, 503);
  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return json({ ok: false, error: 'Type DELETE to confirm.', code: 'CONFIRM_REQUIRED' }, 400);
  }
  if (body.confirm !== 'DELETE') {
    return json({ ok: false, error: 'Type DELETE to confirm.', code: 'CONFIRM_REQUIRED' }, 400);
  }

  const idToken = typeof body.idToken === 'string' ? body.idToken.trim() : '';
  const initData = typeof body.initData === 'string' ? body.initData.trim() : '';
  let firebaseToken = '';
  if (idToken) {
    if (!env.FIREBASE_PROJECT_ID) return json({ ok: false, error: 'Sign-in check is not configured.', code: 'REAUTH_REQUIRED' }, 401);
    const verified = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
    const authTime = verified.ok ? Number(verified.payload.auth_time) : 0;
    if (!verified.ok || !authTimeIsRecent(authTime) || !(await firebaseOwnsAccount(env, user, verified.user.uid))) {
      return json({ ok: false, error: 'Sign in again, then delete the account.', code: 'REAUTH_REQUIRED' }, 401);
    }
    firebaseToken = idToken;
  } else if (initData) {
    if (!env.BOT_TOKEN) return json({ ok: false, error: 'Sign-in check is not configured.', code: 'REAUTH_REQUIRED' }, 401);
    const checked = await validateInitData(initData, env.BOT_TOKEN, REAUTH_WINDOW_SEC);
    if (!checked.ok || !(await telegramOwnsAccount(env, user, String(checked.user.id)))) {
      return json({ ok: false, error: 'Open Telegram again, then delete the account.', code: 'REAUTH_REQUIRED' }, 401);
    }
  } else {
    return json({ ok: false, error: 'Sign in again, then delete the account.', code: 'REAUTH_REQUIRED' }, 401);
  }

  const accountId = billingId(user);
  const { eraseAccountRows } = await import('./privacyService');
  const counts = await eraseAccountRows(env, accountId);
  const removed = await env.DB.prepare(`DELETE FROM users WHERE account_id = ? OR id = ?`).bind(accountId, user.id).run();
  counts.users = Number(removed.meta?.changes ?? 0);
  counts.objects = await deleteAccountObjects(env, accountId, user);
  const rows = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (!firebaseToken) {
    console.warn(JSON.stringify({ event: 'account_deleted', rows }));
    return json({ ok: true, rows, firebaseDeleted: false });
  }
  const appCheck = request.headers.get('X-Firebase-AppCheck')?.trim() || undefined;
  const deleted = await deleteFirebaseAccount(env, firebaseToken, { appCheckToken: appCheck });
  if (!deleted.ok) {
    await markFirebaseErasePending(env.DB, accountId);
    logFirebaseDeleteFailure(deleted);
    return json({
      ok: false,
      error: LOGIN_DELETE_ERROR,
      code: 'FIREBASE_DELETE_FAILED',
      firebaseDeleted: false,
    }, 502);
  }
  console.warn(JSON.stringify({ event: 'account_deleted', rows }));
  return json({ ok: true, rows, firebaseDeleted: true });
}
