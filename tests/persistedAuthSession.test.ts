import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPersistedAuthSession,
  hasPersistedAuthSession,
  markPersistedAuthSession,
  persistedAuthSessionInIndexedDb,
} from '../services/auth/firebaseIdToken';
import { marketingNavSignedIn } from '../services/auth/useAppAuth';

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
    key: (index) => Object.keys(data)[index] ?? null,
    get length() { return Object.keys(data).length; },
  };
}

const previous = {
  localStorage: globalThis.localStorage,
  sessionStorage: globalThis.sessionStorage,
};

afterEach(() => {
  Object.assign(globalThis, previous);
});

describe('hasPersistedAuthSession', () => {
  it('is true only for a Firebase auth user key or the sign-in flag', async () => {
    const local = memoryStorage();
    const session = memoryStorage();
    Object.assign(globalThis, { localStorage: local, sessionStorage: session });

    expect(hasPersistedAuthSession()).toBe(false);
    local.setItem('firebase:persistence:api:[DEFAULT]', '{}');
    expect(hasPersistedAuthSession()).toBe(false);

    local.setItem('firebase:authUser:api:[DEFAULT]', '{"uid":"ada"}');
    expect(hasPersistedAuthSession()).toBe(true);
    local.removeItem('firebase:authUser:api:[DEFAULT]');
    expect(hasPersistedAuthSession()).toBe(false);

    session.setItem('firebase:authUser:api:[DEFAULT]', '{"uid":"ada"}');
    expect(hasPersistedAuthSession()).toBe(true);
    session.removeItem('firebase:authUser:api:[DEFAULT]');

    markPersistedAuthSession();
    expect(local.getItem('luminara_had_firebase_session')).toBe('1');
    expect(hasPersistedAuthSession()).toBe(true);
    clearPersistedAuthSession();
    expect(hasPersistedAuthSession()).toBe(false);
    await expect(persistedAuthSessionInIndexedDb()).resolves.toBe(false);
  });

  it('keeps Dashboard during the auth load when a session is already stored', () => {
    expect(marketingNavSignedIn(true, false, true)).toBe(true);
    expect(marketingNavSignedIn(true, false, false)).toBe(false);
    expect(marketingNavSignedIn(false, true, false)).toBe(true);
    expect(marketingNavSignedIn(false, false, true)).toBe(false);
  });
});
