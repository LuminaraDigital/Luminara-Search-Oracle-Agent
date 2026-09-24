/**
 * Indexed DOM action-agent types (Jev-pattern contract, Luminara-shaped).
 * Model decisions reference observed element indexes only - never selectors or JS.
 */

export type ActionKind = 'click' | 'fill' | 'select' | 'scroll' | 'wait' | 'done' | 'blocked';

/** Primary mutation operations derived from observed click/fill/select. */
export type PrimaryOperation = 'CLICK' | 'TYPE_TEXT' | 'SELECT';

/** Any offered operation key, including controls and terminal ops. */
export type Operation = PrimaryOperation | 'DONE' | 'BLOCKED' | string;

export type ObservedAction = {
  id: string;
  kind: ActionKind | string;
  label: string;
  /** Opaque node key used to index elements (same node can host multiple ops). */
  node: string;
  role?: string;
  value?: string;
  current_value?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
};

export type ObservePayload = {
  url: string;
  title: string;
  text: string;
  actions: ObservedAction[];
  fingerprint: string;
  marker?: string;
};

export type SelectOption = {
  index: string;
  label: string;
  value?: string;
};

export type IndexedElement = {
  index: string;
  label: string;
  operations: string[];
  role?: string;
  value?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  options?: SelectOption[];
};

export type ActionSpace = {
  elements: IndexedElement[];
  /** operation -> target index -> observed action */
  targets: Record<string, Record<string, ObservedAction>>;
  /** SCROLL_* and WAIT from observe, plus synthetic DONE/BLOCKED */
  controls: Record<string, ObservedAction>;
};

export type ChoiceAnswer = {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

/** LLM choose response shape (indexes only; no selectors). */
export type ChooseLlmRaw = {
  operation: string;
  operation_probabilities: Record<string, number>;
  confidence: number;
  click_target?: string;
  type_text_target?: string;
  select_target?: string;
};

export type Decision = {
  choice: string;
  operation: string;
  target: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  operation_probabilities: Record<string, number>;
  target_probabilities?: Record<string, number>;
  target_confidence?: number | null;
  text?: string;
};

export type HistoryEntry = {
  step: number;
  action: string;
  kind: string;
  choice: string;
  text?: string | null;
  operation?: string;
  target?: string | null;
  page_changed?: boolean | null;
  url?: string;
  confidence?: number;
  probability?: number;
};

export type LoopStatus = 'ready' | 'predicted' | 'done' | 'blocked' | 'error';

export type LoopState = {
  goal: string;
  page: ObservePayload;
  decision: Decision | null;
  history: HistoryEntry[];
  status: LoopStatus;
  decisions: Decision[];
  text_calls: Array<Record<string, unknown>>;
  maxSteps: number;
  elapsed_ms: number;
};

export type FieldContext = {
  goal: string;
  field: { label?: string; role?: string; value?: string };
  page: { title: string; text: string };
  recent_actions: Array<{ action?: string; text?: string | null }>;
};

export type VerifyChecks = {
  urlIncludes?: string | string[];
  textIncludes?: string | string[];
  titleIncludes?: string | string[];
};

export type VerifyCheckDetail = {
  check: string;
  result: 'pass' | 'fail' | 'not_measured';
  expected?: string;
  actual?: string;
};

export type VerifyResult = {
  ok: boolean;
  status: 'verified' | 'not_verified' | 'not_measured';
  details: VerifyCheckDetail[];
};

export type ChoosePromptState = {
  goal: string;
  page: { url: string; title: string; text: string };
  elements: IndexedElement[];
  operations: Record<string, string>;
  /** Speculative target heads keyed by operation (CLICK, TYPE_TEXT, SELECT). */
  target_heads: Record<
    string,
    Record<
      string,
      {
        element: string;
        current_value: string;
        role?: string;
        checked?: boolean;
        selected?: boolean;
        expanded?: boolean;
      }
    >
  >;
  recent_actions: Array<{
    action?: string;
    kind?: string;
    text?: string | null;
    page_changed?: boolean | null;
  }>;
  /** Instruction block: indexes only, never selectors/JS. */
  rules: string[];
};

export type ActRequest = {
  actionId: string;
  fingerprint: string;
  text?: string;
};

export type ExecuteActFn = (request: ActRequest) => Promise<ObservePayload>;

export type ObserveFn = () => Promise<ObservePayload>;

export type LlmFn = (prompt: string) => Promise<string>;

export class StalePageError extends Error {
  constructor(message = 'Page changed since the decision. Choose again.') {
    super(message);
    this.name = 'StalePageError';
  }
}

export const DEFAULT_MAX_STEPS = 15;

export const KIND_TO_OPERATION: Record<string, PrimaryOperation> = {
  click: 'CLICK',
  fill: 'TYPE_TEXT',
  select: 'SELECT',
};

export const OPERATION_TARGET_KEY: Record<PrimaryOperation, keyof ChooseLlmRaw> = {
  CLICK: 'click_target',
  TYPE_TEXT: 'type_text_target',
  SELECT: 'select_target',
};
