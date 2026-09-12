import React, { useState, useEffect, useRef } from 'react';
import { ICONS } from '../constants';
import { configService, ProviderStatus } from '../services/configService';
import { getServerHealthSync, loadServerHealth } from '../services/apiClient';
import { noteWorkspaceDirty } from '../services/sync/workspaceSyncService';
import { Button } from './ui/Button';
import { useConfirm } from './ui/ConfirmModal';
import { toUserFacingText } from '../utils/userFacingText';
import {
  ApiKeyOverviewTab,
  ApiKeyLlmTab,
  ApiKeySearchTab,
  ApiKeyScrapingTab,
  ApiKeyExtraTab,
} from './settings/tabs';

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
  const [nvidiaDetectedModels, setNvidiaDetectedModels] = useState<string[]>([]);
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

  // Escape closes the dialog; Tab traps focus within modal.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
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
    await loadServerHealth().catch(() => undefined);
    let res: { success: boolean; message: string; latencyMs: number } = { success: false, message: 'Not implemented', latencyMs: 0 };
    if (providerId === 'groq') {
      res = await configService.testGroq(groqKey || groqFallbackKey);
    } else if (providerId === 'groq_fallback') {
      res = await configService.testGroq(groqFallbackKey);
    } else if (providerId === 'tavily') {
      res = await configService.testTavily(tavilyKey);
    } else if (providerId === 'local_serp') {
      res = await configService.testLocalSerp();
    } else if (providerId === 'firecrawl') {
      res = await configService.testFirecrawl(firecrawlKey);
    } else if (providerId === 'patchright') {
      res = await configService.testPatchright();
    } else if (providerId === 'exa') {
      res = await configService.testExa(exaKey);
    } else if (providerId === 'nvidia') {
      const n = await configService.testNvidia(nvidiaKey, nvidiaOrgId);
      res = { success: n.success, message: n.message, latencyMs: n.latencyMs };
      if (n.models && n.models.length > 0) {
        setNvidiaDetectedModels(n.models);
      }
    } else if (providerId === 'openrouter') {
      res = await configService.testOpenRouter(openRouterKey);
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
    setTestResults(prev => ({
      ...prev,
      [providerId]: {
        ...res,
        message: toUserFacingText(res.message, res.success ? 'OK' : 'Not working'),
      },
    }));
    setTestingId(null);
  };

  return (
    <div className="fixed inset-0 z-[110] overflow-y-auto flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        className="glass-morphism border border-gold/40 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden relative bg-black/95 flex flex-col my-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] outline-none"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-gold/20 to-transparent px-6 py-4 border-b border-gold/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
              <ICONS.Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 id="settings-modal-title" className="text-sm font-bold uppercase tracking-widest text-gold-light">Settings</h3>
              <p className="text-[10px] text-gray-400 font-mono">
                {(() => {
                  const health = getServerHealthSync();
                  const hostedCount = Object.values(health.providers || {}).filter(Boolean).length;
                  if (health.ok && hostedCount > 0) {
                    return `Hosted keys active (${hostedCount}). Your own keys stay in this browser and are relayed through Luminara so vendors never see the page origin.`;
                  }
                  if (health.ok) {
                    return 'Your keys stay in this browser and are relayed through Luminara (no vendor CORS). Hosted server keys are not configured yet.';
                  }
                  return 'Your keys stay in this browser. Calls relay through Luminara when the Worker is reachable so keys work in production.';
                })()}
              </p>
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
          {activeTab === 'overview' && (
            <ApiKeyOverviewTab
              statuses={statuses}
              testResults={testResults}
              testingId={testingId}
              onRunPingTest={handleRunPingTest}
            />
          )}

          {activeTab === 'llm' && (
            <ApiKeyLlmTab
              freeLlmBaseUrl={freeLlmBaseUrl}
              setFreeLlmBaseUrl={setFreeLlmBaseUrl}
              freeLlmKey={freeLlmKey}
              setFreeLlmKey={setFreeLlmKey}
              freeLlmPrefer={freeLlmPrefer}
              setFreeLlmPrefer={setFreeLlmPrefer}
              nvidiaKey={nvidiaKey}
              setNvidiaKey={setNvidiaKey}
              nvidiaOrgId={nvidiaOrgId}
              setNvidiaOrgId={setNvidiaOrgId}
              nvidiaDetectedModels={nvidiaDetectedModels}
              groqKey={groqKey}
              setGroqKey={setGroqKey}
              groqFallbackKey={groqFallbackKey}
              setGroqFallbackKey={setGroqFallbackKey}
              openRouterKey={openRouterKey}
              setOpenRouterKey={setOpenRouterKey}
              ollamaEndpoint={ollamaEndpoint}
              setOllamaEndpoint={setOllamaEndpoint}
              ollamaModel={ollamaModel}
              setOllamaModel={setOllamaModel}
              ollamaDetectedModels={ollamaDetectedModels}
              ollamaKey={ollamaKey}
              setOllamaKey={setOllamaKey}
              geminiKey={geminiKey}
              setGeminiKey={setGeminiKey}
              visibleKeys={visibleKeys}
              toggleVisibility={toggleVisibility}
              testingId={testingId}
              testResults={testResults}
              onRunPingTest={handleRunPingTest}
            />
          )}

          {activeTab === 'search' && (
            <ApiKeySearchTab
              tavilyKey={tavilyKey}
              setTavilyKey={setTavilyKey}
              exaKey={exaKey}
              setExaKey={setExaKey}
              localSerpEnabled={localSerpEnabled}
              setLocalSerpEnabled={setLocalSerpEnabled}
              localSerpUrl={localSerpUrl}
              setLocalSerpUrl={setLocalSerpUrl}
              visibleKeys={visibleKeys}
              toggleVisibility={toggleVisibility}
              testingId={testingId}
              testResults={testResults}
              onRunPingTest={handleRunPingTest}
            />
          )}

          {activeTab === 'scraping' && (
            <ApiKeyScrapingTab
              crawlerProvider={crawlerProvider}
              setCrawlerProvider={setCrawlerProvider}
              sitewideMode={sitewideMode}
              setSitewideMode={setSitewideMode}
              sitewideMaxPages={sitewideMaxPages}
              setSitewideMaxPages={setSitewideMaxPages}
              patchrightUrl={patchrightUrl}
              setPatchrightUrl={setPatchrightUrl}
              crawlerToken={crawlerToken}
              setCrawlerToken={setCrawlerToken}
              crawlerProxy={crawlerProxy}
              setCrawlerProxy={setCrawlerProxy}
              writingCheckUrl={writingCheckUrl}
              setWritingCheckUrl={setWritingCheckUrl}
              resultsTrackingUrl={resultsTrackingUrl}
              setResultsTrackingUrl={setResultsTrackingUrl}
              resultsTrackingKey={resultsTrackingKey}
              setResultsTrackingKey={setResultsTrackingKey}
              firecrawlKey={firecrawlKey}
              setFirecrawlKey={setFirecrawlKey}
              browserbaseKey={browserbaseKey}
              setBrowserbaseKey={setBrowserbaseKey}
              visibleKeys={visibleKeys}
              toggleVisibility={toggleVisibility}
              testingId={testingId}
              testResults={testResults}
              onRunPingTest={handleRunPingTest}
            />
          )}

          {activeTab === 'extra' && (
            <ApiKeyExtraTab
              falKey={falKey}
              setFalKey={setFalKey}
              tinkerKey={tinkerKey}
              setTinkerKey={setTinkerKey}
            />
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

          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <a href="#privacy" onClick={onClose} className="hover:text-gold transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded">Privacy</a>
            <span className="text-gray-600">·</span>
            <a href="#terms" onClick={onClose} className="hover:text-gold transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none rounded">Terms</a>
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
