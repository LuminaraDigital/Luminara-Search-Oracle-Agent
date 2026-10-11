/**
 * Luminara Audio Overview Podcast Service
 * 
 * Generates two-host deep dive audio conversations ("Audio Overview" standard)
 * from notebook sources and manages synchronized dual-voice playback via Web Speech API.
 */

import { AudioOverview, AudioOverviewTurn, Notebook, NotebookSource } from '../../types';
import { aiProviderService, safeJsonParse } from '../aiProviderService';
import { notebookService } from './notebookService';
import { wrapUntrustedContent, UNTRUSTED_CONTENT_RULE } from '../../utils/untrustedContent';
import { toUserFacingText } from '../../utils/userFacingText';

export function buildAudioOverviewPrompt(sources: NotebookSource[]): string {
  const corpusText = sources
    .map((s, i) => `[Source ${i + 1}: ${s.title}]\n${s.content.slice(0, 2500)}`)
    .join('\n\n');

  return `You are the executive director of Luminara Deep Dive, a top-tier executive intelligence and AI visibility audio briefing.
Write a natural, engaging, and analytical conversational dialogue between two expert AI hosts discussing the following sources:
- Host 1: "Alex" (Inquisitive, sets the stage, frames the strategic big picture, energetic tone).
- Host 2: "Sam" (Analytical, digs into specifics, pulls out technical nuances, competitive data, and actionable takeaways).

Rules:
1. Make the conversation sound authentic: use natural transitions, casual interjections ("Right", "Exactly", "Here's what's fascinating", "Wait, so..."), but keep it deeply informative.
2. Discuss the key insights, competitor gaps, and strategic actions from the sources.
3. Write between 5 and 8 alternating dialogue turns.
4. Output STRICT JSON format as follows:
{
  "title": "Short catchy podcast episode title",
  "summary": "1-2 sentence episode summary",
  "script": [
    { "speaker": "Alex", "text": "Opening hook..." },
    { "speaker": "Sam", "text": "Nuanced reaction and first key point..." }
  ]
}

${UNTRUSTED_CONTENT_RULE}

SOURCES:
${wrapUntrustedContent('NOTEBOOK_SOURCES', corpusText)}
`;
}

export interface AudioPlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTurnIndex: number;
  totalTurns: number;
  currentSpeaker: 'Alex' | 'Sam' | null;
  currentText: string;
  playbackRate: number;
  progressPct: number;
}

export class AudioOverviewService {
  private static instance: AudioOverviewService;

  private currentOverview: AudioOverview | null = null;
  private currentTurnIndex = 0;
  private isPlaying = false;
  private isPaused = false;
  private playbackRate = 1.0;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private stateListeners: Set<(state: AudioPlayerState) => void> = new Set();
  private tickInterval: any = null;

  private constructor() {}

  public static getInstance(): AudioOverviewService {
    if (!AudioOverviewService.instance) {
      AudioOverviewService.instance = new AudioOverviewService();
    }
    return AudioOverviewService.instance;
  }

  // -------------------------------------------------------------------------
  // Podcast Script Generation
  // -------------------------------------------------------------------------

  public async generatePodcast(notebookId: string): Promise<AudioOverview> {
    const nb = notebookService.getNotebook(notebookId);
    if (!nb) throw new Error('Notebook not found');

    const activeSources = nb.sources.filter(s => s.selected);
    if (activeSources.length === 0) {
      throw new Error('Please select at least one source before generating an Audio Overview podcast.');
    }

    const prompt = buildAudioOverviewPrompt(activeSources);

    let title = `Deep Dive: ${nb.title}`;
    let summary = `Alex and Sam analyze ${activeSources.length} sources from ${nb.title}.`;

    // A failure here is thrown to the caller, which shows it. Nothing is stored: an overview is
    // a script a model wrote from these sources, or there is no overview. There is no stock
    // script to fall back on, because it would be read out as an analysis of sources nobody read.
    let res;
    try {
      res = await aiProviderService.generateWithFallback(prompt, {
        temperature: 0.6,
        maxTokens: 2500,
      });
    } catch (err) {
      console.error('[AudioOverview] Failed to generate script via AI', err);
      const reason = toUserFacingText(err, 'no AI engine answered').replace(/[.\s]+$/, '');
      throw new Error(`Could not generate the Audio Overview: ${reason}. Nothing was saved. Your sources are unchanged.`);
    }

    const parsed = safeJsonParse<{ title?: string; summary?: string; script?: Array<{ speaker: string; text: string }> }>(
      res.text || '',
      {}
    );
    const turns = Array.isArray(parsed.script)
      ? parsed.script.filter(turn => turn && typeof turn.text === 'string' && turn.text.trim())
      : [];
    if (turns.length === 0) {
      throw new Error(
        'Could not generate the Audio Overview: the AI engine did not return a usable script. Nothing was saved. Please try again.',
      );
    }

    if (parsed.title) title = parsed.title;
    if (parsed.summary) summary = parsed.summary;
    const generatedScript: AudioOverviewTurn[] = turns.map(turn => ({
      speaker: turn.speaker === 'Sam' ? 'Sam' : 'Alex',
      text: turn.text,
      durationEstimateMs: Math.max(3000, Math.round(turn.text.split(' ').length * 300)),
    }));

    const audioOverview: AudioOverview = {
      id: `audio-${Date.now()}`,
      title,
      createdAt: Date.now(),
      summary,
      script: generatedScript,
      audioDurationSec: Math.round(generatedScript.reduce((sum, t) => sum + (t.durationEstimateMs || 5000), 0) / 1000),
    };

    notebookService.updateNotebook(notebookId, { audioOverview });
    this.loadOverview(audioOverview);
    return audioOverview;
  }

