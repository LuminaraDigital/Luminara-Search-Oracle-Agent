import { describe, expect, it, beforeEach, vi } from 'vitest';
import { aiProviderService, safeJsonParse } from '../services/aiProviderService';
import { configService } from '../services/configService';
import { geminiService } from '../services/geminiService';

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

describe('Native LLM Trinity (NVIDIA NIM, Groq, Ollama)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  describe('safeJsonParse', () => {
    it('correctly parses raw valid JSON', () => {
      const parsed = safeJsonParse('{"name": "Luminara", "score": 98}', { name: '', score: 0 });
      expect(parsed.name).toBe('Luminara');
      expect(parsed.score).toBe(98);
    });

    it('strips markdown code fences from open-weight model outputs', () => {
      const fenced = '```json\n{\n  "name": "Groq LPU",\n  "status": "active"\n}\n```';
      const parsed = safeJsonParse(fenced, { name: '', status: '' });
      expect(parsed.name).toBe('Groq LPU');
      expect(parsed.status).toBe('active');
    });

    it('extracts JSON when preceded or followed by model commentary', () => {
      const withProse = 'Here is the requested strategic profile:\n\n{"mission": "Enterprise Leadership", "usp": "Speed"}\n\nHope this helps!';
      const parsed = safeJsonParse(withProse, { mission: '', usp: '' });
      expect(parsed.mission).toBe('Enterprise Leadership');
      expect(parsed.usp).toBe('Speed');
    });

    it('returns fallback safely on malformed JSON without crashing', () => {
      const broken = 'Not a json string at all';
      const fallback = { fallback: true };
      const parsed = safeJsonParse(broken, fallback);
      expect(parsed).toEqual(fallback);
    });
  });

  describe('Native Engine Priority & Resolution', () => {
    it('defaults native priority to NVIDIA NIM -> Groq -> OpenRouter -> Ollama -> FreeLLM', () => {
      const order = configService.getNativePriority();
      expect(order).toEqual(['nim', 'groq', 'openrouter', 'ollama', 'freellm']);
    });

    it('prioritizes NVIDIA NIM when configured', async () => {
      localStorage.setItem('luminara_nvidia_key', 'nvapi-test-key-12345');
      localStorage.setItem('luminara_groq_key', 'gsk_test_groq_key');

      // Mock NIM availability
      const nim = aiProviderService.getProvider('nim');
      vi.spyOn(nim!, 'isAvailable').mockResolvedValue(true);

      const best = await aiProviderService.getBestAvailableProvider();
      expect(best?.id).toBe('nim');
    });

    it('resolves to Groq when NVIDIA NIM is unavailable', async () => {
      localStorage.setItem('luminara_groq_key', 'gsk_test_groq_key');

      const nim = aiProviderService.getProvider('nim');
      vi.spyOn(nim!, 'isAvailable').mockResolvedValue(false);

      const groq = aiProviderService.getProvider('groq');
      vi.spyOn(groq!, 'isAvailable').mockResolvedValue(true);

      const best = await aiProviderService.getBestAvailableProvider();
      expect(best?.id).toBe('groq');
    });

    it('resolves to OpenRouter when NVIDIA NIM and Groq are unavailable', async () => {
      const nim = aiProviderService.getProvider('nim');
      vi.spyOn(nim!, 'isAvailable').mockResolvedValue(false);

      const groq = aiProviderService.getProvider('groq');
      vi.spyOn(groq!, 'isAvailable').mockResolvedValue(false);

      const openrouter = aiProviderService.getProvider('openrouter');
      vi.spyOn(openrouter!, 'isAvailable').mockResolvedValue(true);

      const best = await aiProviderService.getBestAvailableProvider();
      expect(best?.id).toBe('openrouter');
    });

    it('resolves to Ollama when Groq, NVIDIA, and OpenRouter are unavailable', async () => {
      const nim = aiProviderService.getProvider('nim');
      vi.spyOn(nim!, 'isAvailable').mockResolvedValue(false);

      const groq = aiProviderService.getProvider('groq');
      vi.spyOn(groq!, 'isAvailable').mockResolvedValue(false);

      const openrouter = aiProviderService.getProvider('openrouter');
      vi.spyOn(openrouter!, 'isAvailable').mockResolvedValue(false);

      const ollama = aiProviderService.getProvider('ollama');
      vi.spyOn(ollama!, 'isAvailable').mockResolvedValue(true);

      const best = await aiProviderService.getBestAvailableProvider();
      expect(best?.id).toBe('ollama');
    });
  });

  describe('Automatic Failover Between Native Engines', () => {
    it('fails over from NVIDIA NIM to Groq when NIM encounters an error', async () => {
      const nim = aiProviderService.getProvider('nim');
      const groq = aiProviderService.getProvider('groq');

      vi.spyOn(nim!, 'isAvailable').mockResolvedValue(true);
      vi.spyOn(groq!, 'isAvailable').mockResolvedValue(true);

      vi.spyOn(nim!, 'generateText').mockRejectedValue(new Error('NVIDIA NIM connection refused'));
      vi.spyOn(groq!, 'generateText').mockResolvedValue({
        text: 'Groq generated response successfully',
        finishReason: 'stop',
        latencyMs: 85,
        tokenUsage: { prompt: 10, completion: 5, total: 15 },
      });

      const failoverSpy = vi.fn();
      window.addEventListener('luminara-llm-failover', failoverSpy);

      const result = await aiProviderService.generateWithFailover('Test prompt');
      expect(result.text).toBe('Groq generated response successfully');
      expect(failoverSpy).toHaveBeenCalledTimes(1);

      window.removeEventListener('luminara-llm-failover', failoverSpy);
    });
  });

  describe('Core Service Facade with Zero-Gemini-Key', () => {
    it('executes extractBusinessDNA completely on Groq without Gemini key', async () => {
      mockLocalStorage.setItem('luminara_groq_key', 'gsk_mock');
      mockLocalStorage.removeItem('luminara_api_key');

      const groq = aiProviderService.getProvider('groq');
      vi.spyOn(groq!, 'isAvailable').mockResolvedValue(true);
      vi.spyOn(groq!, 'generateText').mockResolvedValue({
        text: '```json\n{"name": "Acme Corp", "mission": "Build great things", "usp": "Fastest delivery", "targetAudience": "Enterprises", "competitors": ["CompX"], "perceivedGaps": ["AEO visibility"], "rawContext": "Acme profile"}\n```',
        finishReason: 'stop',
        latencyMs: 120,
        tokenUsage: { prompt: 20, completion: 20, total: 40 },
      });

      const dna = await geminiService.extractBusinessDNA('AcmeCorp');
      expect(dna.name).toBe('Acme Corp');
      expect(dna.mission).toBe('Build great things');
      expect(dna.usp).toBe('Fastest delivery');
      expect(dna.competitors).toContain('CompX');
    });

    it('throws informative ProviderUnavailableError citing Native Trinity when all native engines are unconfigured', async () => {
      mockLocalStorage.clear();
      const nim = aiProviderService.getProvider('nim');
      const groq = aiProviderService.getProvider('groq');
      const ollama = aiProviderService.getProvider('ollama');

      vi.spyOn(nim!, 'isAvailable').mockResolvedValue(false);
      vi.spyOn(groq!, 'isAvailable').mockResolvedValue(false);
      vi.spyOn(ollama!, 'isAvailable').mockResolvedValue(false);

      await expect(geminiService.generateText('test')).rejects.toThrowError(
        /No native LLM responded.*NVIDIA NIM.*Groq.*Ollama/
      );
    });
  });
});
