import { describe, expect, it, vi } from 'vitest';
import { accountActionNote, submitAccountDelete } from '../components/settings/AccountPanel';

const LOGIN_DELETE = "We couldn't finish deleting your login. We've logged it and will retry.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('account delete client', () => {
  it('shows the 502 error and leaves the signed-in session in place', async () => {
    const deleteFirebaseUser = vi.fn(async () => undefined);
    const clearBoard = vi.fn();
    const signOut = vi.fn(async () => undefined);
    const goHome = vi.fn();
    const request = vi.fn(async () => jsonResponse(502, {
      ok: false,
      error: LOGIN_DELETE,
      code: 'FIREBASE_DELETE_FAILED',
      firebaseDeleted: false,
    }));
    const input = {
      base: 'https://api.example.test',
      proof: { idToken: 'live-id-token' },
      hasFirebaseUser: true,
      deleteFirebaseUser,
      clearBoard,
      signOut,
      goHome,
    };

    let thrown: unknown = null;
    try {
      await submitAccountDelete({ ...input, request });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(accountActionNote(thrown)).toBe(LOGIN_DELETE);
    expect(request).toHaveBeenCalledWith('https://api.example.test/api/privacy/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE', idToken: 'live-id-token' }),
    });
    expect(deleteFirebaseUser).not.toHaveBeenCalled();
    expect(clearBoard).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(goHome).not.toHaveBeenCalled();

    await submitAccountDelete({
      ...input,
      request: vi.fn(async () => jsonResponse(200, { ok: true, rows: 1, firebaseDeleted: true })),
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(goHome).toHaveBeenCalledTimes(1);
    expect(clearBoard).toHaveBeenCalledTimes(1);
    expect(deleteFirebaseUser).not.toHaveBeenCalled();
  });
});
