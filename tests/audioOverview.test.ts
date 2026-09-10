import { describe, it, expect, beforeEach } from 'vitest';
import { audioOverviewService } from '../services/notebook/audioOverviewService';
import { AudioOverview } from '../types';

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
