import type { NativeEngineId } from '../../types';
import { GROQ_DEFAULT_MODEL, NIM_DEFAULT_MODEL } from './nativeModelDefaults';

export type ChatModelProviderId = NativeEngineId | 'auto';

export interface ChatModelOption {
  provider: NativeEngineId;
  model: string;
  label: string;
}

export interface ChatModelGroup {
  provider: NativeEngineId;
  providerLabel: string;
  models: ChatModelOption[];
}

export interface ChatModelPreference {
  /** `auto` follows native failover priority. Manual pins provider + model for the next turn. */
  mode: 'auto' | 'manual';
  provider: NativeEngineId;
  model: string;
}

export const CHAT_MODEL_PREF_KEY = 'luminara_chat_model_pref';

export const PROVIDER_LABELS: Record<NativeEngineId, string> = {
  groq: 'Groq',
  nim: 'NVIDIA NIM',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  freellm: 'FreeLLMAPI',
};

/** Curated composer catalog (Hermes-style: provider parent, model children). */
export const CURATED_CHAT_MODELS: ChatModelGroup[] = [
  {
    provider: 'groq',
    providerLabel: PROVIDER_LABELS.groq,
    models: [
      { provider: 'groq', model: GROQ_DEFAULT_MODEL, label: 'GPT-OSS 120B' },
      { provider: 'groq', model: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
      { provider: 'groq', model: 'qwen/qwen3.6-27b', label: 'Qwen3.6 27B' },
      { provider: 'groq', model: 'groq/compound', label: 'Groq Compound' },
    ],
  },
  {
    provider: 'nim',
    providerLabel: PROVIDER_LABELS.nim,
    models: [
      { provider: 'nim', model: NIM_DEFAULT_MODEL, label: 'Llama 3.2 11B Vision' },
      { provider: 'nim', model: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B' },
      { provider: 'nim', model: 'deepseek-ai/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash' },
      { provider: 'nim', model: 'google/gemma-3-12b-it', label: 'Gemma 3 12B' },
    ],
  },
  {
    provider: 'openrouter',
    providerLabel: PROVIDER_LABELS.openrouter,
    models: [
      { provider: 'openrouter', model: 'openai/gpt-4o', label: 'GPT-4o' },
      { provider: 'openrouter', model: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { provider: 'openrouter', model: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { provider: 'openrouter', model: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { provider: 'openrouter', model: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    ],
  },
  {
    provider: 'ollama',
    providerLabel: PROVIDER_LABELS.ollama,
    models: [
      { provider: 'ollama', model: 'llama3.2', label: 'Llama 3.2' },
      { provider: 'ollama', model: 'llama3.3', label: 'Llama 3.3' },
      { provider: 'ollama', model: 'deepseek-r1', label: 'DeepSeek R1' },
      { provider: 'ollama', model: 'qwen2.5', label: 'Qwen 2.5' },
      { provider: 'ollama', model: 'mistral', label: 'Mistral' },
    ],
  },
  {
    provider: 'freellm',
    providerLabel: PROVIDER_LABELS.freellm,
    models: [
      { provider: 'freellm', model: 'auto', label: 'Auto (fast/smart)' },
      { provider: 'freellm', model: 'auto:fast', label: 'Auto Fast' },
      { provider: 'freellm', model: 'auto:smart', label: 'Auto Smart' },
    ],
  },
];

export const DEFAULT_CHAT_MODEL_PREFERENCE: ChatModelPreference = {
  mode: 'auto',
  provider: 'groq',
  model: GROQ_DEFAULT_MODEL,
};

export function shortModelLabel(model: string): string {
  if (!model) return 'Auto';
  const tail = model.includes('/') ? model.split('/').pop()! : model;
  return tail.length > 28 ? `${tail.slice(0, 25)}…` : tail;
}

export function displayChatModelPreference(pref: ChatModelPreference): string {
  if (pref.mode === 'auto') return 'Auto';
  const group = CURATED_CHAT_MODELS.find((g) => g.provider === pref.provider);
  const known = group?.models.find((m) => m.model === pref.model);
  return known?.label || shortModelLabel(pref.model);
}

export function mergeOllamaDetectedModels(detected: string[]): ChatModelGroup[] {
  const groups = CURATED_CHAT_MODELS.map((g) => ({
    ...g,
    models: [...g.models],
  }));
  const ollama = groups.find((g) => g.provider === 'ollama');
  if (!ollama || detected.length === 0) return groups;

  const seen = new Set(ollama.models.map((m) => m.model));
  for (const name of detected) {
    const id = String(name || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ollama.models.push({
      provider: 'ollama',
      model: id,
      label: shortModelLabel(id),
    });
  }
  return groups;
}

export function parseChatModelPreference(raw: string | null): ChatModelPreference {
  if (!raw) return { ...DEFAULT_CHAT_MODEL_PREFERENCE };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatModelPreference>;
    if (parsed.mode === 'auto') {
      return { ...DEFAULT_CHAT_MODEL_PREFERENCE, mode: 'auto' };
    }
    if (
      parsed.mode === 'manual' &&
      typeof parsed.provider === 'string' &&
      typeof parsed.model === 'string' &&
      parsed.model.trim() &&
      (Object.keys(PROVIDER_LABELS) as string[]).includes(parsed.provider)
    ) {
      return {
        mode: 'manual',
        provider: parsed.provider as NativeEngineId,
        model: parsed.model.trim(),
      };
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_CHAT_MODEL_PREFERENCE };
}
