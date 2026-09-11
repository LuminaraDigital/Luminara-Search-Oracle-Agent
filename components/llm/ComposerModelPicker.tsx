import React, { useEffect, useMemo, useRef, useState } from 'react';
import { configService } from '../../services/configService';
import {
  CURATED_CHAT_MODELS,
  ChatModelPreference,
  displayChatModelPreference,
  PROVIDER_LABELS,
  shortModelLabel,
} from '../../services/llm/chatModelCatalog';
import { mergeLiveProviderModels } from '../../services/llm/liveModelCatalog';
import type { NativeEngineId } from '../../types';

interface ComposerModelPickerProps {
  disabled?: boolean;
}

/**
 * Hermes-style composer model pill: sticky local pick, grouped by provider,
 * never writes Settings failover defaults.
 */
export const ComposerModelPicker: React.FC<ComposerModelPickerProps> = ({ disabled }) => {
  const [pref, setPref] = useState<ChatModelPreference>(() => configService.getChatModelPreference());
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [brand, setBrand] = useState<NativeEngineId | null>(null);
  const [groups, setGroups] = useState(CURATED_CHAT_MODELS);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setPref(configService.getChatModelPreference());
    window.addEventListener('luminara-chat-model-change', sync);
    return () => window.removeEventListener('luminara-chat-model-change', sync);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();

    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [isOpen]);

  const refreshGroups = async () => {
    try {
      const [nvidia, ollama] = await Promise.all([
        configService.listNvidiaModels().catch(() => [] as string[]),
        configService.listOllamaModels().catch(() => [] as string[]),
      ]);
      setGroups(mergeLiveProviderModels({ nvidia, ollama }));
    } catch {
      setGroups(CURATED_CHAT_MODELS);
    }
  };

  const openPicker = () => {
    if (disabled) return;
    setIsOpen((v) => !v);
    setSearch('');
    setBrand(null);
    setCustomModel('');
    void refreshGroups();
  };

  const selectAuto = () => {
    const next = configService.setChatModelPreference({ mode: 'auto', provider: 'groq', model: pref.model });
    setPref(next);
    setIsOpen(false);
  };

  const selectModel = (provider: NativeEngineId, model: string) => {
    const next = configService.setChatModelPreference({ mode: 'manual', provider, model });
    setPref(next);
    if (provider === 'ollama') {
      configService.setOllamaModel(model);
    }
    setIsOpen(false);
  };

  const submitCustom = () => {
    const model = customModel.trim();
    if (!model) return;
    const provider = brand || (pref.mode === 'manual' ? pref.provider : 'groq');
    selectModel(provider, model);
  };

  const q = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter(
          (m) =>
            !q ||
            m.label.toLowerCase().includes(q) ||
            m.model.toLowerCase().includes(q) ||
            g.providerLabel.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [groups, q]);

  const activeBrand =
    brand && filteredGroups.some((g) => g.provider === brand) ? brand : null;

  const visibleRows = useMemo(() => {
    const rows = (activeBrand
      ? filteredGroups.filter((g) => g.provider === activeBrand)
      : filteredGroups
    ).flatMap((g) =>
      g.models.map((m) => ({
        ...m,
        providerLabel: g.providerLabel,
      })),
    );

    const isSelected = (m: { provider: string; model: string }) =>
      pref.mode === 'manual' && pref.provider === m.provider && pref.model === m.model;

    return rows
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const aSel = isSelected(a.m) ? 0 : 1;
        const bSel = isSelected(b.m) ? 0 : 1;
        return aSel - bSel || a.i - b.i;
      })
      .map((x) => x.m);
  }, [filteredGroups, activeBrand, pref]);

  const display = displayChatModelPreference(pref);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        title="Choose model (sticky for this device)"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`max-w-[9.5rem] sm:max-w-[12rem] flex items-center gap-1 px-2.5 py-2 rounded-xl text-[10px] font-mono font-bold tracking-wide border transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold ${
          disabled
            ? 'opacity-40 cursor-not-allowed border-white/5 text-gray-500'
            : isOpen
            ? 'border-gold/50 bg-gold/15 text-gold-light'
            : 'border-white/10 bg-white/5 text-gray-300 hover:border-gold/40 hover:text-gold-light'
        }`}
      >
        <span className="truncate">{display}</span>
        <span className="text-gray-500 shrink-0" aria-hidden>▾</span>
      </button>

      {isOpen && (
        <div
          className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-[min(92vw,22rem)] rounded-2xl border border-gold/30 bg-black/95 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-xl overflow-hidden"
          role="listbox"
          aria-label="Model picker"
        >
          <div className="p-2 border-b border-white/10">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-600 outline-none focus:border-gold/40"
            />
          </div>

          <div className="flex max-h-72">
            <div className="w-[38%] border-r border-white/10 overflow-y-auto">
              <button
                type="button"
                onClick={() => setBrand(null)}
                className={`w-full text-left px-2.5 py-2 text-[10px] font-mono ${
                  activeBrand === null ? 'bg-gold/15 text-gold-light' : 'text-gray-400 hover:bg-white/5'
                }`}
              >
                All models
              </button>
              {filteredGroups.map((g) => (
                <button
                  key={g.provider}
                  type="button"
                  onClick={() => setBrand((cur) => (cur === g.provider ? null : g.provider))}
                  className={`w-full text-left px-2.5 py-2 text-[10px] font-mono flex items-center justify-between gap-1 ${
                    activeBrand === g.provider ? 'bg-gold/15 text-gold-light' : 'text-gray-400 hover:bg-white/5'
                  }`}
                >
                  <span className="truncate">{g.providerLabel}</span>
                  <span className="text-gray-600 shrink-0">{g.models.length}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  window.location.hash = '#NATIVE';
                  window.dispatchEvent(new CustomEvent('luminara-open-settings'));
                }}
                className="w-full text-left px-2.5 py-2.5 text-[10px] font-mono text-gold/80 hover:text-gold-light border-t border-white/10"
              >
                Configure keys
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <button
                type="button"
                onClick={selectAuto}
                className={`w-full text-left px-3 py-2.5 border-b border-white/5 ${
                  pref.mode === 'auto' ? 'bg-gold/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="text-xs font-semibold text-white">Auto</div>
                <div className="text-[10px] text-gray-500 font-mono">Failover priority order</div>
              </button>

              {visibleRows.length === 0 ? (
                <div className="px-3 py-6 text-[11px] text-gray-500 text-center">No models match</div>
              ) : (
                visibleRows.map((m) => {
                  const active =
                    pref.mode === 'manual' && pref.provider === m.provider && pref.model === m.model;
                  return (
                    <button
                      key={`${m.provider}:${m.model}`}
                      type="button"
                      onClick={() => selectModel(m.provider, m.model)}
                      className={`w-full text-left px-3 py-2.5 border-b border-white/5 ${
                        active ? 'bg-gold/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white truncate">{m.label}</span>
                        {active && <span className="text-gold text-[10px]">✓</span>}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono truncate">
                        {m.providerLabel} · {shortModelLabel(m.model)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="p-2 border-t border-white/10 flex gap-2">
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCustom();
              }}
              placeholder={`Custom id (${PROVIDER_LABELS[brand || (pref.mode === 'manual' ? pref.provider : 'groq')]})`}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-[11px] text-gray-100 placeholder:text-gray-600 outline-none focus:border-gold/40 font-mono"
            />
            <button
              type="button"
              onClick={submitCustom}
              className="px-3 py-2 rounded-xl text-[10px] font-bold font-mono bg-gold/20 text-gold-light border border-gold/30 hover:bg-gold/30"
            >
              Use
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
