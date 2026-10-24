import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: (force?: boolean) => Promise<string> },
  ready: Promise.resolve() as Promise<void>,
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApps: () => [{ name: '[DEFAULT]' }],
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: vi.fn(),
  getToken: vi.fn(async () => ({ token: '' })),
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {},
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    get currentUser() {
      return authState.currentUser;
    },
    authStateReady: () => authState.ready,
  }),
  onIdTokenChanged: () => () => {},
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: class GoogleAuthProvider {
    setCustomParameters() {}
  },
  signInWithPopup: vi.fn(),
}));

const store: Record<string, string> = {};

function installBrowser(): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  });
  vi.stubGlobal('window', {
    location: { protocol: 'https:', hostname: 'luminarasuite.com', host: 'luminarasuite.com', origin: 'https://luminarasuite.com' },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeEach(() => {
  authState.currentUser = { getIdToken: async () => 'firebase-test-token' };
  authState.ready = Promise.resolve();
  for (const key of Object.keys(store)) delete store[key];
  vi.resetModules();
  installBrowser();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('hosted audit LLM step', () => {
  it('answers from Groq when no Gemini key is configured', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/api/health')) {
        return new Response(JSON.stringify({ ok: true, plans: {}, hostedGemini: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/providers/groq/')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'Groq hosted answer' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('gemini')) {
        return new Response(JSON.stringify({ error: 'gemini is not configured on the server. Add your own key in Settings.' }), { status: 503 });
      }
      return new Response('unexpected', { status: 500 });
    }));

    const api = await import('../services/apiClient');
    const auth = await import('../services/auth/firebaseAuthService');
    const { aiProviderService } = await import('../services/aiProviderService');
    const { geminiService } = await import('../services/geminiService');
    await auth.ensureFirebaseIdTokenCached();
    await api.loadServerHealth();
    aiProviderService.clearCooldowns();

    await expect(geminiService.generateText('Summarise movida.com.au')).resolves.toBe('Groq hosted answer');
    expect(urls.some((url) => url.includes('/api/providers/groq/'))).toBe(true);
    expect(urls.some((url) => url.includes('gemini'))).toBe(false);
  });

  it('uses hosted Gemini only when public health says the server has a key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      plans: {},
      hostedGemini: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const api = await import('../services/apiClient');
    const auth = await import('../services/auth/firebaseAuthService');
    await auth.ensureFirebaseIdTokenCached();
    await api.loadServerHealth();
    expect(api.isProviderConfiguredOnServer('gemini')).toBe(true);
    expect(api.canUseHostedProviderKey('gemini')).toBe(true);
    expect(api.hostedProviderDecisionReason('groq')).toBe('hosted');
  });
});
