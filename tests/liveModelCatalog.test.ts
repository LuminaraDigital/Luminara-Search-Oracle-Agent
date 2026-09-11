import { describe, expect, it, beforeEach, vi } from 'vitest';
import { configService } from '../services/configService';
import {
  isNimChatModelId,
  mergeLiveProviderModels,
  parseOllamaTagsList,
  parseOpenAiModelList,
} from '../services/llm/liveModelCatalog';
import { isPathAllowed } from '../worker/index';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

const eventTarget = new EventTarget();
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = eventTarget;
} else if (!window.addEventListener) {
  (window as any).addEventListener = eventTarget.addEventListener.bind(eventTarget);
  (window as any).removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
  (window as any).dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);
}
(globalThis as any).localStorage = mockLocalStorage;

describe('Live NVIDIA + Ollama model catalogs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  it('parses OpenAI-style NVIDIA /models payloads and filters non-chat ids', () => {
    const ids = parseOpenAiModelList({
      data: [
        { id: 'meta/llama-3.1-70b-instruct' },
        { id: 'nvidia/nv-embedqa-e5-v5' },
        { id: 'moonshotai/kimi-k2-instruct' },
        { id: 'nvidia/llama-3.1-nemoguard-8b-content-safety' },
      ],
    });
    expect(ids).toContain('meta/llama-3.1-70b-instruct');
    expect(isNimChatModelId('meta/llama-3.1-70b-instruct')).toBe(true);
    expect(isNimChatModelId('nvidia/nv-embedqa-e5-v5')).toBe(false);
    expect(isNimChatModelId('nvidia/llama-3.1-nemoguard-8b-content-safety')).toBe(false);
  });

  it('parses Ollama Cloud /api/tags payloads', () => {
    const ids = parseOllamaTagsList({
      models: [
        { name: 'gpt-oss:120b', model: 'gpt-oss:120b' },
        { name: 'kimi-k2.6', model: 'kimi-k2.6' },
      ],
    });
    expect(ids).toEqual(['gpt-oss:120b', 'kimi-k2.6']);
  });

  it('replaces curated NVIDIA/Ollama groups with live catalogs when keys return models', () => {
    const groups = mergeLiveProviderModels({
      nvidia: ['meta/llama-3.1-8b-instruct', 'nvidia/nv-embedqa-e5-v5', 'deepseek-ai/deepseek-v4-pro'],
      ollama: ['gpt-oss:120b', 'minimax-m2.7', 'kimi-k2.6'],
    });
    const nim = groups.find((g) => g.provider === 'nim')!;
    const ollama = groups.find((g) => g.provider === 'ollama')!;
    expect(nim.models.map((m) => m.model)).toEqual([
      'meta/llama-3.1-8b-instruct',
      'deepseek-ai/deepseek-v4-pro',
    ]);
    expect(ollama.models.map((m) => m.model)).toEqual([
      'gpt-oss:120b',
      'minimax-m2.7',
      'kimi-k2.6',
    ]);
  });

  it('lists NVIDIA models through BYOK relay when a key is saved', async () => {
    localStorage.setItem('luminara_nvidia_key', 'nvapi-test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'meta/llama-3.1-8b-instruct' },
            { id: 'nvidia/nv-embedqa-e5-v5' },
          ],
        }),
        { status: 200 },
      ),
    );

    const models = await configService.listNvidiaModels();
    expect(models).toContain('meta/llama-3.1-8b-instruct');
    expect(models).not.toContain('nvidia/nv-embedqa-e5-v5');
  });

  it('lists Ollama Cloud models through BYOK relay when a cloud key is saved', async () => {
    localStorage.setItem('luminara_ollama_key', 'ollama_cloud_test_key');
    // Local daemon miss
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              { name: 'gpt-oss:120b' },
              { name: 'kimi-k2.6' },
            ],
          }),
          { status: 200 },
        ),
      );

    const models = await configService.listOllamaModels();
    expect(models).toEqual(['gpt-oss:120b', 'kimi-k2.6']);
  });

  it('allows Ollama /v1/models on the Worker proxy allowlist', () => {
    const spec = { allow: ['/v1/chat/completions', '/v1/models', '/api/tags', '/api/generate', '/api/chat'] };
    expect(isPathAllowed(spec, '/v1/models')).toBe(true);
    expect(isPathAllowed(spec, '/api/tags')).toBe(true);
  });
});
