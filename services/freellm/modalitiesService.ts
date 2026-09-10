/**
 * FreeLLMAPI modalities (BYOK sidecar only).
 * Embeddings, TTS, image generation, and audio transcription via the same
 * OpenAI-compatible base URL as chat. Never routed through Worker hosted keys.
 */
import { configService } from '../configService';

export type FreeLlmModality =
  | 'embeddings'
  | 'speech'
  | 'images'
  | 'transcription';

function assertConfigured(): { base: string; key: string } {
  const key = configService.getFreeLlmKey();
  if (!key) {
    throw new Error('FreeLLMAPI is not configured. Add your unified key in Settings → LLM.');
  }
  return { base: configService.getFreeLlmBaseUrl(), key };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const { base, key } = assertConfigured();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FreeLLMAPI ${path} failed (${res.status}): ${err}`);
  }
  return res.json() as Promise<T>;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface SpeechResult {
  /** Base64 audio (when API returns b64_json) or empty; prefer audioBlob when present. */
  audioBase64?: string;
  audioBlob?: Blob;
  contentType: string;
  model: string;
}

export interface ImageResult {
  url?: string;
  b64Json?: string;
  revisedPrompt?: string;
  model: string;
}

export interface TranscriptionResult {
  text: string;
  model: string;
}

export class FreeLlmModalitiesService {
  private static instance: FreeLlmModalitiesService;

  public static getInstance(): FreeLlmModalitiesService {
    if (!FreeLlmModalitiesService.instance) {
      FreeLlmModalitiesService.instance = new FreeLlmModalitiesService();
    }
    return FreeLlmModalitiesService.instance;
  }

  public isAvailable(): boolean {
    return Boolean(configService.getFreeLlmKey());
  }

  /**
   * Embed text for retrieval over playbooks / scrapes.
   * Model defaults to `auto` so FreeLLMAPI picks an available embedding endpoint.
   */
  public async embed(text: string, model = 'auto'): Promise<EmbeddingResult> {
    const data = await postJson<{
      data?: Array<{ embedding: number[] }>;
      model?: string;
    }>('/embeddings', { model, input: text });

    const embedding = data.data?.[0]?.embedding || [];
    return {
      embedding,
      model: data.model || model,
      dimensions: embedding.length,
    };
  }

  /**
   * Cosine similarity helper for lightweight local retrieval.
   */
  public cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Rank passages by embedding similarity to a query (in-memory, small corpora).
   */
  public async rankPassages(
    query: string,
    passages: string[],
    model = 'auto',
  ): Promise<Array<{ passage: string; score: number; index: number }>> {
    if (!passages.length) return [];
    const queryEmb = await this.embed(query, model);
    const scored: Array<{ passage: string; score: number; index: number }> = [];
    for (let i = 0; i < passages.length; i++) {
      const emb = await this.embed(passages[i], model);
      scored.push({
        passage: passages[i],
        score: this.cosineSimilarity(queryEmb.embedding, emb.embedding),
        index: i,
      });
    }
    return scored.sort((x, y) => y.score - x.score);
  }

  /**
   * Text-to-speech briefing (OpenAI-compatible `/audio/speech`).
   */
  public async speak(
    text: string,
    opts?: { model?: string; voice?: string; format?: 'mp3' | 'wav' | 'opus' },
  ): Promise<SpeechResult> {
    const { base, key } = assertConfigured();
    const model = opts?.model || 'auto';
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: opts?.voice || 'alloy',
        response_format: opts?.format || 'mp3',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FreeLLMAPI /audio/speech failed (${res.status}): ${err}`);
    }
    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    const blob = await res.blob();
    return { audioBlob: blob, contentType, model };
  }

  /**
   * Play a short audit briefing in the browser (uses Web Audio / HTMLAudioElement).
   */
  public async briefAloud(text: string): Promise<void> {
    const spoken = await this.speak(text.slice(0, 4000));
    if (!spoken.audioBlob || typeof window === 'undefined') return;
    const url = URL.createObjectURL(spoken.audioBlob);
    try {
      const audio = new Audio(url);
      await audio.play();
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error('Audio playback failed'));
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Image generation for SEO image / OG workflows.
   */
  public async generateImage(
    prompt: string,
    opts?: { model?: string; size?: string; n?: number },
  ): Promise<ImageResult> {
    const model = opts?.model || 'auto';
    const data = await postJson<{
      data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
      model?: string;
    }>('/images/generations', {
      model,
      prompt,
      n: opts?.n ?? 1,
      size: opts?.size || '1024x1024',
    });
    const first = data.data?.[0] || {};
    return {
      url: first.url,
      b64Json: first.b64_json,
      revisedPrompt: first.revised_prompt,
      model: data.model || model,
    };
  }

  /**
   * Transcribe competitor video / audio via `/audio/transcriptions` (multipart).
   */
  public async transcribe(
    file: Blob,
    opts?: { model?: string; filename?: string; language?: string },
  ): Promise<TranscriptionResult> {
    const { base, key } = assertConfigured();
    const model = opts?.model || 'auto';
    const form = new FormData();
    form.append('file', file, opts?.filename || 'audio.webm');
    form.append('model', model);
    if (opts?.language) form.append('language', opts.language);

    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FreeLLMAPI /audio/transcriptions failed (${res.status}): ${err}`);
    }
    const data = await res.json() as { text?: string; model?: string };
    return { text: data.text || '', model: data.model || model };
  }
}

export const freeLlmModalitiesService = FreeLlmModalitiesService.getInstance();
