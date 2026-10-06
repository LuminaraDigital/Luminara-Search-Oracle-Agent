import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMissionControl } from '../components/audit/AgentMissionControl';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';

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

const store: Record<string, string> = {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installBrowser(): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  });
  vi.stubGlobal('window', {
    location: {
      protocol: 'https:',
      hostname: 'luminarasuite.com',
      host: 'luminarasuite.com',
      origin: 'https://luminarasuite.com',
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function health(providers: Record<string, boolean>) {
  return {
    ok: true,
    providers,
    byok: Object.keys(providers),
    telegram: false,
    firebase: true,
    requireAuth: true,
    plans: {},
  };
}

beforeEach(() => {
  authState.currentUser = null;
  authState.ready = Promise.resolve();
  for (const key of Object.keys(store)) delete store[key];
  vi.resetModules();
  installBrowser();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false }, 503)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function loadApi() {
  const api = await import('../services/apiClient');
  const auth = await import('../services/auth/firebaseAuthService');
  return { api, auth };
}

describe('hostedProviderDecisionReason', () => {
  it('returns byok when a local key is present, even if hosted health is down', async () => {
    store.luminara_firecrawl_key = 'fc-user-key';
    const { api } = await loadApi();
    expect(api.hostedProviderDecisionReason('firecrawl')).toBe('byok');
    expect(api.canUseHostedProviderKey('firecrawl')).toBe(false);
    expect(api.formatPageFetchClause('byok')).toBe('Page fetch: your Firecrawl key');
  });

  it('returns byok ahead of a ready hosted proxy', async () => {
    store.luminara_tavily_key = 'tvly-user-key';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(health({ tavily: true, firecrawl: true, groq: true }))));
    authState.currentUser = { getIdToken: async () => 'firebase-test-token' };
    const { api, auth } = await loadApi();
    await auth.ensureFirebaseIdTokenCached();
    await api.loadServerHealth();
    expect(api.canUseHostedProviderKey('tavily')).toBe(true);
    expect(api.hostedProviderDecisionReason('tavily')).toBe('byok');
  });

  it('returns hosted when the proxy key will be used', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(health({ tavily: true, firecrawl: true, groq: true }))));
    authState.currentUser = { getIdToken: async () => 'firebase-test-token' };
    const { api, auth } = await loadApi();
    await auth.ensureFirebaseIdTokenCached();
    await api.loadServerHealth();
    expect(api.hostedProviderDecisionReason('firecrawl')).toBe('hosted');
    expect(api.hostedProviderDecisionReason('tavily')).toBe('hosted');
    expect(api.hostedProviderDecisionReason('groq')).toBe('hosted');
    expect(api.canUseHostedProviderKey('tavily')).toBe(true);
    expect(api.formatInstantAuditProviderSummary()).toBe('Page fetch: hosted Firecrawl · Search: hosted Tavily');
  });

  it('returns no_health when the health cache is not ok', async () => {
    const { api } = await loadApi();
    await api.loadServerHealth();
    expect(api.getServerHealthSync().ok).toBe(false);
    expect(api.hostedProviderDecisionReason('tavily')).toBe('no_health');
    expect(api.hostedProviderDecisionReason('groq')).toBe('no_health');
    expect(api.formatSearchSkipReason('no_health')).toBe('Search off: provider status not ready.');
  });

  it('returns not_configured when health is ok but the provider is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(health({ groq: true }))));
    authState.currentUser = { getIdToken: async () => 'firebase-test-token' };
    const { api, auth } = await loadApi();
    await auth.ensureFirebaseIdTokenCached();
    await api.loadServerHealth();
    expect(api.clientHasHostedIdentity()).toBe(true);
    expect(api.hostedProviderDecisionReason('tavily')).toBe('not_configured');
    expect(api.canUseHostedProviderKey('tavily')).toBe(false);
    expect(api.hostedProviderDecisionReason('groq')).toBe('hosted');
  });

  it('returns no_identity when a free hosted provider needs a signed-in token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(health({ tavily: true, firecrawl: true, groq: true }))));
    const { api } = await loadApi();
    await api.loadServerHealth();
    expect(api.clientHasHostedIdentity()).toBe(false);
    expect(api.hostedProviderDecisionReason('tavily')).toBe('no_identity');
    expect(api.hostedProviderDecisionReason('firecrawl')).toBe('no_identity');
    expect(api.canUseHostedProviderKey('firecrawl')).toBe(false);
    expect(api.formatInstantAuditProviderSummary()).toBe(
      'Page fetch: Jina (Firecrawl: no identity) · Search off: sign-in token not ready · Model off: sign-in token not ready',
    );
    expect(api.providerDecisionsErrorRecord()).toBe(
      'provider_decisions firecrawl=no_identity tavily=no_identity groq=no_identity',
    );
  });

  it('returns paid_required for a paid provider without a plan, even when identity is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(health({ dataforseo: true, groq: true }))));
    authState.currentUser = { getIdToken: async () => 'firebase-test-token' };
    const { api, auth } = await loadApi();
    await auth.ensureFirebaseIdTokenCached();
    await api.loadServerHealth();
    expect(api.clientHasHostedIdentity()).toBe(true);
    expect(api.hasActivePaidPlanSync()).toBe(false);
    expect(api.hostedProviderDecisionReason('dataforseo')).toBe('paid_required');
    expect(api.canUseHostedProviderKey('dataforseo')).toBe(false);

    api.updateQuotaFromHeaders(new Headers({
      'x-quota-remaining': 'unlimited',
      'x-quota-limit': 'unlimited',
    }));
    expect(api.hostedProviderDecisionReason('dataforseo')).toBe('hosted');
    expect(api.canUseHostedProviderKey('dataforseo')).toBe(true);
  });

  it('names the Tavily skip reason on the SERP empty-key path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(health({ tavily: true, firecrawl: true, groq: true }))));
    const { api } = await loadApi();
    await api.loadServerHealth();
    const { serpRadarAgent } = await import('../services/agentCore/agents/serpRadarAgent');
    const events: { message: string }[] = [];
    const result = await serpRadarAgent.execute('example.com', null, (event) => {
      events.push(event);
    });
    expect(result.citationRatePercent).toBeNull();
    expect(result.serpEvidence).toEqual([]);
    const done = events.map((event) => event.message).join(' ');
    expect(done).toContain('Analyzed 0 SERP results');
    expect(done).toContain('Citation rate and share of voice were not measured.');
    expect(done).toContain('Search off: sign-in token not ready.');
  });
});

