import React, { useMemo } from 'react';
import { renderMarkdown } from '../../utils/markdown';
import { GenUICanvas } from './GenUICanvas';
import { ActionHandler } from '../../services/genui/types';

interface HybridMessageBodyProps {
  content: string;
  isStreaming?: boolean;
  onAction?: ActionHandler;
}

interface ContentSegment {
  type: 'markdown' | 'genui';
  text: string;
}

export const HybridMessageBody: React.FC<HybridMessageBodyProps> = ({
  content,
  isStreaming,
  onAction,
}) => {
  const segments = useMemo(() => {
    const parts: ContentSegment[] = [];
    if (!content.includes(':::genui')) {
      return [{ type: 'markdown' as const, text: content }];
    }

    const blockRegex = /:::genui\s*([\s\S]*?)(?::::|$)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(content)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        const textBefore = content.slice(lastIndex, matchIndex).trim();
        if (textBefore) {
          parts.push({ type: 'markdown', text: textBefore });
        }
      }

      const genuiCode = match[1].trim();
      if (genuiCode) {
        parts.push({ type: 'genui', text: genuiCode });
      }

      lastIndex = blockRegex.lastIndex;
      // If regex hit end of string without closing ':::', break to avoid hanging
      if (match[0].length === 0) {
        break;
      }
    }

    if (lastIndex < content.length) {
      const remaining = content.slice(lastIndex).trim();
      if (remaining) {
        parts.push({ type: 'markdown', text: remaining });
      }
    }

    return parts;
  }, [content]);

  return (
    <div className="space-y-4">
      {segments.map((seg, idx) => {
        if (seg.type === 'genui') {
          return (
            <GenUICanvas
              key={`genui-${idx}`}
              streamText={seg.text}
              isStreaming={isStreaming}
              onAction={onAction}
            />
          );
        }

        return (
          <div
            key={`md-${idx}`}
            className="markdown-content prose prose-invert max-w-none leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.text) }}
          />
        );
      })}
    </div>
  );
};
