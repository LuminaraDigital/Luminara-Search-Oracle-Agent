import React from 'react';
import { Button } from '../../ui/Button';

export interface ApiKeyLlmTabProps {
  freeLlmBaseUrl: string;
  setFreeLlmBaseUrl: (val: string) => void;
  freeLlmKey: string;
  setFreeLlmKey: (val: string) => void;
  freeLlmPrefer: boolean;
  setFreeLlmPrefer: (val: boolean) => void;
  nvidiaKey: string;
  setNvidiaKey: (val: string) => void;
  nvidiaOrgId: string;
  setNvidiaOrgId: (val: string) => void;
  nvidiaDetectedModels: string[];
  groqKey: string;
  setGroqKey: (val: string) => void;
  groqFallbackKey: string;
  setGroqFallbackKey: (val: string) => void;
  openRouterKey: string;
  setOpenRouterKey: (val: string) => void;
  ollamaEndpoint: string;
  setOllamaEndpoint: (val: string) => void;
  ollamaModel: string;
  setOllamaModel: (val: string) => void;
  ollamaDetectedModels: string[];
  ollamaKey: string;
  setOllamaKey: (val: string) => void;
  geminiKey: string;
  setGeminiKey: (val: string) => void;
  visibleKeys: Record<string, boolean>;
  toggleVisibility: (id: string) => void;
  testingId: string | null;
  testResults: Record<string, { success: boolean; message: string; latencyMs: number }>;
  onRunPingTest: (id: string) => void;
}

