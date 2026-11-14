import React, { useState, useEffect, useRef } from 'react';
import { ICONS } from '../constants';
import { OracleMode } from '../types';
import { liveVoiceAvailable } from '../services/live/voiceAvailable';
import { ComposerModelPicker } from './llm/ComposerModelPicker';
import { draftPersistenceService, DRAFT_KEYS } from '../services/state/draftPersistenceService';
import { productTelemetry } from '../services/analytics/productTelemetry';

interface InputBarProps {
  onSendMessage: (text: string) => void;
  onVoiceToggle: () => void;
  isVoiceActive: boolean;
  isThinking: boolean;
  mode: OracleMode;
  onModeChange?: (mode: OracleMode) => void;
  onStop?: () => void;
  onClear?: () => void;
  canClear?: boolean;
}

const MODES: Array<{ mode: OracleMode; name: string; line: string }> = [
  { mode: OracleMode.FLASH, name: 'Quick', line: 'A short answer in seconds. Good for a yes, a no or a next step.' },
  { mode: OracleMode.DEEP_THINK, name: 'Thorough', line: 'Reads more sources and checks its working. Takes longer.' },
];

/** The Ask composer: a pane of glass over the horizon. Enter sends, Shift+Enter starts a new line. */
const InputBar: React.FC<InputBarProps> = ({
  onSendMessage, onVoiceToggle, isVoiceActive, isThinking, mode, onModeChange, onStop, onClear, canClear,
}) => {
  const [inputValue, setInputValue] = useState(() => draftPersistenceService.getDraft(DRAFT_KEYS.CHAT_INPUT));
  const [showDraftNotice, setShowDraftNotice] = useState(() => draftPersistenceService.hasDraft(DRAFT_KEYS.CHAT_INPUT));
  const [menuOpen, setMenuOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const modeBtnRef = useRef<HTMLButtonElement>(null);
  const current = MODES.find((m) => m.mode === mode) ?? MODES[0];

  useEffect(() => {
    if (showDraftNotice) {
      productTelemetry.recordDraftRestored('chat_input');
      const timer = setTimeout(() => setShowDraftNotice(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [showDraftNotice]);

  // Grow with the text, up to the cap in ledger.css.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputValue]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-mode-menu]')) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        modeBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    draftPersistenceService.setDraft(DRAFT_KEYS.CHAT_INPUT, val);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isThinking) {
      onStop?.();
      return;
    }
    if (inputValue.trim()) {
      const text = inputValue.trim();
      draftPersistenceService.clearDraft(DRAFT_KEYS.CHAT_INPUT);
      productTelemetry.recordFirstValue('chat');
      onSendMessage(text);
      setInputValue('');
      setShowDraftNotice(false);
    }
  };

  const canSend = isThinking ? Boolean(onStop) : Boolean(inputValue.trim());

  return (
    <div className="lg-dock">
      <form onSubmit={handleSubmit} className="lg-composer" data-mode-menu>
        <label htmlFor="chat-query-input" className="sr-only">
          Ask a question or paste your website address
        </label>
        <textarea
          id="chat-query-input"
          ref={areaRef}
          rows={1}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={isVoiceActive ? 'Listening…' : 'Ask a question, or paste your website address'}
        />
        <div className="lg-c-row">
          {onModeChange && (
            <button
              ref={modeBtnRef}
              type="button"
              className="lg-mode"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={isThinking}
            >
              <span style={{ color: 'var(--lg-fg-3)' }}>Answer</span>
              <b>{current.name}</b>
              <ICONS.ChevronDown />
            </button>
          )}
          <ComposerModelPicker disabled={isThinking} />
          <button
            type="button"
            className="lg-icon-btn"
            onClick={onVoiceToggle}
            disabled={isThinking || !liveVoiceAvailable()}
            title={liveVoiceAvailable() ? 'Live voice' : 'Live voice needs a Gemini API key in Settings'}
            aria-label={isVoiceActive ? 'Stop voice input' : 'Start live voice'}
            aria-pressed={isVoiceActive}
          >
            <ICONS.Mic />
          </button>
          {onClear && canClear && (
            <button type="button" className="lg-icon-btn" onClick={onClear} disabled={isThinking} title="Start a new thread" aria-label="Clear conversation">
              <ICONS.Refresh />
            </button>
          )}
          {showDraftNotice && <span className="lg-draft">Draft restored</span>}
          <button
            type="submit"
            className={`lg-send${isThinking ? ' lg-send--stop' : ''}`}
            disabled={!canSend}
            aria-label={isThinking ? 'Stop generating' : 'Send message'}
          >
            {isThinking ? <ICONS.Stop /> : <ICONS.Send />}
          </button>
        </div>
        {menuOpen && onModeChange && (
          <div className="lg-menu" role="menu" aria-label="Answer depth">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="menuitemradio"
                aria-checked={m.mode === mode}
                onClick={() => {
                  onModeChange(m.mode);
                  setMenuOpen(false);
                  modeBtnRef.current?.focus();
                }}
              >
                <b>{m.name}</b>
                <span>{m.line}</span>
              </button>
            ))}
          </div>
        )}
      </form>
      <p className="lg-disclose">Answers can be wrong. Check important facts before acting.</p>
    </div>
  );
};

export default InputBar;
