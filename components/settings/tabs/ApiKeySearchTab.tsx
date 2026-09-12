import React from 'react';
import { Button } from '../../ui/Button';

export interface ApiKeySearchTabProps {
  tavilyKey: string;
  setTavilyKey: (val: string) => void;
  exaKey: string;
  setExaKey: (val: string) => void;
  localSerpEnabled: boolean;
  setLocalSerpEnabled: (val: boolean) => void;
  localSerpUrl: string;
  setLocalSerpUrl: (val: string) => void;
  visibleKeys: Record<string, boolean>;
  toggleVisibility: (id: string) => void;
  testingId: string | null;
  testResults: Record<string, { success: boolean; message: string; latencyMs: number }>;
  onRunPingTest: (id: string) => void;
}

export const ApiKeySearchTab: React.FC<ApiKeySearchTabProps> = ({
  tavilyKey,
  setTavilyKey,
  exaKey,
  setExaKey,
  localSerpEnabled,
  setLocalSerpEnabled,
  localSerpUrl,
  setLocalSerpUrl,
  visibleKeys,
  toggleVisibility,
  testingId,
  testResults,
  onRunPingTest,
}) => {
  return (
    <div className="space-y-4 text-xs">
      <div>
        <label htmlFor="tavily-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
          Tavily Search API Key (Live SERP Citations)
        </label>
        <div className="relative">
          <input
            id="tavily-api-key"
            type={visibleKeys['tavily'] ? 'text' : 'password'}
            value={tavilyKey}
            onChange={e => setTavilyKey(e.target.value)}
            placeholder="tvly-..."
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
          />
          <Button
            variant="ghost"
            size="none"
            onClick={() => toggleVisibility('tavily')}
            aria-pressed={!!visibleKeys['tavily']}
            aria-label={visibleKeys['tavily'] ? 'Hide Tavily key' : 'Show Tavily key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
          >
            {visibleKeys['tavily'] ? 'Hide' : 'Show'}
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Grounds Oracle Agent and Instant Audit with real Google SERP rankings.</p>
      </div>

      <div>
        <label htmlFor="exa-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
          Exa.ai API Key (Neural Semantic Search)
        </label>
        <div className="relative">
          <input
            id="exa-api-key"
            type={visibleKeys['exa'] ? 'text' : 'password'}
            value={exaKey}
            onChange={e => setExaKey(e.target.value)}
            placeholder="ddcd..."
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
          />
          <Button
            variant="ghost"
            size="none"
            onClick={() => toggleVisibility('exa')}
            aria-pressed={!!visibleKeys['exa']}
            aria-label={visibleKeys['exa'] ? 'Hide Exa key' : 'Show Exa key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
          >
            {visibleKeys['exa'] ? 'Hide' : 'Show'}
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Deep neural entity search and competitor citation mapping.</p>
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
              id="toggle-local-serp"
              type="checkbox"
              checked={localSerpEnabled}
              onChange={e => setLocalSerpEnabled(e.target.checked)}
              aria-label="Enable Local Google SERP Scraper"
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-gray-700 peer-focus-visible:ring-2 peer-focus-visible:ring-gold rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-gold"></div>
          </label>
        </div>

        <p className="text-[10px] text-gray-400">
          Fast HTTP Google SERP scraper inspired by <code className="text-gold-light">christophebe/serp</code> with automatic Patchright stealth fallback. Extracts AEO snippets, PAA, and organic positions when Tavily or Exa keys are absent.
        </p>

        <div className="space-y-1">
          <label htmlFor="local-serp-url" className="block text-[9px] font-mono uppercase text-gray-400">
            Sidecar Endpoint URL
          </label>
          <div className="flex gap-2">
            <input
              id="local-serp-url"
              type="text"
              value={localSerpUrl}
              onChange={e => setLocalSerpUrl(e.target.value)}
              placeholder="http://localhost:3001"
              className="flex-1 bg-black/60 border border-white/15 focus:border-gold rounded-xl px-3 py-1.5 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRunPingTest('local_serp')}
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
  );
};
