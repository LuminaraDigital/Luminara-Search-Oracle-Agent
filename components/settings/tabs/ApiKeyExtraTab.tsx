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
