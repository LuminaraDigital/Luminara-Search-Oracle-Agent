import React from 'react';
import { Button } from '../../ui/Button';

export interface ApiKeyScrapingTabProps {
  crawlerProvider: 'auto' | 'patchright' | 'firecrawl' | 'jina';
  setCrawlerProvider: (val: 'auto' | 'patchright' | 'firecrawl' | 'jina') => void;
  sitewideMode: 'off' | 'smart' | 'deep';
  setSitewideMode: (val: 'off' | 'smart' | 'deep') => void;
  sitewideMaxPages: number;
  setSitewideMaxPages: (val: number) => void;
  patchrightUrl: string;
  setPatchrightUrl: (val: string) => void;
  crawlerToken: string;
  setCrawlerToken: (val: string) => void;
  crawlerProxy: string;
  setCrawlerProxy: (val: string) => void;
  writingCheckUrl: string;
  setWritingCheckUrl: (val: string) => void;
  resultsTrackingUrl: string;
  setResultsTrackingUrl: (val: string) => void;
  resultsTrackingKey: string;
  setResultsTrackingKey: (val: string) => void;
  firecrawlKey: string;
  setFirecrawlKey: (val: string) => void;
  browserbaseKey: string;
  setBrowserbaseKey: (val: string) => void;
  visibleKeys: Record<string, boolean>;
  toggleVisibility: (id: string) => void;
  testingId: string | null;
  testResults: Record<string, { success: boolean; message: string; latencyMs: number }>;
  onRunPingTest: (id: string) => void;
}

