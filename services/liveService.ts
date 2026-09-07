import { GoogleGenAI, Modality, Blob, LiveServerMessage } from '@google/genai';
import { configService } from './configService';
const getApiKey = () => configService.getGeminiKey() === 'proxy' ? '' : configService.getGeminiKey();

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const frameCount = Math.floor(dataInt16.length / numChannels);
  const buffer = ctx.createBuffer(numChannels, Math.max(frameCount, 1), sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export class LiveVoiceError extends Error {
  constructor(message: string, public readonly code: 'NO_KEY' | 'MIC_DENIED' | 'CONNECT_FAILED') {
    super(message);
    this.name = 'LiveVoiceError';
  }
}

export class OracleLiveService {
  private ai: GoogleGenAI | null = null;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private onTranscription: (text: string, isUser: boolean) => void;
  private onStateChange: (active: boolean) => void;
  private onError?: (err: Error) => void;

  constructor(
    onTranscription: (text: string, isUser: boolean) => void,
    onStateChange: (active: boolean) => void,
    onError?: (err: Error) => void
  ) {
    this.onTranscription = onTranscription;
    this.onStateChange = onStateChange;
    this.onError = onError;
  }

  /** Voice mode is Gemini-only. Callers should gate the mic button on this. */
  static isAvailable(): boolean {
    return Boolean(getApiKey());
  }

  /**
   * Starts a live session. Rejects with LiveVoiceError when the key is missing,
   * the mic is denied, or the socket cannot be opened. Callers must catch.
   */
  async start(): Promise<void> {
    const key = getApiKey();
    if (!key) {
      throw new LiveVoiceError('Live Voice requires a Google Gemini API key. Add one in Settings.', 'NO_KEY');
    }
    this.ai = new GoogleGenAI({ apiKey: key });

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      throw new LiveVoiceError(`Microphone access was denied or unavailable (${e?.name || 'error'}).`, 'MIC_DENIED');
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioCtx({ sampleRate: 16000 });
    this.outputAudioContext = new AudioCtx({ sampleRate: 24000 });

    let currentInputTranscription = '';
    let currentOutputTranscription = '';

    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          this.onStateChange(true);
          if (!this.audioContext || !this.stream) return;
          this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
          this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
          this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
            const pcmBlob = this.createBlob(inputData);
            this.sessionPromise?.then((session) => {
              session.sendRealtimeInput({ media: pcmBlob });
            }).catch(() => { /* session already closed */ });
          };
          this.sourceNode.connect(this.scriptProcessor);
          this.scriptProcessor.connect(this.audioContext.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          const sc = message.serverContent;
          if (sc?.outputTranscription?.text) {
            currentOutputTranscription += sc.outputTranscription.text;
            this.onTranscription(currentOutputTranscription, false);
          } else if (sc?.inputTranscription?.text) {
            currentInputTranscription += sc.inputTranscription.text;
            this.onTranscription(currentInputTranscription, true);
          }

          if (sc?.turnComplete) {
            currentInputTranscription = '';
            currentOutputTranscription = '';
          }

          const parts = sc?.modelTurn?.parts ?? [];
          for (const part of parts) {
            const base64Audio = part?.inlineData?.data;
            if (base64Audio) {
              try {
                await this.playAudio(base64Audio);
              } catch (e) {
                console.warn('[Live] audio decode failed', e);
              }
            }
          }

          if (sc?.interrupted) {
            this.stopAllAudio();
          }
        },
        onclose: () => {
          this.onStateChange(false);
          this.releaseAudio();
        },
        onerror: (e: any) => {
          console.error('Live API Error:', e);
          this.onError?.(new LiveVoiceError(e?.message || 'Live session error', 'CONNECT_FAILED'));
          this.onStateChange(false);
          this.releaseAudio();
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
        systemInstruction: 'You are Oracle Agent, the elite AEO and Search Architect for Luminara Search. In Live Voice mode, provide authoritative, expert insights on search optimization, generative engines, and agentic workflows. Be concise, professional, and clear. Avoid filler.',
        outputAudioTranscription: {},
        inputAudioTranscription: {},
      },
    });

    try {
      await this.sessionPromise;
    } catch (e: any) {
      this.releaseAudio();
      throw new LiveVoiceError(e?.message || 'Could not open the live audio session.', 'CONNECT_FAILED');
    }
  }

  private createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)));
    }
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  }

  private async playAudio(base64: string) {
    if (!this.outputAudioContext) return;
    this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
    const audioBuffer = await decodeAudioData(decode(base64), this.outputAudioContext, 24000, 1);
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputAudioContext.destination);
    source.addEventListener('ended', () => this.sources.delete(source));
    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
    this.sources.add(source);
  }

  private stopAllAudio() {
    this.sources.forEach(s => { try { s.stop(); } catch { /* already stopped */ } });
    this.sources.clear();
    this.nextStartTime = 0;
  }

  private releaseAudio() {
    this.stopAllAudio();
    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      try { this.scriptProcessor.disconnect(); } catch { /* noop */ }
      this.scriptProcessor = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch { /* noop */ }
      this.sourceNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.outputAudioContext) {
      this.outputAudioContext.close().catch(() => {});
      this.outputAudioContext = null;
    }
  }

  async stop() {
    this.onStateChange(false);
    this.releaseAudio();
    const pending = this.sessionPromise;
    this.sessionPromise = null;
    if (!pending) return;
    try {
      const session = await pending;
      session?.close?.();
    } catch {
      // session never opened; nothing to close
    }
  }
}
