import { afterEach, describe, expect, it, vi } from 'vitest';
import { configService } from '../services/configService';
import { freeLlmModalitiesService } from '../services/freellm/modalitiesService';
import { FreeLlmProvider } from '../services/llm/providers/FreeLlmProvider';
import { OllamaNativeProvider } from '../services/llm/providers/OllamaNativeProvider';

const LOOPBACK_OLLAMA = /127\.0\.0\.1:11434|localhost:11434|\[::1\]:11434/i;
const LOOPBACK_FREELLM = /localhost:3001|127\.0\.0\.1:3001|\[::1\]:3001/i;

function memoryStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  };
}

function installBrowser(opts: {
  hostname: string;
  search?: string;
  desktop?: boolean;
  storage?: Record<string, string>;
}) {
  const protocol = opts.hostname === 'localhost' || opts.hostname === '127.0.0.1' ? 'http:' : 'https:';
  const origin = `${protocol}//${opts.hostname}`;
  vi.stubGlobal('localStorage', memoryStorage(opts.storage));
  vi.stubGlobal('window', {
    location: {
      hostname: opts.hostname,
      host: opts.hostname,
      origin,
      protocol,
      href: `${origin}/${opts.search ?? ''}`,
      search: opts.search ?? '',
    },
    luminaraDesktop: opts.desktop
      ? { getInfo: async () => ({ shellVersion: '1.0.0', webappUrl: origin, platform: 'linux', packaged: true }) }
      : undefined,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function fetchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function tagsResponse(models: string[]) {
  return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('hosted web does not probe the default Ollama daemon', () => {
  it('does not fetch 127.0.0.1:11434 when nothing is configured', async () => {
    installBrowser({ hostname: 'luminarasuite.com' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isOllamaDaemonProbeAllowed()).toBe(false);
    const status = await new OllamaNativeProvider().probeStatus();

    expect(status.available).toBe(false);
    expect(status.isLocal).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch 127.0.0.1:11434 when Settings only stored the implicit default', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_ollama_endpoint: 'http://127.0.0.1:11434' },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isOllamaDaemonProbeAllowed()).toBe(false);
    await new OllamaNativeProvider().probeStatus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not treat a saved scraper URL as permission to probe Ollama', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_patchright_url: 'https://crawler.example.test' },
    });
    const fetchMock = vi.fn(async () => tagsResponse(['llama3.2']));
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isLocalSidecarAllowed()).toBe(true);
    expect(configService.isOllamaDaemonProbeAllowed()).toBe(false);
    await new OllamaNativeProvider().probeStatus();
    expect(fetchUrls(fetchMock).some((url) => LOOPBACK_OLLAMA.test(url))).toBe(false);
  });

  it('still lists Ollama Cloud without touching the local daemon', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_ollama_key: 'ollama_cloud_test_key' },
    });
    const fetchMock = vi.fn(async () => tagsResponse(['gpt-oss:120b']));
    vi.stubGlobal('fetch', fetchMock);

    const status = await new OllamaNativeProvider().probeStatus();
    const urls = fetchUrls(fetchMock);

    expect(status.available).toBe(true);
    expect(status.isLocal).toBe(false);
    expect(urls.some((url) => LOOPBACK_OLLAMA.test(url))).toBe(false);
    expect(urls.some((url) => url.includes('/api/providers/ollama/api/tags') || url.includes('ollama.com'))).toBe(true);
  });

  it('probes a saved non-default endpoint', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_ollama_endpoint: 'http://10.0.0.8:11434/' },
    });
    const fetchMock = vi.fn(async () => tagsResponse(['qwen2.5']));
    vi.stubGlobal('fetch', fetchMock);

    const status = await new OllamaNativeProvider().probeStatus();

    expect(configService.isOllamaDaemonProbeAllowed()).toBe(true);
    expect(fetchUrls(fetchMock)).toEqual(['http://10.0.0.8:11434/api/tags']);
    expect(status.available).toBe(true);
    expect(status.isLocal).toBe(true);
    expect(status.endpoint).toBe('http://10.0.0.8:11434');
    expect(status.models).toEqual(['qwen2.5']);
  });

  it('drops a saved copy of the implicit default so a Settings save cannot re-enable the probe', () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_ollama_endpoint: 'http://10.0.0.8:11434' },
    });
    configService.setOllamaEndpoint('http://127.0.0.1:11434');
    expect(localStorage.getItem('luminara_ollama_endpoint')).toBeNull();
    expect(configService.getOllamaEndpoint()).toBe('http://127.0.0.1:11434');
    expect(configService.isOllamaDaemonProbeAllowed()).toBe(false);
  });
});