export const ApiKeyScrapingTab: React.FC<ApiKeyScrapingTabProps> = ({
  crawlerProvider,
  setCrawlerProvider,
  sitewideMode,
  setSitewideMode,
  sitewideMaxPages,
  setSitewideMaxPages,
  patchrightUrl,
  setPatchrightUrl,
  crawlerToken,
  setCrawlerToken,
  crawlerProxy,
  setCrawlerProxy,
  writingCheckUrl,
  setWritingCheckUrl,
  resultsTrackingUrl,
  setResultsTrackingUrl,
  resultsTrackingKey,
  setResultsTrackingKey,
  firecrawlKey,
  setFirecrawlKey,
  browserbaseKey,
  setBrowserbaseKey,
  visibleKeys,
  toggleVisibility,
  testingId,
  testResults,
  onRunPingTest,
}) => {
  return (
    <div className="space-y-4 text-xs">
      {/* Strategy Mode */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
        <label htmlFor="scraping-strategy-select" className="block text-[10px] font-bold uppercase tracking-widest text-gold-light">
          Scraping & Crawling Strategy
        </label>
        <select
          id="scraping-strategy-select"
          value={crawlerProvider}
          onChange={e => setCrawlerProvider(e.target.value as any)}
          className="w-full bg-black/70 border border-white/15 focus:border-gold rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
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
        <label htmlFor="sitewide-mode-select" className="block text-[10px] font-bold uppercase tracking-widest text-gold-light">
          Instant Audit sitewide evidence
        </label>
        <select
          id="sitewide-mode-select"
          value={sitewideMode}
          onChange={e => setSitewideMode(e.target.value as 'off' | 'smart' | 'deep')}
          className="w-full bg-black/70 border border-white/15 focus:border-gold rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
        >
          <option value="off">Homepage only (fastest)</option>
          <option value="smart">Smart multi-page (map + selective scrape)</option>
          <option value="deep">Deep Firecrawl crawl (BYOK or paid plan)</option>
        </select>
        <div className="flex items-center gap-2">
          <label htmlFor="sitewide-max-pages" className="text-[10px] text-gray-400 whitespace-nowrap">Max pages</label>
          <input
            id="sitewide-max-pages"
            type="number"
            min={1}
            max={12}
            value={sitewideMaxPages}
            onChange={e => setSitewideMaxPages(Number(e.target.value) || 6)}
            className="w-20 bg-black/70 border border-white/15 focus:border-gold rounded-xl px-3 py-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
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
            onClick={() => onRunPingTest('patchright')}
            loading={testingId === 'patchright'}
            className="normal-case tracking-normal"
          >
            {testingId === 'patchright' ? 'Pinging…' : testResults['patchright'] ? (testResults['patchright'].success ? `✓ Active (${testResults['patchright'].latencyMs}ms)` : `✗ ${testResults['patchright'].message}`) : 'Test Runner'}
          </Button>
        </div>

        <div>
          <label htmlFor="patchright-endpoint-url" className="block text-[10px] text-gray-400 mb-1">Runner Endpoint URL</label>
          <input
            id="patchright-endpoint-url"
            type="text"
            value={patchrightUrl}
            onChange={e => setPatchrightUrl(e.target.value)}
            placeholder="http://localhost:3001"
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Connects to your local or Docker container running AST-patched stealth Chromium (evades Cloudflare Turnstile & DataDome).
          </p>
        </div>

        <div>
          <label htmlFor="crawler-token" className="block text-[10px] text-gray-400 mb-1">Crawler token (Optional)</label>
          <div className="relative">
            <input
              id="crawler-token"
              type={visibleKeys['crawler_token'] ? 'text' : 'password'}
              value={crawlerToken}
              onChange={e => setCrawlerToken(e.target.value)}
              placeholder="Same value as CRAWLER_TOKEN on the crawler"
              autoComplete="off"
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
            />
            <Button
              variant="ghost"
              size="none"
              onClick={() => toggleVisibility('crawler_token')}
              aria-pressed={!!visibleKeys['crawler_token']}
              aria-label={visibleKeys['crawler_token'] ? 'Hide crawler token' : 'Show crawler token'}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
            >
              {visibleKeys['crawler_token'] ? 'Hide' : 'Show'}
            </Button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            Shared secret for a crawler started with <code className="text-gold-light">CRAWLER_TOKEN</code>. Sent only to the runner and SERP endpoints above as <code className="text-gold-light">x-crawler-token</code>.
          </p>
        </div>

        <div>
          <label htmlFor="crawler-proxy" className="block text-[10px] text-gray-400 mb-1">Residential / Rotating Proxy (Optional)</label>
          <input
            id="crawler-proxy"
            type="text"
            value={crawlerProxy}
            onChange={e => setCrawlerProxy(e.target.value)}
            placeholder="http://user:pass@proxy-server.com:8080"
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          />
          <p className="text-[10px] text-gray-400 mt-1">Optional proxy passed directly to the Chromium browser context.</p>
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
              onClick={() => onRunPingTest('writing_check')}
              loading={testingId === 'writing_check'}
              className="normal-case tracking-normal"
            >
              {testingId === 'writing_check' ? 'Testing…' : testResults['writing_check'] ? (testResults['writing_check'].success ? `✓ Works (${testResults['writing_check'].latencyMs}ms)` : `✗ ${testResults['writing_check'].message}`) : 'Test'}
            </Button>
          </div>
          <div>
            <label htmlFor="writing-check-url" className="block text-[10px] text-gray-400 mb-1">Writing check URL</label>
            <input
              id="writing-check-url"
              type="text"
              value={writingCheckUrl}
              onChange={e => setWritingCheckUrl(e.target.value)}
              placeholder="http://localhost:8010"
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            />
            <p className="text-[10px] text-gray-400 mt-1">
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
              onClick={() => onRunPingTest('results_tracking')}
              loading={testingId === 'results_tracking'}
              className="normal-case tracking-normal"
            >
              {testingId === 'results_tracking' ? 'Testing…' : testResults['results_tracking'] ? (testResults['results_tracking'].success ? `✓ Works (${testResults['results_tracking'].latencyMs}ms)` : `✗ ${testResults['results_tracking'].message}`) : 'Test'}
            </Button>
          </div>
          <div>
            <label htmlFor="results-tracking-url" className="block text-[10px] text-gray-400 mb-1">Results tracking URL</label>
            <input
              id="results-tracking-url"
              type="text"
              value={resultsTrackingUrl}
              onChange={e => setResultsTrackingUrl(e.target.value)}
              placeholder="http://localhost:3002 or https://api.umami.is"
              className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            />
          </div>
          <div>
            <label htmlFor="results-tracking-key" className="block text-[10px] text-gray-400 mb-1">API key</label>
            <div className="relative">
              <input
                id="results-tracking-key"
                type={visibleKeys['results_tracking'] ? 'text' : 'password'}
                value={resultsTrackingKey}
                onChange={e => setResultsTrackingKey(e.target.value)}
                placeholder="API key or login token"
                className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
              />
              <Button
                variant="ghost"
                size="none"
                onClick={() => toggleVisibility('results_tracking')}
                aria-pressed={!!visibleKeys['results_tracking']}
                aria-label={visibleKeys['results_tracking'] ? 'Hide results tracking key' : 'Show results tracking key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
              >
                {visibleKeys['results_tracking'] ? 'Hide' : 'Show'}
              </Button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Optional. Leave blank to use the one on the server. Powered by Umami; add your site there and paste its snippet into your website.
            </p>
          </div>
        </div>
      </div>

      {/* Firecrawl Managed API */}
      <div>
        <label htmlFor="firecrawl-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
          Firecrawl API Key (Deep Site Scraping & Markdown)
        </label>
        <div className="relative">
          <input
            id="firecrawl-api-key"
            type={visibleKeys['firecrawl'] ? 'text' : 'password'}
            value={firecrawlKey}
            onChange={e => setFirecrawlKey(e.target.value)}
            placeholder="fc-..."
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
          />
          <Button
            variant="ghost"
            size="none"
            onClick={() => toggleVisibility('firecrawl')}
            aria-pressed={!!visibleKeys['firecrawl']}
            aria-label={visibleKeys['firecrawl'] ? 'Hide Firecrawl key' : 'Show Firecrawl key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
          >
            {visibleKeys['firecrawl'] ? 'Hide' : 'Show'}
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          BYOK unlocks /map and /crawl without the hosted plan gate. Without a key, smart mode still expands from homepage links via Patchright or Jina.
        </p>
      </div>

      {/* Browserbase API */}
      <div>
        <label htmlFor="browserbase-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
          Browserbase API Key (Cloud Headless Browser Sessions)
        </label>
        <div className="relative">
          <input
            id="browserbase-api-key"
            type={visibleKeys['browserbase'] ? 'text' : 'password'}
            value={browserbaseKey}
            onChange={e => setBrowserbaseKey(e.target.value)}
            placeholder="bb_live_..."
            className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none pr-16"
          />
          <Button
            variant="ghost"
            size="none"
            onClick={() => toggleVisibility('browserbase')}
            aria-pressed={!!visibleKeys['browserbase']}
            aria-label={visibleKeys['browserbase'] ? 'Hide Browserbase key' : 'Show Browserbase key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-gold-light"
          >
            {visibleKeys['browserbase'] ? 'Hide' : 'Show'}
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Executes complex JavaScript and headless interactions on web pages.</p>
      </div>
    </div>
  );
};