export const ApiKeyLlmTab: React.FC<ApiKeyLlmTabProps> = ({
  freeLlmBaseUrl,
  setFreeLlmBaseUrl,
  freeLlmKey,
  setFreeLlmKey,
  freeLlmPrefer,
  setFreeLlmPrefer,
  nvidiaKey,
  setNvidiaKey,
  nvidiaOrgId,
  setNvidiaOrgId,
  nvidiaDetectedModels,
  groqKey,
  setGroqKey,
  groqFallbackKey,
  setGroqFallbackKey,
  openRouterKey,
  setOpenRouterKey,
  ollamaEndpoint,
  setOllamaEndpoint,
  ollamaModel,
  setOllamaModel,
  ollamaDetectedModels,
  ollamaKey,
  setOllamaKey,
  geminiKey,
  setGeminiKey,
  visibleKeys,
  toggleVisibility,
  testingId,
  testResults,
  onRunPingTest,
}) => {
  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-3 text-[11px] text-gray-300 leading-relaxed">
        <b className="text-gold-light">One-key gateway or Native Trinity.</b> Point Luminara at a local{' '}
        <a href="https://github.com/tashfeenahmed/freellmapi" target="_blank" rel="noopener noreferrer" className="text-gold-light underline">FreeLLMAPI</a>{' '}
        sidecar for a single unified key with automatic free-tier failover. Or wire NVIDIA NIM, Groq, OpenRouter, and Ollama individually. Gemini stays an optional fallback. FreeLLMAPI is BYOK / personal use only (not the multi-tenant hosted brain).
      </div>

      {/* 0. FreeLLMAPI One-Key Gateway */}
      <div className="p-3 rounded-xl bg-gold/10 border border-gold/40 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">
            0. FreeLLMAPI Gateway (Recommended for self-host)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold-light border border-gold/40 font-bold">
              One key · auto:fast / auto:smart
            </span>
            <Button
              variant="ghost"
              size="none"
              onClick={() => onRunPingTest('freellm')}
              disabled={testingId === 'freellm'}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
            >
              {testingId === 'freellm' ? 'Pinging…' : 'Ping'}
            </Button>
          </div>
        </div>
        <div>
          <label htmlFor="freellm-base-url" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
            Base URL (OpenAI-compatible /v1)
          </label>
          <input
            id="freellm-base-url"
            type="text"
            value={freeLlmBaseUrl}
            onChange={e => setFreeLlmBaseUrl(e.target.value)}
            placeholder="http://localhost:3001/v1"
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          />
        </div>
        <div>
          <label htmlFor="freellm-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
            Unified API Key · from FreeLLMAPI Keys page
          </label>
          <div className="relative">
            <input
              id="freellm-api-key"
              type={visibleKeys['freellm'] ? 'text' : 'password'}
              value={freeLlmKey}
              onChange={e => setFreeLlmKey(e.target.value)}
              placeholder="freellmapi-..."
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
            />
            <Button
              variant="ghost"
              size="none"
              onClick={() => toggleVisibility('freellm')}
              aria-pressed={!!visibleKeys['freellm']}
              aria-label={visibleKeys['freellm'] ? 'Hide FreeLLMAPI key' : 'Show FreeLLMAPI key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
            >
              {visibleKeys['freellm'] ? 'Hide' : 'Show'}
            </Button>
          </div>
          {testResults['freellm'] && (
            <p className={`text-[10px] mt-1 font-mono ${testResults['freellm'].success ? 'text-success-400' : 'text-warning-400'}`}>
              {testResults['freellm'].success ? '✓' : '✗'} {testResults['freellm'].message}
              {testResults['freellm'].latencyMs ? ` · ${testResults['freellm'].latencyMs}ms` : ''}
            </p>
          )}
        </div>
        <label className="flex items-start gap-2 cursor-pointer text-[11px] text-gray-300">
          <input
            type="checkbox"
            checked={freeLlmPrefer}
            onChange={e => setFreeLlmPrefer(e.target.checked)}
            className="mt-0.5 accent-[#bf953f]"
          />
          <span>
            Prefer FreeLLMAPI as primary gateway (puts it first for chat, audits, and Switchyard{' '}
            <code className="text-gold-light">auto:fast</code> / <code className="text-gold-light">auto:smart</code> routing).
            Turn off to keep pinned Groq/NIM for stricter JSON quality.
          </span>
        </label>
        <p className="text-[10px] text-gray-400">
          Runs in your browser against your sidecar only. Same base URL + key can power Cursor, Claude Code, and Codex. See docs/freellmapi.md.
        </p>
      </div>

      {/* 1. NVIDIA NIM (Native Primary Engine) */}
      <div className="p-3 rounded-xl bg-white/[0.02] border border-gold/30 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">
            1. NVIDIA NIM Enterprise
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold-light border border-gold/40 font-bold">
              Native Primary Engine
            </span>
            <Button
              variant="ghost"
              size="none"
              onClick={() => onRunPingTest('nvidia')}
              disabled={testingId === 'nvidia'}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
            >
              {testingId === 'nvidia' ? 'Pinging…' : 'Ping'}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="nvidia-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              NVIDIA API Key · <a href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded">get a key</a>
            </label>
            <div className="relative">
              <input
                id="nvidia-api-key"
                type={visibleKeys['nvidia'] ? 'text' : 'password'}
                value={nvidiaKey}
                onChange={e => setNvidiaKey(e.target.value)}
                placeholder="nvapi-..."
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
              />
              <Button
                variant="ghost"
                size="none"
                onClick={() => toggleVisibility('nvidia')}
                aria-pressed={!!visibleKeys['nvidia']}
                aria-label={visibleKeys['nvidia'] ? 'Hide NVIDIA key' : 'Show NVIDIA key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
              >
                {visibleKeys['nvidia'] ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>
          <div>
            <label htmlFor="nvidia-org-id" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              NVIDIA Org ID (Optional)
            </label>
            <input
              id="nvidia-org-id"
              type="text"
              value={nvidiaOrgId}
              onChange={e => setNvidiaOrgId(e.target.value)}
              placeholder="22aa30a8-..."
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            />
          </div>
        </div>
        {testResults['nvidia'] && (
          <p className={`text-[10px] mt-1 font-mono ${testResults['nvidia'].success ? 'text-success-400' : 'text-warning-400'}`}>
            {testResults['nvidia'].success ? '✓' : '✗'} {testResults['nvidia'].message} ({testResults['nvidia'].latencyMs}ms)
          </p>
        )}
        {nvidiaDetectedModels.length > 0 && (
          <p className="text-[10px] text-gray-400 font-mono">
            {nvidiaDetectedModels.length} chat models available in the composer picker (first 8):{' '}
            {nvidiaDetectedModels.slice(0, 8).join(', ')}
            {nvidiaDetectedModels.length > 8 ? '…' : ''}
          </p>
        )}
        <p className="text-[10px] text-gray-400">
          Bring-your-own key is relayed through the Worker in production (no CORS issues). After saving, open the composer model picker to choose any live NIM chat model.
        </p>
      </div>

      {/* 2. Groq Cloud LPU (Native High-Speed Engine) */}
      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">
            2. Groq Cloud LPU
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning-500/20 text-warning-400 border border-warning-500/30 font-bold">
              Native LPU (285 tok/s)
            </span>
            <Button
              variant="ghost"
              size="none"
              onClick={() => onRunPingTest('groq')}
              disabled={testingId === 'groq'}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
            >
              {testingId === 'groq' ? 'Pinging…' : 'Ping'}
            </Button>
          </div>
        </div>
        <div>
          <label htmlFor="groq-primary-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
            Groq Primary Key · <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded">get a key</a>
          </label>
          <div className="relative">
            <input
              id="groq-primary-key"
              type={visibleKeys['groq'] ? 'text' : 'password'}
              value={groqKey}
              onChange={e => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
            />
            <Button
              variant="ghost"
              size="none"
              onClick={() => toggleVisibility('groq')}
              aria-pressed={!!visibleKeys['groq']}
              aria-label={visibleKeys['groq'] ? 'Hide Groq primary key' : 'Show Groq primary key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
            >
              {visibleKeys['groq'] ? 'Hide' : 'Show'}
            </Button>
          </div>
          {testResults['groq'] && (
            <p className={`text-[10px] mt-1 font-mono ${testResults['groq'].success ? 'text-success-400' : 'text-warning-400'}`}>
              {testResults['groq'].success ? '✓' : '✗'} {testResults['groq'].message} ({testResults['groq'].latencyMs}ms)
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="groq-fallback-key" className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Groq Secondary / Fallback Key (Auto-Failover on Rate Limit)
            </label>
            {groqFallbackKey && (
              <Button
                variant="ghost"
                size="none"
                onClick={() => onRunPingTest('groq_fallback')}
                disabled={testingId === 'groq_fallback'}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono text-gold-light border border-gold/20"
              >
                {testingId === 'groq_fallback' ? 'Pinging…' : 'Ping Fallback'}
              </Button>
            )}
          </div>
          <div className="relative">
            <input
              id="groq-fallback-key"
              type={visibleKeys['groq_fallback'] ? 'text' : 'password'}
              value={groqFallbackKey}
              onChange={e => setGroqFallbackKey(e.target.value)}
              placeholder="gsk_..."
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
            />
            <Button
              variant="ghost"
              size="none"
              onClick={() => toggleVisibility('groq_fallback')}
              aria-pressed={!!visibleKeys['groq_fallback']}
              aria-label={visibleKeys['groq_fallback'] ? 'Hide Groq fallback key' : 'Show Groq fallback key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
            >
              {visibleKeys['groq_fallback'] ? 'Hide' : 'Show'}
            </Button>
          </div>
          {testResults['groq_fallback'] && (
            <p className={`text-[10px] mt-1 font-mono ${testResults['groq_fallback'].success ? 'text-success-400' : 'text-warning-400'}`}>
              {testResults['groq_fallback'].success ? '✓' : '✗'} {testResults['groq_fallback'].message} ({testResults['groq_fallback'].latencyMs}ms)
            </p>
          )}
        </div>
      </div>

      {/* 3. OpenRouter Frontier Intelligence */}
      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">
            3. OpenRouter Frontier Intelligence
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/10 text-gold-light border border-gold/30 font-bold">
              GPT-4o · Claude 3.5 · DeepSeek
            </span>
            <Button
              variant="ghost"
              size="none"
              onClick={() => onRunPingTest('openrouter')}
              disabled={testingId === 'openrouter'}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
            >
              {testingId === 'openrouter' ? 'Pinging…' : 'Ping'}
            </Button>
          </div>
        </div>
        <div>
          <label htmlFor="openrouter-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
            OpenRouter API Key · <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded">get a key</a>
          </label>
          <div className="relative">
            <input
              id="openrouter-api-key"
              type={visibleKeys['openrouter'] ? 'text' : 'password'}
              value={openRouterKey}
              onChange={e => setOpenRouterKey(e.target.value)}
              placeholder="sk-or-v1-..."
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
            />
            <Button
              variant="ghost"
              size="none"
              onClick={() => toggleVisibility('openrouter')}
              aria-pressed={!!visibleKeys['openrouter']}
              aria-label={visibleKeys['openrouter'] ? 'Hide OpenRouter key' : 'Show OpenRouter key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
            >
              {visibleKeys['openrouter'] ? 'Hide' : 'Show'}
            </Button>
          </div>
          {testResults['openrouter'] && (
            <p className={`text-[10px] mt-1 font-mono ${testResults['openrouter'].success ? 'text-success-400' : 'text-warning-400'}`}>
              {testResults['openrouter'].success ? '✓' : '✗'} {testResults['openrouter'].message} ({testResults['openrouter'].latencyMs}ms)
            </p>
          )}
          <p className="text-[10px] text-gray-400 mt-1">
            Included in Luminara Paid Tier (or bring your own key).
          </p>
        </div>
      </div>

      {/* 4. Ollama Sovereign Engine */}
      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">
            4. Ollama Sovereign SLM
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-success-500/20 text-success-400 border border-success-500/30 font-bold">
              Local & Sovereign Cloud
            </span>
            <Button
              variant="ghost"
              size="none"
              onClick={() => onRunPingTest('ollama')}
              disabled={testingId === 'ollama'}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
            >
              {testingId === 'ollama' ? 'Pinging…' : 'Ping'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="ollama-endpoint-url" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              Ollama Endpoint URL
            </label>
            <input
              id="ollama-endpoint-url"
              type="text"
              value={ollamaEndpoint}
              onChange={e => setOllamaEndpoint(e.target.value)}
              placeholder="http://127.0.0.1:11434"
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            />
          </div>
          <div>
            <label htmlFor="ollama-model-name" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              Ollama Model Name {ollamaDetectedModels.length > 0 && `(${ollamaDetectedModels.length} detected)`}
            </label>
            <input
              id="ollama-model-name"
              type="text"
              list="ollama-models-list"
              value={ollamaModel}
              onChange={e => setOllamaModel(e.target.value)}
              placeholder="llama3.2"
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            />
            <datalist id="ollama-models-list">
              {ollamaDetectedModels.map(m => (
                <option key={m} value={m} />
              ))}
              <option value="llama3.2" />
              <option value="llama3.3" />
              <option value="qwen2.5-coder" />
              <option value="mistral" />
              <option value="deepseek-r1" />
            </datalist>
          </div>
        </div>

        <div>
          <label htmlFor="ollama-cloud-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
            Ollama Cloud API Key · <a href="https://ollama.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded">get a key</a>
          </label>
          <div className="relative">
            <input
              id="ollama-cloud-key"
              type={visibleKeys['ollama'] ? 'text' : 'password'}
              value={ollamaKey}
              onChange={e => setOllamaKey(e.target.value)}
              placeholder="f2aed... (optional if local daemon is running)"
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
            />
            <Button
              variant="ghost"
              size="none"
              onClick={() => toggleVisibility('ollama')}
              aria-pressed={!!visibleKeys['ollama']}
              aria-label={visibleKeys['ollama'] ? 'Hide Ollama key' : 'Show Ollama key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
            >
              {visibleKeys['ollama'] ? 'Hide' : 'Show'}
            </Button>
          </div>
          {testResults['ollama'] && (
            <p className={`text-[10px] mt-1 font-mono ${testResults['ollama'].success ? 'text-success-400' : 'text-warning-400'}`}>
              {testResults['ollama'].success ? '✓' : '✗'} {testResults['ollama'].message} ({testResults['ollama'].latencyMs}ms)
            </p>
          )}
          <p className="text-[10px] text-gray-400 mt-1">
            Local daemon at <code className="text-gold-light">{ollamaEndpoint || 'http://127.0.0.1:11434'}</code> is auto-detected without a key.
            With an Ollama Cloud key, Ping lists every cloud model for the composer picker. Cloud chat uses the Worker BYOK relay in production.
          </p>
        </div>
      </div>

      {/* 5. Google Gemini (Auxiliary Fallback) */}
      <div className="p-3 rounded-xl bg-white/[0.01] border border-white/5 space-y-2 opacity-80">
        <div className="flex items-center justify-between">
          <label htmlFor="gemini-fallback-key" className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            5. Google Gemini
          </label>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
            Optional Fallback Only
          </span>
        </div>
        <input
          id="gemini-fallback-key"
          type="password"
          value={geminiKey}
          onChange={e => setGeminiKey(e.target.value)}
          placeholder="AIzaSy... (optional tertiary fallback)"
          className="w-full bg-black/60 border border-white/10 focus:border-gray-500 rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
        />
        <p className="text-[10px] text-gray-400">Only invoked if all native engines (NVIDIA, Groq, Ollama) are unavailable.</p>
      </div>
    </div>
  );
};