describe('provider decision surfaces', () => {
  it('keeps the provider summary visible after later scout events', () => {
    const html = renderToStaticMarkup(createElement(AgentMissionControl, {
      events: [
        {
          id: 'providers',
          timestamp: 1,
          agentRole: 'scout',
          agentName: 'Scout Agent',
          phase: 'provider_decisions',
          message: 'Page fetch: Jina (Firecrawl: no identity) · Search off: sign-in token not ready',
          status: 'running',
        },
        {
          id: 'scout-done',
          timestamp: 2,
          agentRole: 'scout',
          agentName: 'Scout Agent',
          phase: 'crawling_complete',
          message: 'Scouted 1 page(s). Discovered 0 structured schema entity block(s).',
          status: 'completed',
        },
      ],
      isComplete: true,
      measurementStatus: 'not_measured',
    }));
    expect(html).toContain('Firecrawl: no identity');
    expect(html).toContain('Search off: sign-in token not ready');
    expect(html).toContain('Scouted 1 page(s).');
  });

  it('does not treat the decision record as a provider failure on the public teaser', () => {
    const base = {
      targetUrl: 'https://example.com',
      measurementStatus: 'measured' as const,
      citationRatePercent: 10,
      shareOfVoiceScore: 8,
      healthScore: 70,
      scrapedPageCount: 1,
      serpCount: 2,
      findings: [],
      hostedRail: 'signed_in_hosted' as const,
    };
    const recorded = buildGuestScoutSummary({
      ...base,
      errors: ['provider_decisions firecrawl=hosted tavily=hosted groq=hosted'],
    });
    expect(recorded.failureCodes).not.toContain('provider_failed');

    const failed = buildGuestScoutSummary({
      ...base,
      errors: ['provider_decisions firecrawl=hosted tavily=hosted groq=hosted', 'provider_auth_failed'],
    });
    expect(failed.failureCodes).toContain('provider_failed');
  });
});
