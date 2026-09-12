import React from 'react';
import { ProviderStatus } from '../../../services/configService';
import { AuthPanel } from '../../auth/AuthPanel';
import { TelegramAccountPanel } from '../../telegram/TelegramAccountPanel';
import { DesktopUpdatesPanel } from '../../desktop/DesktopUpdatesPanel';
import { Button } from '../../ui/Button';

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
  return (
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

      <DesktopUpdatesPanel />

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
