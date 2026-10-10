import React, { useState } from 'react';

export interface Web3MethodCardProps {
  methodName?: string;
  contractName?: string;
  address?: string;
  feeEstimate?: string;
  onCall?: (inputs?: Record<string, any>) => void | Promise<void>;
  args?: any[];
}

export const Web3MethodCard: React.FC<Web3MethodCardProps> = ({
  methodName: propMethod,
  contractName: propContract,
  address: propAddress,
  feeEstimate: propFee,
  onCall: propOnCall,
  args,
}) => {
  const [status, setStatus] = useState<'idle' | 'executing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const methodName = propMethod ?? (args?.[0] !== undefined ? String(args[0]) : 'contractAction');
  const contractName = propContract ?? (args?.[1] !== undefined ? String(args[1]) : 'SmartContract');
  const address = propAddress ?? (args?.[2] !== undefined ? String(args[2]) : '0x0000...0000');
  const feeEstimate = propFee ?? (args?.[3] !== undefined ? String(args[3]) : 'Free (Gas ~$0.01)');
  const callback = propOnCall ?? (typeof args?.[4] === 'function' ? args[4] : undefined);

  const shortAddress = address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

  const handleExecute = async () => {
    if (!callback) return;
    try {
      setStatus('executing');
      setMessage(null);
      await callback();
      setStatus('success');
      setMessage('Transaction executed successfully.');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Transaction failed or rejected.');
    }
  };

  return (
    <div className="p-5 my-4 rounded-2xl border border-purple-500/30 bg-black/60 shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition-all hover:border-purple-500/50">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-purple-400 font-bold">
          Smart Contract Action Dispatcher
        </span>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-300 text-[10px] font-mono">
            {feeEstimate}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="text-base font-semibold text-white mb-1 leading-snug">
          Call Method: <span className="font-mono text-purple-300">{methodName}()</span>
        </h4>
        <p className="text-xs text-gray-400 font-mono">
          Target: {contractName} (<span className="text-gray-300">{shortAddress}</span>)
        </p>
      </div>

      {message && (
        <div
          className={`mb-3 p-2 rounded-lg text-xs font-mono border ${
            status === 'success'
              ? 'bg-green-950/40 border-green-800/40 text-green-300'
              : 'bg-red-950/40 border-red-800/40 text-red-300'
          }`}
        >
          {message}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-white/10">
        <span className="text-xs text-gray-400 font-mono">
          Dry-run simulated before prompt
        </span>
        <button
          type="button"
          onClick={handleExecute}
          disabled={status === 'executing' || status === 'success'}
          className={`px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg cursor-pointer ${
            status === 'success'
              ? 'bg-green-500/20 border border-green-500/40 text-green-300 cursor-default'
              : status === 'executing'
              ? 'bg-purple-500/10 border border-purple-500/30 text-purple-200 animate-pulse'
              : 'bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 hover:scale-[1.02] active:scale-[0.98]'
          }`}
        >
          {status === 'executing' ? 'Broadcasting...' : status === 'success' ? 'Completed' : 'Execute Method'}
        </button>
      </div>
    </div>
  );
};
