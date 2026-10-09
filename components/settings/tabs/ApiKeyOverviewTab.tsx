import React from 'react';
import { ProviderStatus } from '../../../services/configService';
import { AuthPanel } from '../../auth/AuthPanel';
import { TelegramAccountPanel } from '../../telegram/TelegramAccountPanel';
import { DesktopUpdatesPanel } from '../../desktop/DesktopUpdatesPanel';
import { McpUsageStrip } from '../McpUsageStrip';
import { RouterTelemetryBoard } from '../RouterTelemetryBoard';
import { Button } from '../../ui/Button';
import { autoLockService, type AutoLockTimeout } from '../../../services/security/autoLockService';

export interface ApiKeyOverviewTabProps {
  statuses: ProviderStatus[];
  testResults: Record<string, { success: boolean; message: string; latencyMs: number }>;
  testingId: string | null;
  onRunPingTest: (providerId: string) => void;
}

export const ApiKeyOverviewTab: React.FC<ApiKeyOverviewTabProps> = ({
  statuses,
  testResults,
  testingId,
  onRunPingTest,
}) => {
  const [autoLockTimeout, setAutoLockTimeout] = React.useState<AutoLockTimeout>(() => autoLockService.getTimeout());
  const [hasPin, setHasPin] = React.useState<boolean>(() => autoLockService.hasPinSet());

  return (
    <div className="space-y-3">
      <AuthPanel compact />
      <TelegramAccountPanel compact />
      <p className="text-xs text-gray-400 leading-relaxed">
        Luminara needs one AI key to work (Groq is the easiest to start with). Add a live-search key to ground answers in real search results. Your keys stay on this device and work without signing in. Sign in above only if you want Luminara-hosted keys, synced workspace, or paid plans.
      </p>

      {/* Brand Vault & Security Controls */}
      <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-200">Brand Vault & Session Security</span>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider font-bold bg-gold/15 text-gold border border-gold/30">
              AES-256
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => window.dispatchEvent(new CustomEvent('luminara-open-vault'))}
            className="font-mono text-xs border-gold/40 text-gold hover:bg-gold/10"
          >
            Manage .luminara-vault
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Inactivity Auto-Lock:</span>
            <select
              value={autoLockTimeout}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) as AutoLockTimeout;
                setAutoLockTimeout(val);
                autoLockService.setTimeout(val);
              }}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs font-mono text-gray-200 outline-none focus:border-gold"
            >
              <option value="0">Disabled</option>
              <option value="300">5 minutes</option>
              <option value="900">15 minutes</option>
              <option value="1800">30 minutes</option>
              <option value="3600">60 minutes</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Lock PIN:</span>
            {hasPin ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-success-400">Configured</span>
                <button
                  type="button"
                  onClick={() => {
                    autoLockService.clearPin();
                    setHasPin(false);
                  }}
                  className="text-[11px] font-mono text-danger-400 hover:underline"
                >
                  Clear PIN
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const p = window.prompt('Enter new 4+ digit lock PIN:');
                  if (p && p.trim().length >= 4) {
                    await autoLockService.setPin(p.trim());
                    setHasPin(true);
                  }
                }}
                className="text-[11px] font-mono text-gold hover:underline"
              >
                Set Lock PIN
              </button>
            )}
          </div>
        </div>
      </div>

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

      <DesktopUpdatesPanel />
      <McpUsageStrip />
      <RouterTelemetryBoard />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2">
        {statuses.map(s => {
          const test = testResults[s.id];
          const isTesting = testingId === s.id;
          return (
            <div key={s.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-gray-200">{s.name}</span>
                  <span className="block text-[9px] font-mono text-gray-400 uppercase">{s.category}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider font-bold ${
                  s.isConfigured 
                    ? s.source === 'env' || s.source === 'server' ? 'bg-success-500/10 text-success-400 border border-success-500/30' : 'bg-warning-500/10 text-warning-400 border border-warning-500/30'
                    : 'bg-white/5 text-gray-400 border border-white/10'
                }`}>
                  {s.isConfigured ? (s.source === 'server' ? 'Provided by Luminara' : s.source === 'env' ? 'Connected' : 'Your key') : 'Not connected'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 text-[10px] font-mono text-gray-400">
                <span className="min-w-0 truncate" title={test && !test.success ? test.message : undefined}>
                  {s.isConfigured
                    ? (test && !test.success ? test.message : s.maskedKey)
                    : 'Add a key in the tabs above'}
                </span>
                {(['groq', 'tavily', 'firecrawl', 'patchright', 'exa', 'nvidia', 'openrouter', 'writing_check', 'results_tracking'].includes(s.id) && s.isConfigured || s.id === 'ollama') && (
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => onRunPingTest(s.id)}
                    loading={isTesting}
                    className="normal-case tracking-normal shrink-0"
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
  );
};
