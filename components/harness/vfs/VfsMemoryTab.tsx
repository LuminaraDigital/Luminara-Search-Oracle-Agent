import React from 'react';
import { VfsMemoryCategory } from '../../../types';
import { vfsMemoryService } from '../../../services/vfs/vfsMemoryService';

interface VfsMemoryTabProps {
  memoryFilter: VfsMemoryCategory | 'all';
  setMemoryFilter: (cat: VfsMemoryCategory | 'all') => void;
  onSyncDna: () => void;
  onSelectUri: (uri: string) => void;
  onNavigateExplorer: () => void;
}

export const VfsMemoryTab: React.FC<VfsMemoryTabProps> = ({
  memoryFilter,
  setMemoryFilter,
  onSyncDna,
  onSelectUri,
  onNavigateExplorer,
}) => {
  return (
    <div className="space-y-6">
      <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">
              6-Category Self-Evolving Long-Term Memory
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Partitioned cognitive storage for AI agents: Profiles, Preferences, Entities, Events, Cases, and Patterns.
            </p>
          </div>
          <button
            onClick={onSyncDna}
            className="px-3 py-2 rounded-xl bg-gold/20 border border-gold/50 hover:border-gold text-xs font-mono text-gold-light transition-all flex items-center gap-2"
          >
            <span>🧬</span>
            <span>Sync from Business DNA</span>
          </button>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {(['all', 'profiles', 'preferences', 'entities', 'events', 'cases', 'patterns'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setMemoryFilter(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono uppercase transition-all shrink-0 ${
                memoryFilter === cat
                  ? 'bg-gold text-black font-bold shadow-md'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Memory Items Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {vfsMemoryService.getMemoryItems(memoryFilter === 'all' ? undefined : memoryFilter).map(item => (
          <div
            key={item.id}
            className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3 hover:border-gold/40 transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gold/20 text-gold-light uppercase font-bold border border-gold/30">
                {item.category}
              </span>
              <span className="text-[10px] font-mono text-gray-400">
                {new Date(item.updatedAt).toLocaleDateString()}
              </span>
            </div>

            <div>
              <h4 className="text-sm font-bold text-white font-mono">{item.title}</h4>
              <div className="text-[10px] font-mono text-gray-500 truncate mt-0.5">{item.uri}</div>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs font-mono text-gray-300 line-clamp-3">
              {item.summaryL0}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <div className="flex items-center gap-1 flex-wrap">
                {item.tags.slice(0, 3).map(t => (
                  <span key={t} className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/5 text-gray-400">
                    #{t}
                  </span>
                ))}
              </div>
              <button
                onClick={() => {
                  onSelectUri(item.uri);
                  onNavigateExplorer();
                }}
                className="text-xs font-mono text-gold hover:underline"
              >
                Open in VFS →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
