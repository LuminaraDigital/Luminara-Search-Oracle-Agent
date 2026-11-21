import React, { Suspense } from 'react';
import type { Message, OracleMode } from '../../types';
import type { Starter } from '../MessageList';
import { lazyWithReload } from '../../utils/lazyWithReload';

const MessageList = lazyWithReload(() => import('../MessageList'));
const InputBar = lazyWithReload(() => import('../InputBar'));

export function ChatTranscript(props: {
  messages: Message[];
  isThinking?: boolean;
  activeTool?: { name: string; stage: string; output?: string } | null;
  onSimplify?: (content: string) => void;
  agentStep?: string | null;
  onStop?: () => void;
  starters?: Starter[];
  onStarter?: (query: string) => void;
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
  onModeChange?: (mode: OracleMode) => void;
  onStop?: () => void;
  onClear?: () => void;
  canClear?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <InputBar {...props} />
    </Suspense>
  );
}
