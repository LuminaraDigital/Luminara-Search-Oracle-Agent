let cachedIdToken: string | null = null;

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
