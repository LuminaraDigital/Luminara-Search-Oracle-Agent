import React, { useState, useEffect, useRef } from 'react';
import { AudioOverview, AudioOverviewTurn } from '../../types';
import { audioOverviewService, AudioPlayerState } from '../../services/notebook/audioOverviewService';
import { ICONS } from '../../constants';

interface AudioOverviewPlayerProps {
  overview: AudioOverview;
  onRegenerate?: () => void;
  isGenerating?: boolean;
}

export const AudioOverviewPlayer: React.FC<AudioOverviewPlayerProps> = ({
  overview,
  onRegenerate,
  isGenerating = false,
}) => {
  const [playerState, setPlayerState] = useState<AudioPlayerState>(() => audioOverviewService.getState());
  const [showTranscript, setShowTranscript] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    audioOverviewService.loadOverview(overview);
    const unsubscribe = audioOverviewService.subscribe(state => {
      setPlayerState(state);
    });
    return () => {
      unsubscribe();
    };
  }, [overview]);

  useEffect(() => {
    if (showTranscript && transcriptRef.current) {
      const activeEl = transcriptRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [playerState.currentTurnIndex, showTranscript]);

  const handlePlayPause = () => {
    if (playerState.isPlaying) {
      audioOverviewService.pause();
    } else {
      audioOverviewService.play();
    }
  };

  const handleSeek = (turnIdx: number) => {
    audioOverviewService.seekTo(turnIdx);
  };

  const handleRateChange = (rate: number) => {
    audioOverviewService.setRate(rate);
  };

  return (
    <div className="glass-morphism rounded-2xl border border-gold/40 p-5 shadow-2xl bg-black/90 space-y-4">
      {/* Header with Title and Regenerate Action */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold to-gold-dark text-black flex items-center justify-center shadow-lg shadow-gold/20 shrink-0">
            <ICONS.Podcast className="w-5 h-5 text-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] font-black text-gold-light">
                Audio Overview
              </span>
              <span className="px-1.5 py-0.5 rounded bg-gold/15 text-gold-light text-[8px] font-mono font-bold">
                DUAL-HOST
              </span>
            </div>
            <h4 className="text-sm font-bold text-white tracking-tight line-clamp-1">
              {overview.title}
            </h4>
          </div>
        </div>

        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={isGenerating}
            className="px-2.5 py-1 rounded-lg border border-white/10 hover:border-gold/40 text-[10px] text-gray-400 hover:text-white transition-all disabled:opacity-50 flex items-center gap-1.5"
            title="Generate a new podcast discussion"
          >
            <ICONS.Sparkle className="w-3 h-3 text-gold" />
            <span>{isGenerating ? 'Generating…' : 'New Take'}</span>
          </button>
        )}
      </div>

      {overview.summary && (
        <p className="text-xs text-gray-400 leading-relaxed italic bg-surface-1/40 p-2.5 rounded-xl border border-white/5">
          "{overview.summary}"
        </p>
      )}

      {/* Interactive Waveform & Playback Controls */}
      <div className="p-4 rounded-xl bg-surface-1 border border-white/10 space-y-3">
        {/* Animated Audio Waveform Bars */}
        <div className="flex items-center justify-center gap-1 h-10 px-2 overflow-hidden">
          {Array.from({ length: 28 }).map((_, i) => {
            const isSpeaking = playerState.isPlaying;
            const baseHeight = 20 + Math.sin(i * 0.8) * 15;
            const activeHeight = isSpeaking 
              ? Math.max(15, Math.min(100, Math.floor(Math.random() * 80 + 20))) 
              : baseHeight;
            const isCurrentPast = ((i / 28) * 100) <= playerState.progressPct;

            return (
              <div
                key={i}
                className="w-1 rounded-full transition-all duration-200"
                style={{
                  height: `${isSpeaking ? activeHeight : 25}%`,
                  backgroundColor: isCurrentPast 
                    ? '#BF953F' 
                    : isSpeaking ? 'rgba(191, 149, 63, 0.4)' : 'rgba(255, 255, 255, 0.1)',
                }}
              />
            );
          })}
        </div>

        {/* Primary Controls Row */}
        <div className="flex items-center justify-between pt-1">
          {/* Host Indicators */}
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider transition-all ${
              playerState.currentSpeaker === 'Alex'
                ? 'bg-gold text-black shadow-md font-black ring-2 ring-gold/40'
                : 'bg-white/5 text-gray-400'
            }`}>
              Alex
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider transition-all ${
              playerState.currentSpeaker === 'Sam'
                ? 'bg-sky-500 text-black shadow-md font-black ring-2 ring-sky-400/40'
                : 'bg-white/5 text-gray-400'
            }`}>
              Sam
            </span>
          </div>

          {/* Center Play/Pause button */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => audioOverviewService.stop()}
              className="p-2 rounded-full text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
              title="Stop playback"
            >
              <div className="w-2.5 h-2.5 bg-current rounded-sm" />
            </button>

            <button
              onClick={handlePlayPause}
              className="w-10 h-10 rounded-full bg-gradient-to-r from-gold to-gold-dark hover:scale-105 active:scale-95 text-black flex items-center justify-center shadow-lg shadow-gold/25 transition-transform"
              title={playerState.isPlaying ? 'Pause' : 'Play'}
            >
              {playerState.isPlaying ? (
                <div className="flex gap-1">
                  <div className="w-1 h-3.5 bg-black rounded-full" />
                  <div className="w-1 h-3.5 bg-black rounded-full" />
                </div>
              ) : (
                <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-black border-b-[6px] border-b-transparent ml-0.5" />
              )}
            </button>

            <button
              onClick={() => setShowTranscript(prev => !prev)}
              className={`p-2 rounded-lg text-xs font-mono transition-colors ${
                showTranscript ? 'text-gold-light bg-gold/10' : 'text-gray-400 hover:text-white'
              }`}
              title="Toggle Script Transcript"
            >
              <ICONS.Document className="w-4 h-4" />
            </button>
          </div>

          {/* Playback Rate Selector */}
          <div className="flex items-center gap-1 bg-surface-2/60 p-0.5 rounded-lg border border-white/5">
            {[1.0, 1.25, 1.5].map(rate => (
              <button
                key={rate}
                onClick={() => handleRateChange(rate)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                  playerState.playbackRate === rate
                    ? 'bg-gold/30 text-gold-light font-bold'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Synchronized Transcript View */}
      {showTranscript && overview.script.length > 0 && (
        <div
          ref={transcriptRef}
          className="max-h-52 overflow-y-auto space-y-2 pr-1 custom-scrollbar text-xs"
        >
          {overview.script.map((turn: AudioOverviewTurn, idx: number) => {
            const isActive = playerState.currentTurnIndex === idx;
            return (
              <div
                key={idx}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => handleSeek(idx)}
                className={`p-3 rounded-xl cursor-pointer transition-all border ${
                  isActive
                    ? 'bg-gold/10 border-gold/50 shadow-md shadow-gold/5 text-white'
                    : 'bg-surface-1/30 border-white/5 hover:border-white/15 text-gray-400 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${
                    turn.speaker === 'Alex' ? 'text-gold-light' : 'text-sky-400'
                  }`}>
                    {turn.speaker}
                  </span>
                  {isActive && playerState.isPlaying && (
                    <span className="flex items-center gap-1 text-[9px] text-gold-light font-mono animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-gold" />
                      Speaking
                    </span>
                  )}
                </div>
                <p className="leading-relaxed">
                  {turn.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
