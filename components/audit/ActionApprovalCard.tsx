import React, { useState } from 'react';
import { VerifyCardData, VerifyStep } from '../../types';

interface ActionApprovalCardProps {
  card: VerifyCardData;
  onAction?: (actionType: string, payload?: string) => void;
  onDismiss?: () => void;
}

function StatusIndicator({ status }: { status: VerifyStep['status'] }) {
  if (status === 'running') {
    return (
      <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-gold/40 border-t-gold animate-spin shrink-0" />
    );
  }
  if (status === 'passed') {
    return (
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold shrink-0">
        ✓
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold shrink-0">
      ✕
    </span>
  );
}

export const ActionApprovalCard: React.FC<ActionApprovalCardProps> = ({ card, onAction, onDismiss }) => {
  const [isCollapsed, setIsCollapsed] = useState(card.steps.length > 5);
  const [copied, setCopied] = useState(false);

  const handleActionClick = () => {
    if (card.actionType === 'copy_fix' && card.actionPayload) {
      navigator.clipboard.writeText(card.actionPayload).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }).catch(() => {
        // Fallback or ignore
      });
    }
    if (onAction) {
      onAction(card.actionType, card.actionPayload);
    }
  };

  const allPassed = card.steps.every(s => s.status === 'passed');
  const hasFailed = card.steps.some(s => s.status === 'failed');
  const isRunning = card.steps.some(s => s.status === 'running');

  return (
    <div className="w-full my-4 rounded-2xl border border-gold/30 bg-black/60 backdrop-blur-md shadow-2xl overflow-hidden transition-all">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gold/10 via-transparent to-transparent border-b border-gold/15">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-gold animate-pulse shrink-0" />
          <h4 className="text-xs font-semibold text-gold-light tracking-wide uppercase truncate">
            {card.title}
          </h4>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isRunning
              ? 'bg-gold/15 text-gold'
              : allPassed
                ? 'bg-emerald-500/15 text-emerald-300'
                : hasFailed
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-white/10 text-gray-300'
          }`}>
            {isRunning ? 'Analyzing' : allPassed ? 'Verified' : 'Action Required'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand steps' : 'Collapse steps'}
            className="p-1 rounded text-gray-400 hover:text-gold transition-colors text-xs"
          >
            {isCollapsed ? 'Show Details ▼' : 'Hide ▲'}
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss card"
              className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Verification Steps */}
      {!isCollapsed && card.steps.length > 0 && (
        <div className="px-4 py-3 space-y-2 border-b border-white/5 bg-black/30">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Verification Steps
          </p>
          <ul className="space-y-1.5">
            {card.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2 text-xs">
                <StatusIndicator status={step.status} />
                <div className="flex-1 min-w-0">
                  <span className="text-gray-200 font-medium">{step.label}</span>
                  {step.detail && (
                    <span className="block text-[11px] text-gray-400 mt-0.5">{step.detail}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Verdict & One Action (APS Invariant 4) */}
      <div className="p-4 space-y-3">
        <div className="bg-gold/5 border border-gold/20 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-gold uppercase tracking-wider mb-1">
            Verdict
          </p>
          <p className="text-xs text-gray-200 leading-relaxed font-sans">
            {card.verdict}
          </p>
        </div>

        {/* Action Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleActionClick}
            className="px-4 py-2 rounded-xl bg-gold text-black hover:bg-gold-light active:scale-[0.98] transition-all text-xs font-semibold tracking-wide shadow-lg shadow-gold/20 flex items-center gap-1.5"
          >
            {copied ? '✓ Copied to Clipboard!' : card.actionText}
          </button>

          {card.reportUrl && (
            <a
              href={card.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gold/80 hover:text-gold underline underline-offset-4 transition-colors"
            >
              View Full Report →
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

const VERIFY_CARD_REGEX = /<!--verify-card:([\s\S]*?)-->/;

/**
 * Extracts embedded verify-card JSON metadata from message text.
 * Strips the comment tag so raw markdown displays cleanly.
 */
export function extractVerifyCardFromContent(content: string): {
  cleanContent: string;
  verifyCard?: VerifyCardData;
} {
  const match = content.match(VERIFY_CARD_REGEX);
  if (!match) {
    return { cleanContent: content };
  }

  try {
    const parsed = JSON.parse(match[1]) as VerifyCardData;
    if (parsed && typeof parsed.title === 'string' && typeof parsed.verdict === 'string') {
      const clean = content.replace(VERIFY_CARD_REGEX, '').trim();
      return { cleanContent: clean, verifyCard: parsed };
    }
  } catch {
    // Malformed JSON comment; ignore gracefully
  }

  return { cleanContent: content };
}
