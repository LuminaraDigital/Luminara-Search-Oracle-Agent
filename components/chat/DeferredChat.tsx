import React, { Suspense } from 'react';
import type { Message, OracleMode } from '../../types';
import { lazyWithReload } from '../../utils/lazyWithReload';

const MessageList = lazyWithReload(() => import('../MessageList'));
const InputBar = lazyWithReload(() => import('../InputBar'));

export function ChatTranscript(props: {
  messages: Message[];
  isThinking?: boolean;
  activeTool?: { name: string; stage: string; output?: string } | null;
  onSimplify?: (content: string) => void;
}) {
  return (
    <Suspense fallback={null}>
      <MessageList {...props} />
    </Suspense>
  );
}

export function ChatComposer(props: {
  onSendMessage: (text: string) => void;
  onVoiceToggle: () => void;
  isVoiceActive: boolean;
  isThinking: boolean;
  mode: OracleMode;
}) {
  return (
    <Suspense fallback={null}>
      <InputBar {...props} />
    </Suspense>
  );
}
