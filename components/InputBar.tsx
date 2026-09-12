import React, { useState, useEffect } from 'react';
import { ICONS } from '../constants';
import { OracleMode } from '../types';
import { OracleLiveService } from '../services/liveService';
import { ComposerModelPicker } from './llm/ComposerModelPicker';
import { draftPersistenceService, DRAFT_KEYS } from '../services/state/draftPersistenceService';
import { productTelemetry } from '../services/analytics/productTelemetry';

interface InputBarProps {
  onSendMessage: (text: string) => void;
  onVoiceToggle: () => void;
  isVoiceActive: boolean;
  isThinking: boolean;
  mode: OracleMode;
}

const InputBar: React.FC<InputBarProps> = ({ onSendMessage, onVoiceToggle, isVoiceActive, isThinking, mode }) => {
  const [inputValue, setInputValue] = useState(() => draftPersistenceService.getDraft(DRAFT_KEYS.CHAT_INPUT));
  const [showDraftNotice, setShowDraftNotice] = useState(() => draftPersistenceService.hasDraft(DRAFT_KEYS.CHAT_INPUT));

  useEffect(() => {
    if (showDraftNotice) {
      productTelemetry.recordDraftRestored('chat_input');
      const timer = setTimeout(() => setShowDraftNotice(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [showDraftNotice]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    draftPersistenceService.setDraft(DRAFT_KEYS.CHAT_INPUT, val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isThinking) {
      const text = inputValue.trim();
      draftPersistenceService.clearDraft(DRAFT_KEYS.CHAT_INPUT);
      productTelemetry.recordFirstValue('chat');
      onSendMessage(text);
      setInputValue('');
      setShowDraftNotice(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-3 sm:pb-4 pt-1 sm:pt-2">
      <form 
        onSubmit={handleSubmit}
        className={`glass-morphism rounded-[24px] p-2 flex items-center gap-2 transition-all duration-700 shadow-2xl relative overflow-hidden ${
          isThinking 
            ? 'opacity-40 grayscale-[40%] cursor-not-allowed pointer-events-none scale-[0.985] border-gold/10 ring-1 ring-gold/5' 
            : 'border-gold/20 hover:border-gold/40'
        }`}
      >
        {/* Subtle background pulse for thinking state */}
        {isThinking && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gold/5 to-transparent animate-[shimmer_2s_infinite] pointer-events-none" />
        )}

        <div className="relative z-10 pl-1">
          <ComposerModelPicker disabled={isThinking} />
        </div>

        <button
          type="button"
          onClick={onVoiceToggle}
          disabled={isThinking || !OracleLiveService.isAvailable()}
          title={OracleLiveService.isAvailable() ? 'Oracle Agent Live Voice' : 'Live Voice needs a Gemini API key in Settings'}
          aria-label={isVoiceActive ? 'Stop voice input' : 'Start live voice'}
          aria-pressed={isVoiceActive}
          className={`p-3.5 rounded-xl transition-all relative z-10 outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
            isVoiceActive
              ? 'bg-danger-500/20 text-danger-400 animate-pulse'
              : 'hover:bg-white/5 text-gold'
          } ${isThinking ? 'cursor-not-allowed opacity-30' : ''}`}
        >
          <ICONS.Mic />
        </button>
        
        <div className="flex-1 flex items-center relative z-10">
          <label htmlFor="chat-query-input" className="sr-only">
            Ask a question or paste your website address
          </label>
          <input
            id="chat-query-input"
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            disabled={isThinking}
            placeholder={
              isThinking 
                ? "Working on your answer…" 
                : isVoiceActive 
                  ? "Listening…" 
                  : "Ask a question, or paste your website address"
            }
            className={`w-full bg-transparent border-none outline-none text-gray-100 py-3.5 px-3 placeholder-gray-500 text-sm tracking-wide transition-all focus-visible:ring-1 focus-visible:ring-gold/50 rounded-lg ${
              isThinking ? 'cursor-not-allowed italic text-gray-400' : ''
            }`}
          />
          {showDraftNotice && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-mono text-gold-light bg-gold/15 border border-gold/30 px-2 py-0.5 rounded-full mr-2 shrink-0 animate-in fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
              Draft restored
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 pr-2 relative z-10">
          {inputValue.trim() && !isThinking ? (
            <button
              type="submit"
              disabled={isThinking}
              aria-label="Send message"
              className="p-3.5 bg-gradient-to-br from-gold to-gold-dark text-black rounded-xl hover:opacity-90 active:scale-[0.98] transition-all shadow-lg gold-glow outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
            >
              <ICONS.Send />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              {isThinking ? (
                <div className="w-10 h-10 flex items-center justify-center">
                   <div className="w-5 h-5 border-2 border-gold/30 border-t-gold rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                  mode === OracleMode.DEEP_THINK 
                    ? 'bg-gold/10 text-gold border border-gold/20' 
                    : 'bg-white/5 text-gray-400 border border-white/10'
                }`}>
                  {mode === OracleMode.DEEP_THINK ? 'Thorough' : 'Quick'}
                </div>
              )}
            </div>
          )}
        </div>
      </form>
      <div className="mt-2 text-center">
        <p className={`text-[10px] uppercase tracking-[0.2em] transition-all duration-500 ${isThinking ? 'text-gray-500' : 'text-gray-400'}`}>
          Answers can be wrong. Check important facts before acting. &copy; Luminara Suite
        </p>
      </div>
    </div>
  );
};

export default InputBar;
