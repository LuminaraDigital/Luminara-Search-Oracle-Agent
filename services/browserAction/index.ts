/**
 * Indexed DOM action-agent policy (Wave B2).
 */
export { buildActionSpace, OPERATION_LABELS } from './actionSpace';
export {
  validateChoice,
  buildChoosePromptState,
  parseChooseResult,
  chooseWithLlm,
  ValueError,
} from './choose';
export {
  fieldContext,
  parseFieldTextResponse,
  fieldTextWithLlm,
  fieldContextCacheKey,
} from './fieldText';
export { BrowserActionLoop, predict, act, tick } from './loop';
export { verifyDone } from './verify';
export {
  BROWSE_OBSERVE_TOOL,
  BROWSE_ACT_TOOL,
  BROWSE_GOAL_TOOL,
  BROWSE_CLOSE_TOOL,
  BROWSER_ACTION_CATALOGUE,
} from './catalogue';
export { executeBrowserActionTool } from './execute';
export type { BrowserActionRuntime } from './execute';
export type {
  ActionKind,
  ActionSpace,
  ActRequest,
  ChoiceAnswer,
  ChooseLlmRaw,
  ChoosePromptState,
  Decision,
  ExecuteActFn,
  FieldContext,
  HistoryEntry,
  IndexedElement,
  LlmFn,
  LoopState,
  LoopStatus,
  ObserveFn,
  ObservePayload,
  ObservedAction,
  Operation,
  PrimaryOperation,
  SelectOption,
  VerifyCheckDetail,
  VerifyChecks,
  VerifyResult,
} from './types';
export {
  StalePageError,
  DEFAULT_MAX_STEPS,
  KIND_TO_OPERATION,
  OPERATION_TARGET_KEY,
} from './types';
