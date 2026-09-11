import { describe, expect, it, beforeEach, vi } from 'vitest';
import { configService } from '../services/configService';
import { aiProviderService, GROQ_DEFAULT_MODEL } from '../services/aiProviderService';
import {
  displayChatModelPreference,
  mergeOllamaDetectedModels,
  parseChatModelPreference,
  CHAT_MODEL_PREF_KEY,
} from '../services/llm/chatModelCatalog';
import { groqModelCandidates, nimModelCandidates } from '../services/llm/nativeModelDefaults';

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

describe('Composer chat model preference (Hermes-style)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    aiProviderService.clearCooldowns();
  });

  it('defaults to Auto mode', () => {
    const pref = configService.getChatModelPreference();
    expect(pref.mode).toBe('auto');
    expect(displayChatModelPreference(pref)).toBe('Auto');
  });

  it('persists a manual provider+model pick without rewriting failover order', () => {
    const beforeOrder = configService.getNativePriority();
    const next = configService.setChatModelPreference({
      mode: 'manual',
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    expect(next.mode).toBe('manual');
    expect(configService.getChatModelPreference()).toEqual(next);
    expect(JSON.parse(localStorage.getItem(CHAT_MODEL_PREF_KEY)!).model).toBe('openai/gpt-4o-mini');
    expect(configService.getNativePriority()).toEqual(beforeOrder);
    expect(displayChatModelPreference(next)).toBe('GPT-4o Mini');
  });

  it('pins preferred provider first in getBestAvailableProvider', async () => {
    configService.setChatModelPreference({
      mode: 'manual',
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    });
    const groq = aiProviderService.getProvider('groq');
    const openrouter = aiProviderService.getProvider('openrouter');
    vi.spyOn(groq!, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(openrouter!, 'isAvailable').mockResolvedValue(true);

    const best = await aiProviderService.getBestAvailableProvider('openrouter');
    expect(best?.id).toBe('openrouter');
  });

  it('passes the composer model only to the pinned provider during failover', async () => {
    configService.setNativePriority(['groq', 'nim', 'openrouter', 'ollama', 'freellm']);
    configService.setChatModelPreference({
      mode: 'manual',
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
    });

    const groq = aiProviderService.getProvider('groq');
    const nim = aiProviderService.getProvider('nim');
    vi.spyOn(groq!, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(nim!, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(groq!, 'generateText').mockRejectedValue(new Error('Groq down'));
    const nimSpy = vi.spyOn(nim!, 'generateText').mockResolvedValue({
      text: 'ok',
      finishReason: 'stop',
      latencyMs: 10,
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
    });

    const result = await aiProviderService.generateWithFailover('hello');
    expect(result.text).toBe('ok');
    expect(nimSpy).toHaveBeenCalled();
    const nimOpts = nimSpy.mock.calls[0][1];
    expect(nimOpts?.model).toBeUndefined();
  });

  it('parses corrupt preference JSON as Auto', () => {
    expect(parseChatModelPreference('{not-json')).toMatchObject({ mode: 'auto' });
    expect(parseChatModelPreference(JSON.stringify({ mode: 'manual' }))).toMatchObject({ mode: 'auto' });
  });

  it('merges detected Ollama models into the catalog group', () => {
    const groups = mergeOllamaDetectedModels(['llama3.2', 'custom-coder:7b']);
    const ollama = groups.find((g) => g.provider === 'ollama')!;
    expect(ollama.models.some((m) => m.model === 'custom-coder:7b')).toBe(true);
    expect(ollama.models.filter((m) => m.model === 'llama3.2').length).toBe(1);
  });

  it('builds Groq/NIM model ladders with preferred first', () => {
    expect(groqModelCandidates('qwen/qwen3.6-27b')[0]).toBe('qwen/qwen3.6-27b');
    expect(groqModelCandidates()[0]).toBe(GROQ_DEFAULT_MODEL);
    expect(nimModelCandidates('nvidia/llama-3.1-nemotron-70b-instruct')[0]).toBe(
      'nvidia/llama-3.1-nemotron-70b-instruct',
    );
  });
});
