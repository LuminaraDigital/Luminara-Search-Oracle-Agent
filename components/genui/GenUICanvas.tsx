import React, { useMemo } from 'react';
import { parseGenUI } from '../../services/genui/parser';
import { materializeNode } from '../../services/genui/materializer';
import { LUMINARA_GENUI_REGISTRY } from '../../services/genui/registry';
import { ActionHandler } from '../../services/genui/types';
import { GenUISkeleton } from './GenUISkeleton';

interface GenUICanvasProps {
  streamText: string;
  isStreaming?: boolean;
  onAction?: ActionHandler;
}

export const GenUICanvas: React.FC<GenUICanvasProps> = ({
  streamText,
  isStreaming,
  onAction,
}) => {
  const parseResult = useMemo(() => {
    return parseGenUI(streamText);
  }, [streamText]);

  const renderedContent = useMemo(() => {
    if (!parseResult.rootId) {
      return null;
    }
    try {
      return materializeNode(parseResult.rootId, parseResult, LUMINARA_GENUI_REGISTRY, onAction);
    } catch (err) {
      console.warn('[GenUICanvas] Materialization error:', err);
      return null;
    }
  }, [parseResult, onAction]);

  if (!renderedContent) {
    if (isStreaming) {
      return <GenUISkeleton />;
    }
    // If not streaming and nothing parsed, show raw text in subtle mono fallback
    return (
      <div className="my-2 p-3 rounded-xl border border-white/10 bg-black/40 text-xs font-mono text-gray-400 whitespace-pre-wrap">
        {streamText}
      </div>
    );
  }

  return (
    <div className="luminara-genui-canvas my-4 transition-all duration-300">
      {renderedContent}
    </div>
  );
};
