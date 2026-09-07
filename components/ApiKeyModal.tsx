import React, { useState, useEffect } from 'react';
import { ICONS } from '../constants';
import { configService, ProviderStatus } from '../services/configService';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeySaved: () => void;
}

type TabType = 'overview' | 'llm' | 'search' | 'scraping' | 'extra';

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onKeySaved }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  
  // Form values
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [groqFallbackKey, setGroqFallbackKey] = useState('');
  const [nvidiaKey, setNvidiaKey] = useState('');
  const [nvidiaOrgId, setNvidiaOrgId] = useState('');
  const [ollamaKey, setOllamaKey] = useState('');
  const [tavilyKey, setTavilyKey] = useState('');
  const [exaKey, setExaKey] = useState('');
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [browserbaseKey, setBrowserbaseKey] = useState('');
  const [falKey, setFalKey] = useState('');
  const [tinkerKey, setTinkerKey] = useState('');

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
    setOllamaKey(localStorage.getItem('luminara_ollama_key') || '');
    setTavilyKey(localStorage.getItem('luminara_tavily_key') || '');
    setExaKey(localStorage.getItem('luminara_exa_key') || '');
    setFirecrawlKey(localStorage.getItem('luminara_firecrawl_key') || '');
    setBrowserbaseKey(localStorage.getItem('luminara_browserbase_key') || '');
    setFalKey(localStorage.getItem('luminara_fal_key') || '');
    setTinkerKey(localStorage.getItem('luminara_tinker_key') || '');
  };

  useEffect(() => {
    if (isOpen) {
      refreshStatuses();
      setSavedSuccess(false);
    }
  }, [isOpen]);

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
    configService.setKey('luminara_ollama_key', ollamaKey);
    configService.setKey('luminara_tavily_key', tavilyKey);
    configService.setKey('luminara_exa_key', exaKey);
    configService.setKey('luminara_firecrawl_key', firecrawlKey);
    configService.setKey('luminara_browserbase_key', browserbaseKey);
    configService.setKey('luminara_fal_key', falKey);
    configService.setKey('luminara_tinker_key', tinkerKey);

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
      res = await configService.testGroq();
    } else if (providerId === 'tavily') {
      res = await configService.testTavily();
    } else if (providerId === 'firecrawl') {
      res = await configService.testFirecrawl();
    } else if (providerId === 'exa') {
      res = await configService.testExa();
    } else if (providerId === 'nvidia') {
      res = await configService.testNvidia();
    } else if (providerId === 'ollama') {
      const o = await configService.testOllama();
      res = { success: o.success, message: o.message, latencyMs: o.latencyMs };
    }
    setTestResults(prev => ({ ...prev, [providerId]: res }));
    setTestingId(null);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
      <div className="glass-morphism border border-[#BF953F]/40 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden relative bg-black/95 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#BF953F]/20 to-transparent px-6 py-4 border-b border-[#BF953F]/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#BF953F]/10 border border-[#BF953F]/30 text-[#FCF6BA]">
              <ICONS.Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#FCF6BA]">Executive Integrations & Secrets Hub</h3>
              <p className="text-[10px] text-gray-400 font-mono">Keys are stored only in this browser. For production, route calls through a server so keys never ship to clients.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1">
            <ICONS.X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-white/5 bg-black/40 shrink-0 overflow-x-auto text-[10px] font-mono uppercase tracking-wider">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all ${activeTab === 'overview' ? 'border-[#BF953F] text-[#FCF6BA]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Overview & Status ({statuses.filter(s => s.isConfigured).length}/{statuses.length})
          </button>
          <button
            onClick={() => setActiveTab('llm')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all ${activeTab === 'llm' ? 'border-[#BF953F] text-[#FCF6BA]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            LLM Engines
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all ${activeTab === 'search' ? 'border-[#BF953F] text-[#FCF6BA]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Search & SERP
          </button>
          <button
            onClick={() => setActiveTab('scraping')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all ${activeTab === 'scraping' ? 'border-[#BF953F] text-[#FCF6BA]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Web Crawling
          </button>
          <button
            onClick={() => setActiveTab('extra')}
            className={`pb-2.5 px-2 border-b-2 font-bold transition-all ${activeTab === 'extra' ? 'border-[#BF953F] text-[#FCF6BA]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Generative & Runtime
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-3">
              <TelegramAccountPanel compact />
              <p className="text-xs text-gray-400 leading-relaxed">
                All credentials loaded from <code className="text-[#FCF6BA]">.env</code> or customized via local overrides. The platform automatically falls back across active providers to guarantee zero downtime.
              </p>

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
                            ? s.source === 'env' || s.source === 'server' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : 'bg-white/5 text-gray-500 border border-white/10'
                        }`}>
                          {s.isConfigured ? (s.source === 'server' ? 'Server key' : s.source === 'env' ? 'Active in Env' : 'Local Override') : 'Not Set'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-[10px] font-mono text-gray-400">
                        <span>{s.isConfigured ? s.maskedKey : 'No key detected'}</span>
                        {(['groq', 'tavily', 'firecrawl', 'exa', 'nvidia'].includes(s.id) && s.isConfigured || s.id === 'ollama') && (
                          <button
                            onClick={() => handleRunPingTest(s.id)}
                            disabled={isTesting}
                            className="text-[9px] px-2 py-0.5 rounded bg-[#BF953F]/10 hover:bg-[#BF953F]/20 text-[#FCF6BA] border border-[#BF953F]/30 transition-all font-bold"
                          >
                            {isTesting ? 'Pinging...' : test ? (test.success ? `✓ ${test.latencyMs}ms` : '✗ Failed') : 'Test Ping'}
                          </button>
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
              <div className="rounded-xl border border-[#BF953F]/30 bg-[#BF953F]/5 p-3 text-[11px] text-gray-300 leading-relaxed">
                <b className="text-[#FCF6BA]">Bring your own keys.</b> Luminara runs on your Groq, NVIDIA NIM or Ollama account. Keys are saved only in this browser and sent straight to the vendor (NVIDIA is relayed through Luminara's server because its API blocks browsers; the key is forwarded, never stored). Hosted keys on luminarasuite.com are limited to signed-in Telegram users on a plan.
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Groq API Key (gpt-oss-120b, Qwen3) · <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-[#FCF6BA] underline">get a key</a>
                </label>
                <div className="relative">
                  <input
                    type={visibleKeys['groq'] ? 'text' : 'password'}
                    value={groqKey}
                    onChange={e => setGroqKey(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisibility('groq')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#FCF6BA] uppercase"
                  >
                    {visibleKeys['groq'] ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Groq Secondary / Fallback Key (Automatic Failover)
                </label>
                <div className="relative">
                  <input
                    type={visibleKeys['groq_fallback'] ? 'text' : 'password'}
                    value={groqFallbackKey}
                    onChange={e => setGroqFallbackKey(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisibility('groq_fallback')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#FCF6BA] uppercase"
                  >
                    {visibleKeys['groq_fallback'] ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    NVIDIA NIM API Key · <a href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-[#FCF6BA] underline">get a key</a>
                  </label>
                  <input
                    type="password"
                    value={nvidiaKey}
                    onChange={e => setNvidiaKey(e.target.value)}
                    placeholder="nvapi-..."
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    NVIDIA Org ID
                  </label>
                  <input
                    type="text"
                    value={nvidiaOrgId}
                    onChange={e => setNvidiaOrgId(e.target.value)}
                    placeholder="22aa30a8-..."
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Ollama Cloud API Key · <a href="https://ollama.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-[#FCF6BA] underline">get a key</a> (local Ollama at :11434 needs no key)
                </label>
                <input
                  type="password"
                  value={ollamaKey}
                  onChange={e => setOllamaKey(e.target.value)}
                  placeholder="f2aed..."
                  className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Google Gemini API Key (Optional)
                </label>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                />
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
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisibility('tavily')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#FCF6BA] uppercase"
                  >
                    {visibleKeys['tavily'] ? 'Hide' : 'Show'}
                  </button>
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
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisibility('exa')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#FCF6BA] uppercase"
                  >
                    {visibleKeys['exa'] ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Deep neural entity search and competitor citation mapping.</p>
              </div>
            </div>
          )}

          {/* TAB 4: WEB CRAWLING */}
          {activeTab === 'scraping' && (
            <div className="space-y-4 text-xs">
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
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisibility('firecrawl')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#FCF6BA] uppercase"
                  >
                    {visibleKeys['firecrawl'] ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Extracts clean site Markdown and Core Web Vitals directly from target URLs.</p>
              </div>

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
                    className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisibility('browserbase')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#FCF6BA] uppercase"
                  >
                    {visibleKeys['browserbase'] ? 'Hide' : 'Show'}
                  </button>
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
                  className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
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
                  className="w-full bg-black/60 border border-white/15 focus:border-[#BF953F] rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          {savedSuccess && (
            <div className="text-center text-xs font-bold text-emerald-400 animate-in fade-in py-1">
              &check; Settings & Overrides Saved Successfully
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/5 bg-black/40 flex items-center justify-between shrink-0">
          <button
            onClick={() => {
              // Only remove credential overrides; never wipe Business DNA, VFS memory, themes or graph data.
              Object.keys(localStorage)
                .filter(k => k.startsWith('luminara_') && (k.endsWith('_key') || k === 'luminara_api_key' || k === 'luminara_nvidia_org_id'))
                .forEach(k => localStorage.removeItem(k));
              refreshStatuses();
            }}
            className="text-[10px] uppercase tracking-wider text-red-400 hover:text-red-300 font-bold"
          >
            Clear Browser Overrides
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-[10px] uppercase font-bold text-gray-400 hover:text-white transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSaveAll}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black text-[10px] uppercase font-black tracking-wider shadow-lg hover:scale-105 active:scale-95 transition-all"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
