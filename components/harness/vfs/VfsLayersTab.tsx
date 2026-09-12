import React from 'react';

interface DistilledCustomResult {
  l0: { content: string; tokenCount: number; keywords: string[] };
  l1: { content: string; tokenCount: number; sections: string[] };
  l2: { content: string; tokenCount: number };
}

interface VfsLayersTabProps {
  customText: string;
  setCustomText: (text: string) => void;
  distilledCustom: DistilledCustomResult;
}

export const VfsLayersTab: React.FC<VfsLayersTabProps> = ({
  customText,
  setCustomText,
  distilledCustom,
}) => {
  return (
    <div className="space-y-6">
      <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">
              Real-Time Multi-Resolution Distillation Engine
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Paste raw content to observe how the VFS automatically generates L0 Abstract (~100 tokens) and L1 Overview (~2,000 tokens) to optimize agent token economics.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-success-400 font-bold bg-success-500/10 px-3 py-1.5 rounded-xl border border-success-500/30">
              L1 Saves {Math.round(((distilledCustom.l2.tokenCount - distilledCustom.l1.tokenCount) / (distilledCustom.l2.tokenCount || 1)) * 100)}% Tokens
            </span>
          </div>
        </div>

        <textarea
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          rows={5}
          placeholder="Paste raw documentation, audit JSON, or article..."
          className="w-full px-4 py-3 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-gray-200 focus:outline-none focus:border-gold"
        />
      </div>

      {/* 3 Columns: L0, L1, L2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* L0 Column */}
        <div className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-gold-light font-bold">
              L0: Abstract
            </span>
            <span className="text-xs font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded">
              {distilledCustom.l0.tokenCount} tokens
            </span>
          </div>
          <div className="text-[11px] text-gray-400">
            Ultra-dense summary used for routing, broad directory indexation, and vector scoring.
          </div>
          <div className="flex-1 p-3.5 rounded-xl bg-black/60 border border-white/5 text-xs font-mono text-gray-200 overflow-y-auto max-h-[300px] leading-relaxed">
            {distilledCustom.l0.content}
          </div>
          <div className="pt-2 border-t border-white/5">
            <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">Extracted Keywords</div>
            <div className="flex flex-wrap gap-1">
              {distilledCustom.l0.keywords.map(kw => (
                <span key={kw} className="px-2 py-0.5 rounded bg-white/5 text-[9px] font-mono text-gray-300">
                  {kw}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* L1 Column */}
        <div className="glass-morphism rounded-2xl border border-gold/40 p-5 space-y-3 flex flex-col shadow-[0_0_20px_rgba(191,149,63,0.1)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-gold-light font-bold">
              L1: Overview
            </span>
            <span className="text-xs font-mono text-gold-light bg-gold/20 px-2 py-0.5 rounded font-bold border border-gold/30">
              {distilledCustom.l1.tokenCount} tokens
            </span>
          </div>
          <div className="text-[11px] text-gray-400">
            Structural outline and key section anchors used for high-agency planning and reasoning.
          </div>
          <div className="flex-1 p-3.5 rounded-xl bg-black/60 border border-white/5 text-xs font-mono text-gray-200 overflow-y-auto max-h-[300px] leading-relaxed whitespace-pre-wrap">
            {distilledCustom.l1.content}
          </div>
          <div className="pt-2 border-t border-white/5">
            <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">Section Anchors</div>
            <div className="text-[10px] font-mono text-gray-300">
              {distilledCustom.l1.sections.join(' • ') || 'None detected'}
            </div>
          </div>
        </div>

        {/* L2 Column */}
        <div className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-gray-300 font-bold">
              L2: Full Detail
            </span>
            <span className="text-xs font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded">
              {distilledCustom.l2.tokenCount} tokens
            </span>
          </div>
          <div className="text-[11px] text-gray-400">
            Full uncompressed document, loaded on-demand only when fine-grained details are required.
          </div>
          <div className="flex-1 p-3.5 rounded-xl bg-black/60 border border-white/5 text-xs font-mono text-gray-400 overflow-y-auto max-h-[300px] leading-relaxed whitespace-pre-wrap">
            {distilledCustom.l2.content}
          </div>
          <div className="pt-2 border-t border-white/5">
            <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">Storage Spec</div>
            <div className="text-[10px] font-mono text-gray-400">
              Format: markdown • Raw Bytes: {new Blob([customText]).size} B
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