  // -------------------------------------------------------------------------
  // Audio Player Engine (Web Speech API)
  // -------------------------------------------------------------------------

  public loadOverview(overview: AudioOverview): void {
    this.stop();
    this.currentOverview = overview;
    this.currentTurnIndex = 0;
    this.notifyState();
  }

  public play(fromIndex?: number): void {
    if (!this.currentOverview || this.currentOverview.script.length === 0) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.warn('[AudioOverview] SpeechSynthesis API not supported in this environment');
      return;
    }

    if (fromIndex !== undefined) {
      this.currentTurnIndex = Math.max(0, Math.min(fromIndex, this.currentOverview.script.length - 1));
    }

    if (this.isPaused && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      this.isPlaying = true;
      this.isPaused = false;
      this.startTick();
      this.notifyState();
      return;
    }

    this.isPlaying = true;
    this.isPaused = false;
    this.startTick();
    this.speakCurrentTurn();
  }

  public pause(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.pause();
    }
    this.isPlaying = false;
    this.isPaused = true;
    this.stopTick();
    this.notifyState();
  }

  public resume(): void {
    this.play();
  }

  public stop(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.currentTurnIndex = 0;
    this.stopTick();
    this.notifyState();
  }

  public seekTo(turnIndex: number): void {
    if (!this.currentOverview) return;
    const clamped = Math.max(0, Math.min(turnIndex, this.currentOverview.script.length - 1));
    const wasPlaying = this.isPlaying;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.currentTurnIndex = clamped;
    if (wasPlaying) {
      this.speakCurrentTurn();
    } else {
      this.notifyState();
    }
  }

  public setRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2.0, rate));
    if (this.isPlaying) {
      this.speakCurrentTurn();
    } else {
      this.notifyState();
    }
  }

  private speakCurrentTurn(): void {
    if (!this.currentOverview || typeof window === 'undefined' || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    if (this.currentTurnIndex >= this.currentOverview.script.length) {
      this.stop();
      return;
    }

    const turn = this.currentOverview.script[this.currentTurnIndex];
    const utterance = new SpeechSynthesisUtterance(turn.text);
    this.currentUtterance = utterance;

    // Resolve Distinct Voices for Alex and Sam
    const voices = window.speechSynthesis.getVoices();
    const englishVoices = voices.filter(v => v.lang.startsWith('en'));

    if (turn.speaker === 'Alex') {
      // Alex: authoritative, deeper tone
      utterance.pitch = 0.9;
      utterance.rate = this.playbackRate * 0.98;
      if (englishVoices.length > 0) {
        utterance.voice = englishVoices[0];
      }
    } else {
      // Sam: dynamic, lighter tone
      utterance.pitch = 1.15;
      utterance.rate = this.playbackRate * 1.05;
      if (englishVoices.length > 1) {
        utterance.voice = englishVoices[1];
      } else if (englishVoices.length > 0) {
        utterance.voice = englishVoices[0];
      }
    }

    utterance.onend = () => {
      if (this.isPlaying) {
        this.currentTurnIndex++;
        if (this.currentTurnIndex < (this.currentOverview?.script.length || 0)) {
          // Small natural pause between turns
          setTimeout(() => {
            if (this.isPlaying) this.speakCurrentTurn();
          }, 350);
        } else {
          this.stop();
        }
      }
    };

    utterance.onerror = (e) => {
      console.warn('[AudioOverview] Utterance error', e);
      if (this.isPlaying) {
        this.currentTurnIndex++;
        if (this.currentTurnIndex < (this.currentOverview?.script.length || 0)) {
          this.speakCurrentTurn();
        } else {
          this.stop();
        }
      }
    };

    window.speechSynthesis.speak(utterance);
    this.notifyState();
  }

  // -------------------------------------------------------------------------
  // State Subscriptions
  // -------------------------------------------------------------------------

  public getState(): AudioPlayerState {
    const totalTurns = this.currentOverview?.script.length || 0;
    const currentTurn = this.currentOverview?.script[this.currentTurnIndex];
    const progressPct = totalTurns > 0 ? Math.round(((this.currentTurnIndex + 1) / totalTurns) * 100) : 0;

    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      currentTurnIndex: this.currentTurnIndex,
      totalTurns,
      currentSpeaker: currentTurn?.speaker || null,
      currentText: currentTurn?.text || '',
      playbackRate: this.playbackRate,
      progressPct,
    };
  }

  public subscribe(listener: (state: AudioPlayerState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private notifyState(): void {
    const state = this.getState();
    this.stateListeners.forEach(l => l(state));
  }

  private startTick(): void {
    this.stopTick();
    this.tickInterval = setInterval(() => {
      if (this.isPlaying) {
        this.notifyState();
      }
    }, 500);
  }

  private stopTick(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
}

export const audioOverviewService = AudioOverviewService.getInstance();
