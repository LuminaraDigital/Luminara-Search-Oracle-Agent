
import React, { useState } from 'react';
import { ICONS } from '../constants';
import { OracleMode } from '../types';

interface InputBarProps {
  onSendMessage: (text: string) => void;
  onVoiceToggle: () => void;
  isVoiceActive: boolean;
  isThinking: boolean;
  mode: OracleMode;
}

const InputBar: React.FC<InputBarProps> = ({ onSendMessage, onVoiceToggle, isVoiceActive, isThinking, mode }) => {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isThinking) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-10 pt-4">
      <form 
        onSubmit={handleSubmit}
        className={`glass-morphism rounded-[24px] p-2 flex items-center gap-2 transition-all duration-700 shadow-2xl relative overflow-hidden ${
          isThinking 
            ? 'opacity-40 grayscale-[40%] cursor-not-allowed pointer-events-none scale-[0.985] border-[#BF953F]/10 ring-1 ring-[#BF953F]/5' 
            : 'border-[#BF953F]/20 hover:border-[#BF953F]/40'
        }`}
      >
        {/* Subtle background pulse for thinking state */}
        {isThinking && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#BF953F]/5 to-transparent animate-[shimmer_2s_infinite] pointer-events-none" />
        )}

        <button
          type="button"
          onClick={onVoiceToggle}
          disabled={isThinking}
          className={`p-3.5 rounded-xl transition-all relative z-10 ${
            isVoiceActive 
              ? 'bg-red-500/20 text-red-400 animate-pulse' 
              : 'hover:bg-white/5 text-[#BF953F]'
          } ${isThinking ? 'cursor-not-allowed opacity-30' : ''}`}
          title="Luminara Vaticinator Live Voice"
        >
          <ICONS.Mic />
        </button>
        
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isThinking}
          placeholder={
            isThinking 
              ? "Vaticinator is architecting your strategy..." 
              : isVoiceActive 
                ? "Listening for optimization query..." 
                : "Ask Vaticinator or provide a URL for simulation..."
          }
          className={`flex-1 bg-transparent border-none outline-none text-gray-100 py-3.5 px-3 placeholder-gray-600 text-sm tracking-wide transition-all relative z-10 ${
            isThinking ? 'cursor-not-allowed italic text-gray-500' : ''
          }`}
        />

        <div className="flex items-center gap-2 pr-2 relative z-10">
          {inputValue.trim() && !isThinking ? (
            <button
              type="submit"
              disabled={isThinking}
              className="p-3.5 bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black rounded-xl hover:opacity-90 transition-all shadow-lg gold-glow"
            >
              <ICONS.Send />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              {isThinking ? (
                <div className="w-10 h-10 flex items-center justify-center">
                   <div className="w-5 h-5 border-2 border-[#BF953F]/30 border-t-[#BF953F] rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                  mode === OracleMode.DEEP_THINK 
                    ? 'bg-[#BF953F]/10 text-[#BF953F] border border-[#BF953F]/20' 
                    : 'bg-white/5 text-gray-400 border border-white/10'
                }`}>
                  {mode === OracleMode.DEEP_THINK ? 'Deep Strategy' : 'Flash Insight'}
                </div>
              )}
            </div>
          )}
        </div>
      </form>
      <div className="mt-4 text-center">
        <p className={`text-[10px] uppercase tracking-[0.2em] transition-all duration-500 ${isThinking ? 'text-gray-700' : 'text-gray-600'}`}>
          Precision Search Intelligence &copy; Luminara Search Vaticinator
        </p>
      </div>
    </div>
  );
};

export default InputBar;
