import React from 'react';
import { DesktopUpdatesPanel } from '../../desktop/DesktopUpdatesPanel';

export interface ApiKeyExtraTabProps {
  tinkerKey: string;
  setTinkerKey: (val: string) => void;
}

export const ApiKeyExtraTab: React.FC<ApiKeyExtraTabProps> = ({
  tinkerKey,
  setTinkerKey,
}) => {
  return (
    <div className="space-y-4 text-xs">
      <DesktopUpdatesPanel />

      <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer">
        <div>
          <span className="text-xs font-semibold text-gray-200 block">Developer Tools & Labs Previews</span>
          <span className="text-[10px] text-gray-400 block mt-0.5">
            Unlocks Archy Developer Harness, OracleMind SLM Studio, TimesFM Forecaster, Native LLM HUD, and Theme Cycler.
          </span>
        </div>
        <input
          type="checkbox"
          defaultChecked={typeof window !== 'undefined' && localStorage.getItem('luminara_advanced_ui') === '1'}
          onChange={e => {
            localStorage.setItem('luminara_advanced_ui', e.target.checked ? '1' : '0');
            window.dispatchEvent(new Event('luminara-advanced-ui'));
          }}
          className="accent-gold w-4 h-4 shrink-0"
        />
      </label>

      <div>
        <label htmlFor="tinker-api-key" className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
          Tinker API Key (Agent Tool Runtime & Sandboxes)
        </label>
        <input
          id="tinker-api-key"
          type="password"
          value={tinkerKey}
          onChange={e => setTinkerKey(e.target.value)}
          placeholder="tml-..."
          className="w-full bg-black/60 border border-white/15 focus:border-gold rounded-xl px-4 py-2 text-xs text-white font-mono placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
        />
      </div>
    </div>
  );
};
