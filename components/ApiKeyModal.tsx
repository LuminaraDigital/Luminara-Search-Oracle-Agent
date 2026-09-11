import React, { useState, useEffect, useRef } from 'react';
import { ICONS } from '../constants';
import { configService, ProviderStatus } from '../services/configService';
import { noteWorkspaceDirty } from '../services/sync/workspaceSyncService';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';
import { AuthPanel } from './auth/AuthPanel';
import { Button } from './ui/Button';
import { useConfirm } from './ui/ConfirmModal';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeySaved: () => void;
}

type TabType = 'overview' | 'llm' | 'search' | 'scraping' | 'extra';

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onKeySaved }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const { requestConfirm, confirmModal } = useConfirm();
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Form values
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [groqFallbackKey, setGroqFallbackKey] = useState('');
  const [nvidiaKey, setNvidiaKey] = useState('');
  const [nvidiaOrgId, setNvidiaOrgId] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [ollamaKey, setOllamaKey] = useState('');
  const [ollamaEndpoint, setOllamaEndpoint] = useState('http://127.0.0.1:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3.2');
  const [ollamaDetectedModels, setOllamaDetectedModels] = useState<string[]>([]);
  const [freeLlmKey, setFreeLlmKey] = useState('');
  const [freeLlmBaseUrl, setFreeLlmBaseUrl] = useState('http://localhost:3001/v1');
  const [freeLlmPrefer, setFreeLlmPrefer] = useState(true);
  const [tavilyKey, setTavilyKey] = useState('');
  const [exaKey, setExaKey] = useState('');
  const [localSerpUrl, setLocalSerpUrl] = useState('http://localhost:3001');
  const [localSerpEnabled, setLocalSerpEnabled] = useState(true);
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [browserbaseKey, setBrowserbaseKey] = useState('');
  const [crawlerProvider, setCrawlerProvider] = useState<'auto' | 'patchright' | 'firecrawl' | 'jina'>('auto');
  const [sitewideMode, setSitewideMode] = useState<'off' | 'smart' | 'deep'>('smart');
  const [sitewideMaxPages, setSitewideMaxPages] = useState(6);
  const [patchrightUrl, setPatchrightUrl] = useState('http://localhost:3001');
  const [crawlerProxy, setCrawlerProxy] = useState('');
  const [crawlerToken, setCrawlerToken] = useState('');
  const [falKey, setFalKey] = useState('');
  const [tinkerKey, setTinkerKey] = useState('');
  const [writingCheckUrl, setWritingCheckUrl] = useState('');
  const [resultsTrackingUrl, setResultsTrackingUrl] = useState('');
  const [resultsTrackingKey, setResultsTrackingKey] = useState('');

  // Visibility states
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  // Live ping testing states
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; latencyMs: number }>>({});
  const [savedSuccess, setSavedSuccess] = useState(false);

  const refreshStatuses = () => {
    setStatuses(configService.getAllStatuses());
    setGeminiKey(localStorage.getItem('luminara_api_key') || '');
    setGroqKey(localStorage.getItem('luminara_groq_key') || '');
    setGroqFallbackKey(localStorage.getItem('luminara_groq_fallback_key') || '');
    setNvidiaKey(localStorage.getItem('luminara_nvidia_key') || '');
    setNvidiaOrgId(localStorage.getItem('luminara_nvidia_org_id') || '');
    setOpenRouterKey(localStorage.getItem('luminara_openrouter_key') || '');
    setOllamaKey(localStorage.getItem('luminara_ollama_key') || '');
    setOllamaEndpoint(configService.getOllamaEndpoint());
    setOllamaModel(configService.getOllamaModel());
    setFreeLlmKey(localStorage.getItem('luminara_freellm_key') || '');
    setFreeLlmBaseUrl(configService.getFreeLlmBaseUrl());
    setFreeLlmPrefer(configService.isFreeLlmPreferGateway());
    setTavilyKey(localStorage.getItem('luminara_tavily_key') || '');
    setExaKey(localStorage.getItem('luminara_exa_key') || '');
    setLocalSerpUrl(configService.getLocalSerpUrl());
    setLocalSerpEnabled(configService.isLocalSerpEnabled());
    setFirecrawlKey(localStorage.getItem('luminara_firecrawl_key') || '');
    setBrowserbaseKey(localStorage.getItem('luminara_browserbase_key') || '');
    setCrawlerProvider(configService.getCrawlerProvider());
    setSitewideMode(configService.getSitewideEvidenceMode());
    setSitewideMaxPages(configService.getSitewideMaxPages());
    setPatchrightUrl(configService.getPatchrightUrl());
    setCrawlerProxy(configService.getCrawlerProxy());
    setCrawlerToken(configService.getCrawlerToken());
    setFalKey(localStorage.getItem('luminara_fal_key') || '');
    setTinkerKey(localStorage.getItem('luminara_tinker_key') || '');
    setWritingCheckUrl(configService.getLanguageToolUrl());
    setResultsTrackingUrl(configService.getUmamiUrl());
    setResultsTrackingKey(configService.getUmamiApiKey());
  };

  useEffect(() => {
    if (isOpen) {
      refreshStatuses();
      setSavedSuccess(false);
    }
  }, [isOpen]);

  // Escape closes the dialog, like every other overlay in the app.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Move keyboard focus into the dialog so Tab does not land on the page behind it.
    const raf = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleVisibility = (id: string) => {
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSaveAll = () => {
    configService.setKey('luminara_api_key', geminiKey);
    configService.setKey('luminara_groq_key', groqKey);
    configService.setKey('luminara_groq_fallback_key', groqFallbackKey);
    configService.setKey('luminara_nvidia_key', nvidiaKey);
    configService.setKey('luminara_nvidia_org_id', nvidiaOrgId);
    configService.setKey('luminara_openrouter_key', openRouterKey);
    configService.setKey('luminara_ollama_key', ollamaKey);
    configService.setOllamaEndpoint(ollamaEndpoint.trim());
    configService.setOllamaModel(ollamaModel.trim());
    configService.setFreeLlmKey(freeLlmKey);
    configService.setFreeLlmBaseUrl(freeLlmBaseUrl);
    configService.setFreeLlmPreferGateway(freeLlmPrefer);
    configService.setKey('luminara_tavily_key', tavilyKey);
    configService.setKey('luminara_exa_key', exaKey);
    configService.setLocalSerpUrl(localSerpUrl);
    configService.setLocalSerpEnabled(localSerpEnabled);
    configService.setKey('luminara_firecrawl_key', firecrawlKey);
    configService.setKey('luminara_browserbase_key', browserbaseKey);
    configService.setCrawlerProvider(crawlerProvider);
    configService.setSitewideEvidenceMode(sitewideMode);
    configService.setSitewideMaxPages(sitewideMaxPages);
    configService.setPatchrightUrl(patchrightUrl);
    configService.setCrawlerProxy(crawlerProxy);
    configService.setCrawlerToken(crawlerToken.trim());
    configService.setKey('luminara_fal_key', falKey);
    configService.setKey('luminara_tinker_key', tinkerKey);
    configService.setLanguageToolUrl(writingCheckUrl.trim());
    configService.setUmamiUrl(resultsTrackingUrl.trim());
    configService.setUmamiApiKey(resultsTrackingKey.trim());

    noteWorkspaceDirty();
    refreshStatuses();
    setSavedSuccess(true);
    onKeySaved();
    setTimeout(() => {
      setSavedSuccess(false);
    }, 2000);
  };

  const handleRunPingTest = async (providerId: string) => {
    setTestingId(providerId);
    let res: { success: boolean; message: string; latencyMs: number } = { success: false, message: 'Not implemented', latencyMs: 0 };
    if (providerId === 'groq') {
      res = await configService.testGroq(groqKey || groqFallbackKey);
    } else if (providerId === 'groq_fallback') {
      res = await configService.testGroq(groqFallbackKey);
    } else if (providerId === 'tavily') {
      res = await configService.testTavily();
    } else if (providerId === 'local_serp') {
      res = await configService.testLocalSerp();
    } else if (providerId === 'firecrawl') {
      res = await configService.testFirecrawl();
    } else if (providerId === 'patchright') {
      res = await configService.testPatchright();
    } else if (providerId === 'exa') {
      res = await configService.testExa();
    } else if (providerId === 'nvidia') {
      res = await configService.testNvidia(nvidiaKey, nvidiaOrgId);
    } else if (providerId === 'openrouter') {
      res = await configService.testOpenRouter();
    } else if (providerId === 'freellm') {
      res = await configService.testFreeLlm();
    } else if (providerId === 'ollama') {
      const o = await configService.testOllama(ollamaEndpoint, ollamaKey);
      res = { success: o.success, message: o.message, latencyMs: o.latencyMs };
      if (o.models && o.models.length > 0) {
        setOllamaDetectedModels(o.models);
      }
    } else if (providerId === 'writing_check') {
      res = await configService.testWritingCheck();
    } else if (providerId === 'results_tracking') {
      res = await configService.testResultsTracking();
    }
    setTestResults(prev => ({ ...prev, [providerId]: res }));
    setTestingId(null);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="glass-morphism border border-gold/40 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden relative bg-black/95 flex flex-col max-h-[90vh] outline-none"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-gold/20 to-transparent px-6 py-4 border-b border-gold/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
              <ICONS.Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-gold-light">Settings</h3>
              <p className="text-[10px] text-gray-400 font-mono">Keys are stored only in this browser. For production, route calls through a server so keys never ship to clients.</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
            <ICONS.X className="w-5 h-5" />
            </Button>
        </div>

        {/* Tab Navigation */}
        <div role="tablist" aria-label="Settings sections" className="flex items-center gap-2 px-6 pt-3 border-b border-white/5 bg-black/40 shrink-0 overflow-x-auto text-[10px] font-mono uppercase tracking-wider">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-t ${activeTab === 'overview' ? 'border-gold text-gold-light' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Overview ({statuses.filter(s => s.isConfigured).length}/{statuses.length} connected)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'llm'}
            onClick={() => setActiveTab('llm')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-t ${activeTab === 'llm' ? 'border-gold text-gold-light' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            AI keys
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'search'}
            onClick={() => setActiveTab('search')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-t ${activeTab === 'search' ? 'border-gold text-gold-light' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Live search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'scraping'}
            onClick={() => setActiveTab('scraping')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-t ${activeTab === 'scraping' ? 'border-gold text-gold-light' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Website scanning
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'extra'}
            onClick={() => setActiveTab('extra')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-t ${activeTab === 'extra' ? 'border-gold text-gold-light' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Other
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-3">
              <AuthPanel compact />
              <TelegramAccountPanel compact />
              <p className="text-xs text-gray-400 leading-relaxed">
                Luminara needs one AI key to work (Groq is the easiest to start with). Add a live-search key to ground answers in real search results. Your keys stay on this device and work without signing in. Sign in above only if you want Luminara-hosted keys, synced workspace, or paid plans.
              </p>
              <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer">
                <span className="text-xs text-gray-300">Show developer tools (engine status, themes, Labs previews)</span>
                <input
                  type="checkbox"
                  defaultChecked={typeof window !== 'undefined' && localStorage.getItem('luminara_advanced_ui') === '1'}
                  onChange={e => {
                    localStorage.setItem('luminara_advanced_ui', e.target.checked ? '1' : '0');
                    window.dispatchEvent(new Event('luminara-advanced-ui'));
                  }}
                  className="accent-gold w-4 h-4"
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2">
                {statuses.map(s => {
                  const test = testResults[s.id];
                  const isTesting = testingId === s.id;
                  return (
                    <div key={s.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col justify-between gap-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-gray-200">{s.name}</span>
                          <span className="block text-[9px] font-mono text-gray-500 uppercase">{s.category}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider font-bold ${
                          s.isConfigured 
                            ? s.source === 'env' || s.source === 'server' ? 'bg-success-500/10 text-success-400 border border-success-500/30' : 'bg-warning-500/10 text-warning-400 border border-warning-500/30'
                            : 'bg-white/5 text-gray-500 border border-white/10'
                        }`}>
                          {s.isConfigured ? (s.source === 'server' ? 'Provided by Luminara' : s.source === 'env' ? 'Connected' : 'Your key') : 'Not connected'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-[10px] font-mono text-gray-400">
                        <span>{s.isConfigured ? s.maskedKey : 'Add a key in the tabs above'}</span>
                        {(['groq', 'tavily', 'firecrawl', 'patchright', 'exa', 'nvidia', 'writing_check', 'results_tracking'].includes(s.id) && s.isConfigured || s.id === 'ollama') && (
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => handleRunPingTest(s.id)}
                            loading={isTesting}
                            className="normal-case tracking-normal"
                            >
                            {isTesting ? 'Testing…' : test ? (test.success ? `✓ Works (${test.latencyMs}ms)` : '✗ Not working') : 'Test'}
                            </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: LLM ENGINES */}
          {activeTab === 'llm' && (
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
                      onClick={() => handleRunPingTest('freellm')}
                      disabled={testingId === 'freellm'}
                      className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
                    >
                      {testingId === 'freellm' ? 'Pinging…' : 'Ping'}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Base URL (OpenAI-compatible /v1)
                  </label>
                  <input
                    type="text"
                    value={freeLlmBaseUrl}
                    onChange={e => setFreeLlmBaseUrl(e.target.value)}
                    placeholder="http://localhost:3001/v1"
                    className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Unified API Key · from FreeLLMAPI Keys page
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys['freellm'] ? 'text' : 'password'}
                      value={freeLlmKey}
                      onChange={e => setFreeLlmKey(e.target.value)}
                      placeholder="freellmapi-..."
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                    />
                    <Button
                      variant="ghost"
                      size="none"
                      onClick={() => toggleVisibility('freellm')}
                      aria-pressed={!!visibleKeys['freellm']}
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
                <p className="text-[10px] text-gray-500">
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
                      onClick={() => handleRunPingTest('nvidia')}
                      disabled={testingId === 'nvidia'}
                      className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
                    >
                      {testingId === 'nvidia' ? 'Pinging…' : 'Ping'}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                      NVIDIA API Key · <a href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline">get a key</a>
                    </label>
                    <div className="relative">
                      <input
                        type={visibleKeys['nvidia'] ? 'text' : 'password'}
                        value={nvidiaKey}
                        onChange={e => setNvidiaKey(e.target.value)}
                        placeholder="nvapi-..."
                        className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                      />
                      <Button
                        variant="ghost"
                        size="none"
                        onClick={() => toggleVisibility('nvidia')}
                        aria-pressed={!!visibleKeys['nvidia']}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
                      >
                        {visibleKeys['nvidia'] ? 'Hide' : 'Show'}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                      NVIDIA Org ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={nvidiaOrgId}
                      onChange={e => setNvidiaOrgId(e.target.value)}
                      placeholder="22aa30a8-..."
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                    />
                  </div>
                </div>
                {testResults['nvidia'] && (
                  <p className={`text-[10px] mt-1 font-mono ${testResults['nvidia'].success ? 'text-success-400' : 'text-warning-400'}`}>
                    {testResults['nvidia'].success ? '✓' : '✗'} {testResults['nvidia'].message} ({testResults['nvidia'].latencyMs}ms)
                  </p>
                )}
                <p className="text-[10px] text-gray-500">Accelerated Llama-3.3-70B and DeepSeek-R1 inference via NVIDIA NIM.</p>
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
                      onClick={() => handleRunPingTest('groq')}
                      disabled={testingId === 'groq'}
                      className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
                    >
                      {testingId === 'groq' ? 'Pinging…' : 'Ping'}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Groq Primary Key · <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline">get a key</a>
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys['groq'] ? 'text' : 'password'}
                      value={groqKey}
                      onChange={e => setGroqKey(e.target.value)}
                      placeholder="gsk_..."
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                    />
                    <Button
                      variant="ghost"
                      size="none"
                      onClick={() => toggleVisibility('groq')}
                      aria-pressed={!!visibleKeys['groq']}
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
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Groq Secondary / Fallback Key (Auto-Failover on Rate Limit)
                    </label>
                    {groqFallbackKey && (
                      <Button
                        variant="ghost"
                        size="none"
                        onClick={() => handleRunPingTest('groq_fallback')}
                        disabled={testingId === 'groq_fallback'}
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono text-gold-light border border-gold/20"
                      >
                        {testingId === 'groq_fallback' ? 'Pinging…' : 'Ping Fallback'}
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={visibleKeys['groq_fallback'] ? 'text' : 'password'}
                      value={groqFallbackKey}
                      onChange={e => setGroqFallbackKey(e.target.value)}
                      placeholder="gsk_..."
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                    />
                    <Button
                      variant="ghost"
                      size="none"
                      onClick={() => toggleVisibility('groq_fallback')}
                      aria-pressed={!!visibleKeys['groq_fallback']}
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
                      onClick={() => handleRunPingTest('openrouter')}
                      disabled={testingId === 'openrouter'}
                      className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
                    >
                      {testingId === 'openrouter' ? 'Pinging…' : 'Ping'}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    OpenRouter API Key · <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline">get a key</a>
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys['openrouter'] ? 'text' : 'password'}
                      value={openRouterKey}
                      onChange={e => setOpenRouterKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                    />
                    <Button
                      variant="ghost"
                      size="none"
                      onClick={() => toggleVisibility('openrouter')}
                      aria-pressed={!!visibleKeys['openrouter']}
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
                  <p className="text-[10px] text-gray-500 mt-1">
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
                      onClick={() => handleRunPingTest('ollama')}
                      disabled={testingId === 'ollama'}
                      className="px-2 py-0.5 rounded text-[10px] font-mono text-gold-light border border-gold/30 bg-gold/5 hover:bg-gold/15"
                    >
                      {testingId === 'ollama' ? 'Pinging…' : 'Ping'}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                      Ollama Endpoint URL
                    </label>
                    <input
                      type="text"
                      value={ollamaEndpoint}
                      onChange={e => setOllamaEndpoint(e.target.value)}
                      placeholder="http://127.0.0.1:11434"
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                      Ollama Model Name {ollamaDetectedModels.length > 0 && `(${ollamaDetectedModels.length} detected)`}
                    </label>
                    <input
                      type="text"
                      list="ollama-models-list"
                      value={ollamaModel}
                      onChange={e => setOllamaModel(e.target.value)}
                      placeholder="llama3.2"
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
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
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    Ollama Cloud API Key · <a href="https://ollama.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-gold-light underline">get a key</a>
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys['ollama'] ? 'text' : 'password'}
                      value={ollamaKey}
                      onChange={e => setOllamaKey(e.target.value)}
                      placeholder="f2aed... (optional if local daemon is running)"
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                    />
                    <Button
                      variant="ghost"
                      size="none"
                      onClick={() => toggleVisibility('ollama')}
                      aria-pressed={!!visibleKeys['ollama']}
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
                  <p className="text-[10px] text-gray-500 mt-1">
                    Local daemon at <code className="text-gold-light">{ollamaEndpoint || 'http://127.0.0.1:11434'}</code> is auto-detected natively without needing any key.
                  </p>
                </div>
              </div>

              {/* 5. Google Gemini (Auxiliary Fallback) */}
              <div className="p-3 rounded-xl bg-white/[0.01] border border-white/5 space-y-2 opacity-80">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    5. Google Gemini
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                    Optional Fallback Only
                  </span>
                </div>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy... (optional tertiary fallback)"
                  className="w-full bg-black/60 border border-white/10 focus:border-gray-500 rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                />
                <p className="text-[10px] text-gray-500">Only invoked if all native engines (NVIDIA, Groq, Ollama) are unavailable.</p>
              </div>
            </div>
          )}

          {/* TAB 3: SEARCH & SERP */}
          {activeTab === 'search' && (
            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Tavily Search API Key (Live SERP Citations)
                </label>
                <div className="relative">
                  <input
                    type={visibleKeys['tavily'] ? 'text' : 'password'}
                    value={tavilyKey}
                    onChange={e => setTavilyKey(e.target.value)}
                    placeholder="tvly-..."
                    className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <Button
                    variant="ghost"
                    size="none"
                    onClick={() => toggleVisibility('tavily')}
                    aria-pressed={!!visibleKeys['tavily']}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
                    >
                    {visibleKeys['tavily'] ? 'Hide' : 'Show'}
                    </Button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Grounds Oracle Agent and Instant Audit with real Google SERP rankings.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Exa.ai API Key (Neural Semantic Search)
                </label>
                <div className="relative">
                  <input
                    type={visibleKeys['exa'] ? 'text' : 'password'}
                    value={exaKey}
                    onChange={e => setExaKey(e.target.value)}
                    placeholder="ddcd..."
                    className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <Button
                    variant="ghost"
                    size="none"
                    onClick={() => toggleVisibility('exa')}
                    aria-pressed={!!visibleKeys['exa']}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
                    >
                    {visibleKeys['exa'] ? 'Hide' : 'Show'}
                    </Button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Deep neural entity search and competitor citation mapping.</p>
              </div>

              {/* Local Google SERP Scraper Sidecar */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">
                      Local Google SERP Scraper
                    </span>
                    <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-success-500/20 text-success-400 border border-success-500/30">
                      Zero-Key Fallback
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSerpEnabled}
                      onChange={e => setLocalSerpEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-gold"></div>
                  </label>
                </div>

                <p className="text-[10px] text-gray-400">
                  Fast HTTP Google SERP scraper inspired by <code className="text-gold-light">christophebe/serp</code> with automatic Patchright stealth fallback. Extracts AEO snippets, PAA, and organic positions when Tavily or Exa keys are absent.
                </p>

                <div className="space-y-1">
                  <label className="block text-[9px] font-mono uppercase text-gray-400">
                    Sidecar Endpoint URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={localSerpUrl}
                      onChange={e => setLocalSerpUrl(e.target.value)}
                      placeholder="http://localhost:3001"
                      className="flex-1 bg-black/60 border border-white/15 focus:border-gold rounded-xl px-3 py-1.5 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRunPingTest('local_serp')}
                      loading={testingId === 'local_serp'}
                      className="font-mono normal-case tracking-normal"
                      >
                      {testingId === 'local_serp' ? 'Testing...' : 'Test Engine'}
                      </Button>
                  </div>
                </div>

                {testResults['local_serp'] && (
                  <div
                    className={`text-[10px] font-mono px-3 py-1.5 rounded-lg border ${
                      testResults['local_serp'].success
                        ? 'bg-success-500/10 border-success-500/30 text-success-400'
                        : 'bg-danger-500/10 border-danger-500/30 text-danger-400'
                    }`}
                  >
                    {testResults['local_serp'].message} ({testResults['local_serp'].latencyMs}ms)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: WEB CRAWLING */}
          {activeTab === 'scraping' && (
            <div className="space-y-4 text-xs">
              {/* Strategy Mode */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gold-light">
                  Scraping & Crawling Strategy
                </label>
                <select
                  value={crawlerProvider}
                  onChange={e => setCrawlerProvider(e.target.value as any)}
                  className="w-full bg-black/70 border border-white/15 focus:border-gold rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="auto">Auto-Resolve (Patchright Stealth → Firecrawl → Jina Fallback)</option>
                  <option value="patchright">Patchright Stealth Runner (Local / Docker Sidecar)</option>
                  <option value="firecrawl">Firecrawl Managed Cloud API</option>
                  <option value="jina">Jina Reader (Direct Zero-Key Fallback)</option>
                </select>
                <p className="text-[10px] text-gray-400">
                  Auto-resolve prioritizes the zero-cost local stealth crawler, then falls back to Firecrawl and direct reading.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gold-light">
                  Instant Audit sitewide evidence
                </label>
                <select
                  value={sitewideMode}
                  onChange={e => setSitewideMode(e.target.value as 'off' | 'smart' | 'deep')}
                  className="w-full bg-black/70 border border-white/15 focus:border-gold rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="off">Homepage only (fastest)</option>
                  <option value="smart">Smart multi-page (map + selective scrape)</option>
                  <option value="deep">Deep Firecrawl crawl (BYOK or paid plan)</option>
                </select>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-400 whitespace-nowrap">Max pages</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={sitewideMaxPages}
                    onChange={e => setSitewideMaxPages(Number(e.target.value) || 6)}
                    className="w-20 bg-black/70 border border-white/15 focus:border-gold rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-gray-400">
                  Smart mode discovers URLs via Firecrawl /map or homepage links, then scrapes a budgeted mix of about, product, FAQ, and location pages.
                  Deep crawl uses hosted Firecrawl /crawl (Stars, TON, or Stripe plan) or your own Firecrawl key. Hosted crawls are capped for cost control.
                </p>
              </div>

              {/* Patchright Stealth Runner Section */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">Patchright Stealth Runner</span>
                    <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-success-500/20 text-success-400 border border-success-500/30">Zero-Cost</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => handleRunPingTest('patchright')}
                    loading={testingId === 'patchright'}
                    className="normal-case tracking-normal"
                    >
                    {testingId === 'patchright' ? 'Pinging…' : testResults['patchright'] ? (testResults['patchright'].success ? `✓ Active (${testResults['patchright'].latencyMs}ms)` : `✗ ${testResults['patchright'].message}`) : 'Test Runner'}
                    </Button>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Runner Endpoint URL</label>
                  <input
                    type="text"
                    value={patchrightUrl}
                    onChange={e => setPatchrightUrl(e.target.value)}
                    placeholder="http://localhost:3001"
                    className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    Connects to your local or Docker container running AST-patched stealth Chromium (evades Cloudflare Turnstile & DataDome).
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Crawler token (Optional)</label>
                  <div className="relative">
                    <input
                      type={visibleKeys['crawler_token'] ? 'text' : 'password'}
                      value={crawlerToken}
                      onChange={e => setCrawlerToken(e.target.value)}
                      placeholder="Same value as CRAWLER_TOKEN on the crawler"
                      autoComplete="off"
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                    />
                    <Button
                      variant="ghost"
                      size="none"
                      onClick={() => toggleVisibility('crawler_token')}
                      aria-pressed={!!visibleKeys['crawler_token']}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
                      >
                      {visibleKeys['crawler_token'] ? 'Hide' : 'Show'}
                      </Button>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Shared secret for a crawler started with <code className="text-gold-light">CRAWLER_TOKEN</code>. Sent only to the runner and SERP endpoints above as <code className="text-gold-light">x-crawler-token</code>.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Residential / Rotating Proxy (Optional)</label>
                  <input
                    type="text"
                    value={crawlerProxy}
                    onChange={e => setCrawlerProxy(e.target.value)}
                    placeholder="http://user:pass@proxy-server.com:8080"
                    className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Optional proxy passed directly to the Chromium browser context.</p>
                </div>
              </div>

              {/* Site tools: Writing check + Results tracking */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gold-light">Site tools (free, self-hosted)</span>
                  <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-success-500/20 text-success-400 border border-success-500/30">Optional</span>
                </div>

                {/* Writing check */}
                <div className="space-y-2 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-200">Writing check</span>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => handleRunPingTest('writing_check')}
                      loading={testingId === 'writing_check'}
                      className="normal-case tracking-normal"
                      >
                      {testingId === 'writing_check' ? 'Testing…' : testResults['writing_check'] ? (testResults['writing_check'].success ? `✓ Works (${testResults['writing_check'].latencyMs}ms)` : `✗ ${testResults['writing_check'].message}`) : 'Test'}
                      </Button>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Writing check URL</label>
                    <input
                      type="text"
                      value={writingCheckUrl}
                      onChange={e => setWritingCheckUrl(e.target.value)}
                      placeholder="http://localhost:8010"
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">
                      Optional. Leave blank to use the one on the server. Powered by LanguageTool; start it with <code className="text-gold-light">docker compose up -d</code>.
                    </p>
                  </div>
                </div>

                {/* Results tracking */}
                <div className="space-y-2 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-200">Results tracking</span>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => handleRunPingTest('results_tracking')}
                      loading={testingId === 'results_tracking'}
                      className="normal-case tracking-normal"
                      >
                      {testingId === 'results_tracking' ? 'Testing…' : testResults['results_tracking'] ? (testResults['results_tracking'].success ? `✓ Works (${testResults['results_tracking'].latencyMs}ms)` : `✗ ${testResults['results_tracking'].message}`) : 'Test'}
                      </Button>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Results tracking URL</label>
                    <input
                      type="text"
                      value={resultsTrackingUrl}
                      onChange={e => setResultsTrackingUrl(e.target.value)}
                      placeholder="http://localhost:3002 or https://api.umami.is"
                      className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">API key</label>
                    <div className="relative">
                      <input
                        type={visibleKeys['results_tracking'] ? 'text' : 'password'}
                        value={resultsTrackingKey}
                        onChange={e => setResultsTrackingKey(e.target.value)}
                        placeholder="API key or login token"
                        className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                      />
                      <Button
                        variant="ghost"
                        size="none"
                        onClick={() => toggleVisibility('results_tracking')}
                        aria-pressed={!!visibleKeys['results_tracking']}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
                        >
                        {visibleKeys['results_tracking'] ? 'Hide' : 'Show'}
                        </Button>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      Optional. Leave blank to use the one on the server. Powered by Umami; add your site there and paste its snippet into your website.
                    </p>
                  </div>
                </div>
              </div>

              {/* Firecrawl Managed API */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Firecrawl API Key (Deep Site Scraping & Markdown)
                </label>
                <div className="relative">
                  <input
                    type={visibleKeys['firecrawl'] ? 'text' : 'password'}
                    value={firecrawlKey}
                    onChange={e => setFirecrawlKey(e.target.value)}
                    placeholder="fc-..."
                    className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <Button
                    variant="ghost"
                    size="none"
                    onClick={() => toggleVisibility('firecrawl')}
                    aria-pressed={!!visibleKeys['firecrawl']}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
                    >
                    {visibleKeys['firecrawl'] ? 'Hide' : 'Show'}
                    </Button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  BYOK unlocks /map and /crawl without the hosted plan gate. Without a key, smart mode still expands from homepage links via Patchright or Jina.
                </p>
              </div>

              {/* Browserbase API */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Browserbase API Key (Cloud Headless Browser Sessions)
                </label>
                <div className="relative">
                  <input
                    type={visibleKeys['browserbase'] ? 'text' : 'password'}
                    value={browserbaseKey}
                    onChange={e => setBrowserbaseKey(e.target.value)}
                    placeholder="bb_live_..."
                    className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <Button
                    variant="ghost"
                    size="none"
                    onClick={() => toggleVisibility('browserbase')}
                    aria-pressed={!!visibleKeys['browserbase']}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
                    >
                    {visibleKeys['browserbase'] ? 'Hide' : 'Show'}
                    </Button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Executes complex JavaScript and headless interactions on web pages.</p>
              </div>
            </div>
          )}

          {/* TAB 5: GENERATIVE & RUNTIME */}
          {activeTab === 'extra' && (
            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Fal.ai API Key (Generative AI Models & Flux Schnell)
                </label>
                <input
                  type="password"
                  value={falKey}
                  onChange={e => setFalKey(e.target.value)}
                  placeholder="Key id:secret"
                  className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Tinker API Key (Agent Tool Runtime & Sandboxes)
                </label>
                <input
                  type="password"
                  value={tinkerKey}
                  onChange={e => setTinkerKey(e.target.value)}
                  placeholder="tml-..."
                  className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          {savedSuccess && (
            <div className="text-center text-xs font-bold text-success-400 animate-in fade-in py-1">
              &check; Saved
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/5 bg-black/40 flex items-center justify-between shrink-0">
          <Button
            variant="ghost"
            size="none"
            onClick={() => requestConfirm(
              {
                title: 'Remove all my keys?',
                description: 'This deletes every API key saved in this browser. Your business profile, memory, themes and audit history are kept. You can add keys again at any time.',
                confirmLabel: 'Remove keys',
                variant: 'danger',
              },
              () => {
                // Only remove credential overrides; never wipe Business DNA, VFS memory, themes or graph data.
                Object.keys(localStorage)
                  .filter(k => k.startsWith('luminara_') && (k.endsWith('_key') || k === 'luminara_api_key' || k === 'luminara_nvidia_org_id' || k === 'luminara_crawler_token'))
                  .forEach(k => localStorage.removeItem(k));
                refreshStatuses();
              },
            )}
            className="px-2 py-1 rounded-lg text-[10px] tracking-wider text-danger-400 hover:text-danger-300 hover:bg-danger-500/10 focus-visible:ring-danger-400"
            >
            Remove all my keys
            </Button>

          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <a href="#privacy" onClick={onClose} className="hover:text-gold transition-colors">Privacy</a>
            <span className="text-gray-700">·</span>
            <a href="#terms" onClick={onClose} className="hover:text-gold transition-colors">Terms</a>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="none"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-[10px]"
              >
              Close
              </Button>
            <Button
              variant="primary"
              size="none"
              onClick={handleSaveAll}
              className="px-5 py-2 rounded-xl text-[10px] font-black"
              >
              Save Changes
              </Button>
          </div>
        </div>
      </div>
      {confirmModal}
    </div>
  );
};
