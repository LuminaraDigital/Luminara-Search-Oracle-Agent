import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestScoutSummary } from '../services/audit/guestScoutSummary';

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
  ReCaptchaV3Provider: class ReCaptchaV3Provider {},
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

const HOSTED_HEALTH = {
  ok: true,
  providers: { groq: true, tavily: true, firecrawl: true },
  byok: ['groq', 'tavily', 'firecrawl'],
  telegram: false,
  firebase: true,
  requireAuth: true,
  plans: {},
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installBrowser(): void {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal('window', {
    location: {
      protocol: 'https:',
      hostname: 'luminarasuite.com',
      host: 'luminarasuite.com',
      origin: 'https://luminarasuite.com',
      href: 'https://luminarasuite.com/',
      search: '',
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeEach(() => {
  authState.currentUser = null;
  authState.ready = Promise.resolve();
  vi.resetModules();
  installBrowser();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false }, 503)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function loadClients() {
  const api = await import('../services/apiClient');
  const { configService } = await import('../services/configService');
  const auth = await import('../services/auth/firebaseAuthService');
  return { api, configService, auth };
}

describe('ensureHostedProviderReady', () => {
  it('keeps hosted keys closed after a boot health failure, then opens them on recheck once the ID token resolves', async () => {
    let healthMode: 'fail' | 'ok' = 'fail';
    let healthCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/health')) {
        healthCalls += 1;
        if (healthMode === 'fail') return jsonResponse({ ok: false }, 503);
        return jsonResponse(HOSTED_HEALTH);
      }
      return jsonResponse({}, 404);
    }));

    const { api, configService, auth } = await loadClients();
    const boot = await api.loadServerHealth();
    expect(boot.ok).toBe(false);
    expect(api.canUseHostedProviderKey('firecrawl')).toBe(false);
    expect(configService.getFirecrawlKey()).toBe('');
    expect(configService.getTavilyKey()).toBe('');
    expect(configService.getGroqKey()).toBe('');

    healthMode = 'ok';
    const duringCooldown = await api.loadServerHealth();
    expect(duringCooldown.ok).toBe(false);
    expect(healthCalls).toBe(1);

    let releaseToken: (token: string) => void = () => {};
    const tokenGate = new Promise<string>((resolve) => {
      releaseToken = resolve;
    });
    authState.currentUser = { getIdToken: () => tokenGate };

    const pending = api.ensureHostedProviderReady();
    await delay(40);
    expect(auth.getFirebaseIdTokenSync()).toBeNull();
    expect(configService.getFirecrawlKey()).toBe('');

    releaseToken('firebase-test-token');
    const ready = await pending;

    expect(healthCalls).toBe(2);
    expect(ready.healthOk).toBe(true);
    expect(ready.hasIdentity).toBe(true);
    expect(ready.firecrawl).toBe(true);
    expect(ready.tavily).toBe(true);
    expect(ready.groq).toBe(true);
    expect(auth.getFirebaseIdTokenSync()).toBe('firebase-test-token');
    expect(api.canUseHostedProviderKey('firecrawl')).toBe(true);
    expect(api.canUseHostedProviderKey('tavily')).toBe(true);
    expect(api.canUseHostedProviderKey('groq')).toBe(true);
    expect(configService.getFirecrawlKey()).toBe('proxy');
    expect(configService.getTavilyKey()).toBe('proxy');
    expect(configService.getGroqKey()).toBe('proxy');
  });

  it('waits for a persisted Firebase user before treating the session as signed out', async () => {
    let releaseReady: () => void = () => {};
    authState.ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const { auth } = await loadClients();

    const pending = auth.ensureFirebaseIdTokenCached();
    await delay(30);
    expect(auth.getFirebaseIdTokenSync()).toBeNull();

    authState.currentUser = { getIdToken: async () => 'restored-token' };
    releaseReady();

    await expect(pending).resolves.toBe('restored-token');
    expect(auth.getFirebaseIdTokenSync()).toBe('restored-token');
  });

  it('recovers when the boot health request is still in flight and then fails', async () => {
    let releaseBoot: () => void = () => {};
    let bootStarted: () => void = () => {};
    const bootHit = new Promise<void>((resolve) => {
      bootStarted = resolve;
    });
    const bootHold = new Promise<void>((resolve) => {
      releaseBoot = resolve;
    });
    let healthCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/health')) return jsonResponse({}, 404);
      healthCalls += 1;
      if (healthCalls === 1) {
        bootStarted();
        await bootHold;
        return jsonResponse({ ok: false }, 503);
      }
      return jsonResponse(HOSTED_HEALTH);
    }));

    const { api, configService } = await loadClients();
    authState.currentUser = { getIdToken: async () => 'firebase-test-token' };
    const boot = api.loadServerHealth();
    await bootHit;

    const readyPromise = api.ensureHostedProviderReady();
    releaseBoot();
    const ready = await readyPromise;
    await boot;

    expect(healthCalls).toBe(2);
    expect(ready.firecrawl).toBe(true);
    expect(configService.getTavilyKey()).toBe('proxy');
    expect(api.getServerHealthSync().providers.firecrawl).toBe(true);
  });

  it('keeps a good health snapshot when a later recheck fails', async () => {
    let healthMode: 'ok' | 'throw' = 'ok';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/health')) return jsonResponse({}, 404);
      if (healthMode === 'throw') throw new Error('health down');
      return jsonResponse(HOSTED_HEALTH);
    }));
    authState.currentUser = { getIdToken: async () => 'firebase-test-token' };
    const { api, configService } = await loadClients();

    const ready = await api.ensureHostedProviderReady();
    expect(ready.groq).toBe(true);

    healthMode = 'throw';
    const again = await api.loadServerHealth({ force: true });
    expect(again.ok).toBe(true);
    expect(api.canUseHostedProviderKey('groq')).toBe(true);
    expect(configService.getGroqKey()).toBe('proxy');
  });

  it('leaves hosted keys empty when health is up but no session exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(HOSTED_HEALTH)));
    const { api, configService } = await loadClients();
    const ready = await api.ensureHostedProviderReady();
    expect(ready.healthOk).toBe(true);
    expect(ready.hasIdentity).toBe(false);
    expect(ready.firecrawl).toBe(false);
    expect(configService.getFirecrawlKey()).toBe('');
    expect(configService.getTavilyKey()).toBe('');
    expect(configService.getGroqKey()).toBe('');
  });

  it('waits for the ID token inside runAuditCrew before hosted Tavily is called', async () => {
    const calls: { url: string; authorization: string }[] = [];
    let healthMode: 'fail' | 'ok' = 'fail';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get('authorization') || '';
      calls.push({ url, authorization });
      if (url.includes('/api/health')) {
        if (healthMode === 'fail') return jsonResponse({ ok: false }, 503);
        return jsonResponse(HOSTED_HEALTH);
      }
      if (url.includes('/api/providers/tavily')) {
        return jsonResponse({ results: [] });
      }
      return jsonResponse({}, 404);
    }));

    const { api, configService } = await loadClients();
    await api.loadServerHealth();
    expect(configService.getTavilyKey()).toBe('');

    healthMode = 'ok';
    let releaseToken: (token: string) => void = () => {};
    authState.currentUser = {
      getIdToken: () => new Promise<string>((resolve) => {
        releaseToken = resolve;
      }),
    };

    const { scoutAgent } = await import('../services/agentCore/agents/scoutAgent');
    const { crewOrchestrator } = await import('../services/agentCore/crewOrchestrator');
    let scoutCalls = 0;
    vi.spyOn(scoutAgent, 'execute').mockImplementation(async () => {
      scoutCalls += 1;
      expect(api.getServerHealthSync().ok).toBe(true);
      expect(configService.getFirecrawlKey()).toBe('proxy');
      expect(configService.getGroqKey()).toBe('proxy');
      return [];
    });

    const crewPromise = crewOrchestrator.runAuditCrew('https://example.com', 'AEO', null, () => {});
    await delay(50);
    expect(scoutCalls).toBe(0);

    releaseToken('firebase-test-token');
    await crewPromise;

    expect(scoutCalls).toBe(1);
    const tavily = calls.find((call) => call.url.includes('/api/providers/tavily'));
    expect(tavily?.url).toContain('https://luminarasuite.com/api/providers/tavily');
    expect(tavily?.authorization).toBe('Bearer firebase-test-token');
    const healthIndexes = calls
      .map((call, index) => (call.url.includes('/api/health') ? index : -1))
      .filter((index) => index >= 0);
    const tavilyIndex = calls.findIndex((call) => call.url.includes('/api/providers/tavily'));
    expect(healthIndexes.length).toBeGreaterThanOrEqual(2);
    expect(tavilyIndex).toBeGreaterThan(healthIndexes[1] ?? -1);
  });

  it('awaits provider readiness before the Instant Audit report reads the Groq key', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/health')) return jsonResponse(HOSTED_HEALTH);
      return jsonResponse({}, 404);
    }));
    let releaseToken: (token: string) => void = () => {};
    authState.currentUser = {
      getIdToken: () => new Promise<string>((resolve) => {
        releaseToken = resolve;
      }),
    };

    const { configService } = await loadClients();
    const { geminiService } = await import('../services/geminiService');
    const { generateAuditReportUnlessDegraded } = await import('../components/audit/InstantAuditView');
    let keyDuringReport = '';
    const reportSpy = vi.spyOn(geminiService, 'generateAuditReport').mockImplementation(async () => {
      keyDuringReport = configService.getGroqKey();
      return { text: 'brief', sources: [] } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>;
    });

    const pending = generateAuditReportUnlessDegraded({
      isGuest: false,
      summary: { evidenceEmpty: false, failureCodes: [] } as GuestScoutSummary,
      measurementStatus: 'measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
    });
    await delay(40);
    expect(reportSpy).not.toHaveBeenCalled();
    expect(keyDuringReport).toBe('');

    releaseToken('firebase-test-token');
    const report = await pending;
    expect(report?.text).toBe('brief');
    expect(keyDuringReport).toBe('proxy');
    expect(configService.getGroqKey()).toBe('proxy');
  }, 120_000); // cold import of InstantAuditView after resetModules is slow under full-suite load
});