describe('desktop and local pages still probe default Ollama', () => {
  it('probes 127.0.0.1:11434 from a localhost page', async () => {
    installBrowser({ hostname: 'localhost' });
    const fetchMock = vi.fn(async () => tagsResponse(['llama3.2']));
    vi.stubGlobal('fetch', fetchMock);

    const status = await new OllamaNativeProvider().probeStatus();

    expect(configService.isImplicitLocalLlmAllowed()).toBe(true);
    expect(fetchUrls(fetchMock)).toEqual(['http://127.0.0.1:11434/api/tags']);
    expect(status.available).toBe(true);
    expect(status.isLocal).toBe(true);
  });

  it('probes from a 127.0.0.1 page', async () => {
    installBrowser({ hostname: '127.0.0.1' });
    const fetchMock = vi.fn(async () => tagsResponse(['llama3.2']));
    vi.stubGlobal('fetch', fetchMock);

    await new OllamaNativeProvider().probeStatus();
    expect(fetchUrls(fetchMock)).toEqual(['http://127.0.0.1:11434/api/tags']);
  });

  it('probes from the desktop shell even when the page origin is hosted', async () => {
    installBrowser({ hostname: 'luminarasuite.com', desktop: true });
    const fetchMock = vi.fn(async () => tagsResponse(['llama3.2']));
    vi.stubGlobal('fetch', fetchMock);

    await new OllamaNativeProvider().probeStatus();
    expect(fetchUrls(fetchMock)).toEqual(['http://127.0.0.1:11434/api/tags']);
  });

  it('probes when the page is opened with the desktop query flag', async () => {
    installBrowser({ hostname: 'luminarasuite.com', search: '?desktop=1' });
    const fetchMock = vi.fn(async () => tagsResponse(['llama3.2']));
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.isOllamaDaemonProbeAllowed()).toBe(true);
    await new OllamaNativeProvider().probeStatus();
    expect(fetchUrls(fetchMock)).toEqual(['http://127.0.0.1:11434/api/tags']);
  });
});

describe('FreeLLM default localhost base is local-only', () => {
  it('skips the default base on hosted web, including a saved copy of that default', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: {
        luminara_freellm_key: 'freellmapi-test-key',
        luminara_freellm_base_url: 'http://localhost:3001/v1',
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.getFreeLlmBaseUrl()).toBe('');
    expect(freeLlmModalitiesService.isAvailable()).toBe(false);
    const provider = new FreeLlmProvider();
    expect(await provider.isAvailable()).toBe(false);
    await expect(provider.generateText('ping')).rejects.toThrow(/base URL/i);
    await expect(freeLlmModalitiesService.speak('Audit briefing')).rejects.toThrow(/not configured/i);
    const ping = await configService.testFreeLlm();
    expect(ping.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchUrls(fetchMock).some((url) => LOOPBACK_FREELLM.test(url))).toBe(false);
  });

  it('uses the default base from a localhost page', () => {
    installBrowser({ hostname: 'localhost' });
    expect(configService.getFreeLlmBaseUrl()).toBe('http://localhost:3001/v1');
  });

  it('uses the default base in the desktop shell', () => {
    installBrowser({ hostname: 'luminarasuite.com', desktop: true });
    expect(configService.getFreeLlmBaseUrl()).toBe('http://localhost:3001/v1');
  });

  it('calls a saved custom FreeLLM URL on hosted web', async () => {
    installBrowser({
      hostname: 'luminarasuite.com',
      storage: { luminara_freellm_key: 'freellmapi-test-key' },
    });
    configService.setFreeLlmBaseUrl('https://llm.example.test/v1/');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'from custom' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(configService.getFreeLlmBaseUrl()).toBe('https://llm.example.test/v1');
    const provider = new FreeLlmProvider();
    expect(await provider.isAvailable()).toBe(true);
    const result = await provider.generateText('ping');

    expect(result.text).toBe('from custom');
    expect(fetchUrls(fetchMock)).toEqual(['https://llm.example.test/v1/chat/completions']);
  });
});
