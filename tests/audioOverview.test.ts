import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { audioOverviewService } from '../services/notebook/audioOverviewService';
import { notebookService } from '../services/notebook/notebookService';
import { aiProviderService } from '../services/aiProviderService';
import { FallbackAnswerNotAcceptedError } from '../services/llm/fallbackAnswer';
import { AudioOverview } from '../types';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
(globalThis as any).localStorage = mockLocalStorage;

describe('AudioOverviewService', () => {
  const mockOverview: AudioOverview = {
    id: 'test-audio-1',
    title: 'Executive Podcast: SearchPilot vs ApexRank',
    createdAt: Date.now(),
    summary: 'A deep dive into competitor AI citation rates.',
    audioDurationSec: 25,
    script: [
      {
        speaker: 'Alex',
        text: 'Welcome to the podcast. Today we are looking at competitor entity schema.',
        durationEstimateMs: 6000,
      },
      {
        speaker: 'Sam',
        text: 'Right! The difference between 65% and 28% citation rate is massive.',
        durationEstimateMs: 7000,
      },
      {
        speaker: 'Alex',
        text: 'And it all comes down to direct answers and empirical benchmarks.',
        durationEstimateMs: 6500,
      },
    ],
  };

  beforeEach(() => {
    audioOverviewService.stop();
  });

  it('loads an overview and provides initial state', () => {
    audioOverviewService.loadOverview(mockOverview);
    const state = audioOverviewService.getState();

    expect(state.totalTurns).toBe(3);
    expect(state.currentTurnIndex).toBe(0);
    expect(state.currentSpeaker).toBe('Alex');
    expect(state.isPlaying).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.playbackRate).toBe(1.0);
  });

  it('handles state updates on seek and playback rate changes', () => {
    audioOverviewService.loadOverview(mockOverview);

    audioOverviewService.seekTo(1);
    let state = audioOverviewService.getState();
    expect(state.currentTurnIndex).toBe(1);
    expect(state.currentSpeaker).toBe('Sam');

    audioOverviewService.setRate(1.25);
    state = audioOverviewService.getState();
    expect(state.playbackRate).toBe(1.25);
  });

  it('subscribes to state changes', () => {
    audioOverviewService.loadOverview(mockOverview);
    let receivedTurns = -1;

    const unsubscribe = audioOverviewService.subscribe((s) => {
      receivedTurns = s.totalTurns;
    });

    expect(receivedTurns).toBe(3);
    unsubscribe();
  });
});

describe('AudioOverviewService.generatePodcast: a script the model wrote, or nothing', () => {
  // Words of the stock script that used to be stored when generation failed.
  const STOCK_SCRIPT_WORDS = ['Welcome to the Luminara Deep Dive', 'rock-solid'];
  let notebookId: string;

  beforeEach(() => {
    mockLocalStorage.clear();
    audioOverviewService.stop();
    const nb = notebookService.createNotebook('Audio overview test');
    notebookService.addTextSource(nb.id, 'A source', 'Entity authority requires Organization schema markup linked to Wikidata.');
    notebookId = nb.id;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  const reply = (text: string) => ({
    text,
    tokenUsage: { prompt: 1, completion: 1, total: 2 },
    finishReason: 'stop' as const,
  });
  const storedOverview = () => notebookService.getNotebook(notebookId)?.audioOverview;

  it('throws and stores nothing when no engine answers', async () => {
    vi.spyOn(aiProviderService, 'generateWithFallback').mockRejectedValue(new Error('All AI inference providers failed.'));
    const load = vi.spyOn(audioOverviewService, 'loadOverview');

    const error = await audioOverviewService.generatePodcast(notebookId).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Could not generate the Audio Overview');
    expect(error.message).toContain('All AI inference providers failed');
    expect(error.message).toContain('Nothing was saved');
    expect(storedOverview()).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    for (const words of STOCK_SCRIPT_WORDS) expect(JSON.stringify(notebookService.getNotebook(notebookId))).not.toContain(words);
  });

  it('does the same when Groq is down and only the fallback model replied', async () => {
    vi.spyOn(aiProviderService, 'generateWithFallback').mockRejectedValue(
      new FallbackAnswerNotAcceptedError('Groq Cloud Engine', { model: '@cf/meta/llama-3.1-8b-instruct-fast' }),
    );

    await expect(audioOverviewService.generatePodcast(notebookId)).rejects.toThrow(/Groq Cloud Engine did not answer/);
    expect(storedOverview()).toBeUndefined();
  });

  it.each([
    { name: 'prose instead of JSON', text: 'Here is a podcast about your sources.' },
    { name: 'JSON with no script', text: '{"title":"T","summary":"S"}' },
    { name: 'a script with no words in it', text: '{"script":[{"speaker":"Alex","text":"  "}]}' },
  ])('throws and stores nothing when the engine returns $name', async ({ text }) => {
    vi.spyOn(aiProviderService, 'generateWithFallback').mockResolvedValue(reply(text));

    await expect(audioOverviewService.generatePodcast(notebookId)).rejects.toThrow(/did not return a usable script/);
    expect(storedOverview()).toBeUndefined();
  });

  it('keeps the overview already there when a later generation fails', async () => {
    const generate = vi.spyOn(aiProviderService, 'generateWithFallback');
    generate.mockResolvedValueOnce(
      reply(JSON.stringify({
        title: 'What the source says',
        summary: 'Alex and Sam on entity authority.',
        script: [
          { speaker: 'Alex', text: 'The source is about entity authority.' },
          { speaker: 'Sam', text: 'It ties it to Organization schema and Wikidata.' },
        ],
      })),
    );
    const first = await audioOverviewService.generatePodcast(notebookId);

    expect(first.title).toBe('What the source says');
    expect(first.script.map(t => [t.speaker, t.text])).toEqual([
      ['Alex', 'The source is about entity authority.'],
      ['Sam', 'It ties it to Organization schema and Wikidata.'],
    ]);
    expect(storedOverview()?.id).toBe(first.id);

    generate.mockRejectedValueOnce(new Error('All AI inference providers failed.'));
    await expect(audioOverviewService.generatePodcast(notebookId)).rejects.toThrow(/Could not generate the Audio Overview/);

    expect(storedOverview()?.id).toBe(first.id);
    expect(storedOverview()?.title).toBe('What the source says');
  });
});
