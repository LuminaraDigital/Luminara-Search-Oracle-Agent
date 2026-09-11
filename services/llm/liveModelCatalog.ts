import type { NativeEngineId } from '../../types';
import {
  CURATED_CHAT_MODELS,
  ChatModelGroup,
  ChatModelOption,
  PROVIDER_LABELS,
  shortModelLabel,
} from './chatModelCatalog';

/** Non-chat NVIDIA catalog entries we hide from the composer picker. */
const NIM_NON_CHAT_RE =
  /embed|embedding|rerank|retrieve|truncate|whisper|tts|asr|transcri|gliner|jailbreak|guard|safety|translate|vision-language-retriev|nv-embed|nvclip|nv-rerank/i;

export function isNimChatModelId(id: string): boolean {
  const model = String(id || '').trim();
  if (!model) return false;
  if (NIM_NON_CHAT_RE.test(model)) return false;
  return true;
}

export function parseOpenAiModelList(payload: unknown): string[] {
  const data = (payload as { data?: Array<{ id?: string }> })?.data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((m) => String(m?.id || '').trim())
    .filter(Boolean);
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

export function parseOllamaTagsList(payload: unknown): string[] {
  const models = (payload as { models?: Array<{ name?: string; model?: string }> })?.models;
  if (!Array.isArray(models)) return [];
  const ids = models
    .map((m) => String(m?.name || m?.model || '').trim())
    .filter(Boolean);
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

function toOptions(provider: NativeEngineId, models: string[]): ChatModelOption[] {
  return models.map((model) => ({
    provider,
    model,
    label: shortModelLabel(model),
  }));
}

/**
 * Merge live vendor catalogs into the composer groups.
 * When a live list is non-empty, it replaces the curated stub for that provider
 * so users with API keys can pick every available model.
 */
export function mergeLiveProviderModels(opts: {
  nvidia?: string[];
  ollama?: string[];
  groq?: string[];
  openrouter?: string[];
}): ChatModelGroup[] {
  const groups = CURATED_CHAT_MODELS.map((g) => ({
    ...g,
    models: [...g.models],
  }));

  const apply = (provider: NativeEngineId, live: string[] | undefined, filter?: (id: string) => boolean) => {
    if (!live || live.length === 0) return;
    const filtered = filter ? live.filter(filter) : live;
    if (filtered.length === 0) return;
    const target = groups.find((g) => g.provider === provider);
    if (!target) {
      groups.push({
        provider,
        providerLabel: PROVIDER_LABELS[provider],
        models: toOptions(provider, filtered),
      });
      return;
    }
    target.models = toOptions(provider, filtered);
  };

  apply('nim', opts.nvidia, isNimChatModelId);
  apply('ollama', opts.ollama);
  apply('groq', opts.groq);
  apply('openrouter', opts.openrouter);
  return groups;
}
