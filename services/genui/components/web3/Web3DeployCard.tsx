import React, { useState } from 'react';

export interface Web3DeployCardProps {
  name?: string;
  network?: string;
  supply?: string | number;
  gasEstimate?: string;
  buttonLabel?: string;
  onDeploy?: () => void | Promise<void>;
  args?: any[];
}

export const Web3DeployCard: React.FC<Web3DeployCardProps> = ({
  name: propName,
  network: propNetwork,
  supply: propSupply,
  gasEstimate: propGas,
  buttonLabel: propLabel,
  onDeploy: propOnDeploy,
  args,
}) => {
  const [status, setStatus] = useState<'idle' | 'signing' | 'deployed' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const name = propName ?? (args?.[0] !== undefined ? String(args[0]) : 'Smart Contract');
  const network = propNetwork ?? (args?.[1] !== undefined ? String(args[1]) : 'Base');
  const supply = propSupply ?? (args?.[2] !== undefined ? String(args[2]) : '1,000,000');
  const gasEstimate = propGas ?? (args?.[3] !== undefined ? String(args[3]) : '~$0.04 USD');
  const callback = propOnDeploy ?? (typeof args?.[4] === 'function' ? args[4] : undefined);
  const buttonLabel = propLabel ?? 'Deploy Contract';

  const handleDeploy = async () => {
    if (!callback) return;
    try {
      setStatus('signing');
      setErrorMessage(null);
      await callback();
      setStatus('deployed');
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Deployment rejected or failed.');
    }
  };

  return (
    <div className="p-5 my-4 rounded-2xl border border-cyan-500/30 bg-black/60 shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition-all hover:border-cyan-500/50">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-400 font-bold">
          1-Click Smart Contract Deployer
        </span>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-[10px] font-mono">
            {network}
          </span>
          <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300 text-[10px] font-mono">
            Gas: {gasEstimate}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="text-base font-semibold text-white mb-1 leading-snug">
          {name}
        </h4>
        <p className="text-xs text-gray-400 font-mono">
          Supply: <span className="text-gray-200">{supply}</span> | Audited OpenZeppelin Template
        </p>
      </div>

      {errorMessage && (
        <div className="mb-3 p-2 rounded-lg bg-red-950/40 border border-red-800/40 text-red-300 text-xs font-mono">
          {errorMessage}
        </div>
      )}

      {status === 'deployed' && (
        <div className="mb-3 p-2 rounded-lg bg-green-950/40 border border-green-800/40 text-green-300 text-xs font-mono">
          Transaction confirmed on {network}. Contract active.
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-white/10">
        <span className="text-xs text-gray-400 font-mono">
          Pre-flight simulated. No code needed.
        </span>
        <button
          type="button"
          onClick={handleDeploy}
          disabled={status === 'signing' || status === 'deployed'}
          className={`px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg cursor-pointer ${
            status === 'deployed'
              ? 'bg-green-500/20 border border-green-500/40 text-green-300 cursor-default'
              : status === 'signing'
              ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 animate-pulse'
              : 'bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 hover:scale-[1.02] active:scale-[0.98]'
          }`}
        >
          {status === 'signing' ? 'Simulating & Signing...' : status === 'deployed' ? 'Deployed' : buttonLabel}
        </button>
      </div>
    </div>
  );
};
