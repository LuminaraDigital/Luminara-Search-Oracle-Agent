import React, { useState } from 'react';
import { AuditAttestation } from '../../services/agentCore/types';
import { tonAttestationService } from '../../services/agentCore/tonAttestationService';

interface ProofOfAuditBadgeModalProps {
  attestation: AuditAttestation;
  onClose: () => void;
}

export const ProofOfAuditBadgeModal: React.FC<ProofOfAuditBadgeModalProps> = ({
  attestation,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [memoCopied, setMemoCopied] = useState(false);
  const embedCode = tonAttestationService.generateBadgeHtml(attestation);

  const handleCopyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyMemo = () => {
    navigator.clipboard.writeText(attestation.tonMemo);
    setMemoCopied(true);
    setTimeout(() => setMemoCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative text-left">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white text-lg p-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          ✕
        </button>

        {/* Title */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-xl">
            🛡️
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Cryptographic Proof-of-Audit</h3>
            <p className="text-xs text-slate-400">Verifiable On-Chain Search Authority Attestation</p>
          </div>
        </div>

        {/* Core Metrics Card */}
        <div className="grid grid-cols-2 gap-3 mb-5 p-3.5 bg-slate-800/50 rounded-xl border border-slate-750">
          <div>
            <span className="text-[11px] text-slate-400 block mb-0.5">Audited Domain</span>
            <span className="text-sm font-semibold text-white font-mono">{attestation.domain}</span>
          </div>
          <div>
            <span className="text-[11px] text-slate-400 block mb-0.5">Health Score</span>
            <span className="text-sm font-bold text-emerald-400">{attestation.healthScore}/100</span>
          </div>
        </div>

        {/* Cryptographic SHA-256 Digest */}
        <div className="mb-5">
          <label className="text-xs font-medium text-slate-300 block mb-1">
            SHA-256 Audit Integrity Digest
          </label>
          <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-cyan-300 break-all select-all">
            {attestation.digestHex}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Deterministic cryptographic fingerprint calculated from raw DOM evidence, SERP citations, and verified schema findings.
          </p>
        </div>

        {/* TON Blockchain Anchoring */}
        <div className="mb-5 p-3.5 bg-blue-950/30 border border-blue-800/40 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
              <span>💎</span> TON Blockchain Memo
            </span>
            <button
              onClick={handleCopyMemo}
              className="text-[11px] px-2 py-0.5 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded border border-blue-500/30 transition-colors"
            >
              {memoCopied ? '✓ Copied' : 'Copy Memo'}
            </button>
          </div>
          <div className="font-mono text-xs text-slate-200 bg-slate-950 p-2 rounded border border-blue-900/50 break-all select-all">
            {attestation.tonMemo}
          </div>
          <p className="text-[11px] text-blue-200/70 mt-2 leading-relaxed">
            Attach this memo to any TON transfer to anchor your brand&apos;s audit score permanently and immutably on the TON blockchain.
          </p>
        </div>

        {/* Website Embed Badge */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-slate-300">
              Embeddable Trust Badge (HTML)
            </label>
            <button
              onClick={handleCopyEmbed}
              className="text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded-lg border border-emerald-500/30 transition-colors"
            >
              {copied ? '✓ Copied to Clipboard' : 'Copy HTML'}
            </button>
          </div>
          <textarea
            readOnly
            rows={3}
            value={embedCode}
            className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg font-mono text-xs text-slate-300 select-all resize-none focus:outline-none"
          />
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
