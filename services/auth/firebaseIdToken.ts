let cachedIdToken: string | null = null;

/** Set when a Firebase user is known. Cleared on sign-out. Sync, so marketing pages can resume auth before the SDK loads. */
const HAD_FIREBASE_SESSION_KEY = 'luminara_had_firebase_session';
const FIREBASE_AUTH_USER_PREFIX = 'firebase:authUser:';
const FIREBASE_IDB = 'firebaseLocalStorageDb';
const FIREBASE_IDB_STORE = 'firebaseLocalStorage';

type ListableStorage = {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

function browserStorage(name: 'localStorage' | 'sessionStorage'): ListableStorage | null {
  const host = typeof window === 'undefined' ? globalThis : window;
  const storage = (host as { localStorage?: ListableStorage; sessionStorage?: ListableStorage })[name];
  return storage ?? null;
}

function storageHasAuthUser(storage: ListableStorage | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(HAD_FIREBASE_SESSION_KEY) === '1') return true;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(FIREBASE_AUTH_USER_PREFIX)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * True when a previous sign-in left a sync hint.
 * shortcut: IndexedDB is not readable here, so persistedAuthSessionInIndexedDb covers that store.
 */
export function hasPersistedAuthSession(): boolean {
  return storageHasAuthUser(browserStorage('localStorage')) || storageHasAuthUser(browserStorage('sessionStorage'));
}

export function markPersistedAuthSession(): void {
  try {
    browserStorage('localStorage')?.setItem?.(HAD_FIREBASE_SESSION_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function clearPersistedAuthSession(): void {
  try {
    browserStorage('localStorage')?.removeItem?.(HAD_FIREBASE_SESSION_KEY);
  } catch {
    /* private mode */
  }
}

/** Default Firebase persistence. Does not create the database when it is absent. */
export function persistedAuthSessionInIndexedDb(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    return Promise.resolve(false);
  }
  return indexedDB.databases().then((dbs) => {
    if (!dbs.some((db) => db.name === FIREBASE_IDB)) return false;
    return readIndexedDbAuthUser();
  }).catch(() => false);
}

function readIndexedDbAuthUser(): Promise<boolean> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(FIREBASE_IDB);
    } catch {
      resolve(false);
      return;
    }
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
    request.onupgradeneeded = () => {
      try { request.transaction?.abort(); } catch { /* ignore */ }
      resolve(false);
    };
    request.onsuccess = () => {
      const db = request.result;
      const done = (yes: boolean) => {
        try { db.close(); } catch { /* ignore */ }
        resolve(yes);
      };
      if (!db.objectStoreNames.contains(FIREBASE_IDB_STORE)) {
        done(false);
        return;
      }
      try {
        const keys = db.transaction(FIREBASE_IDB_STORE, 'readonly').objectStore(FIREBASE_IDB_STORE).getAllKeys();
        keys.onsuccess = () => {
          done(keys.result.some((key) => String(key).startsWith(FIREBASE_AUTH_USER_PREFIX)));
        };
        keys.onerror = () => done(false);
      } catch {
        done(false);
      }
    };
  });
}

/** Sync token for Worker headers. The Firebase SDK writes this after it loads. */
export function readCachedFirebaseIdToken(): string | null {
  return cachedIdToken;
}

export function writeCachedFirebaseIdToken(token: string | null): void {
  cachedIdToken = token;
}

/** Dynamic import so the entry chunk does not statically depend on Firebase. */
export function loadFirebaseAuth() {
  return import('./firebaseAuthService');
}
