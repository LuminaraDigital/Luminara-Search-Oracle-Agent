/**
 * One LLM decision: operation + selected operation's target (indexes only).
 */
import { buildActionSpace, OPERATION_LABELS } from './actionSpace';
import {
  OPERATION_TARGET_KEY,
  type ChoiceAnswer,
  type ChooseLlmRaw,
  type ChoosePromptState,
  type Decision,
  type HistoryEntry,
  type LlmFn,
  type ObservePayload,
  type PrimaryOperation,
} from './types';

const CHOOSE_RULES = [
  'Pick exactly one operation from the offered operations list.',
  'For CLICK, TYPE_TEXT, or SELECT, also pick the matching *_target index from that operation head only.',
  'Targets are offered indexes only (e.g. "1", "2:1"). Never emit CSS selectors, XPath, coordinates, or executable JavaScript.',
  'DONE means every requirement is visibly satisfied on the current page. BLOCKED means no supported operation can progress.',
];

function idSet(ids: string[] | Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(ids) ? ids : Object.keys(ids));
}

/**
 * Pure validation of a choice answer (Jev validate_choice contract).
 * Rejects mismatched keys, non-finite probs, sum drift, or non-max chosen id.
 */
export function validateChoice(
  answer: Partial<ChoiceAnswer> | Record<string, unknown> | null | undefined,
  ids: string[] | Record<string, unknown>,
): ChoiceAnswer {
  const allowed = idSet(ids);
  let valid = false;
  let choice = '';
  let probabilities: Record<string, number> = {};
  let confidence = 0;

  try {
    if (!answer || typeof answer !== 'object') throw new Error('missing');
    const rawChoice = (answer as ChoiceAnswer).choice;
    const rawProbs = (answer as ChoiceAnswer).probabilities;
    const rawConf = (answer as ChoiceAnswer).confidence;
    if (typeof rawChoice !== 'string' || !rawProbs || typeof rawProbs !== 'object') {
      throw new Error('shape');
    }
    choice = rawChoice;
    probabilities = rawProbs as Record<string, number>;
    confidence = Number(rawConf);

    const numbers = [...Object.values(probabilities), confidence];
    const keys = new Set(Object.keys(probabilities));
    const sum = Object.values(probabilities).reduce((a, b) => a + Number(b), 0);
    const maxProb = Math.max(...Object.values(probabilities).map(Number));
    valid =
      allowed.has(choice) &&
      keys.size === allowed.size &&
      [...allowed].every((id) => keys.has(id)) &&
      numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
      Math.abs(sum - 1) < 0.02 &&
      Number(probabilities[choice]) >= maxProb - 1e-6;
  } catch {
    valid = false;
  }

  if (!valid) {
    throw new ValueError('Invalid choice response; no action executed.');
  }
  return { choice, probabilities, confidence };
}

/** Lightweight Error subclass with a stable name for tests. */
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}

export function buildChoosePromptState(
  page: ObservePayload,
  goal: string,
  history: HistoryEntry[],
): ChoosePromptState {
  const { elements, targets, controls } = buildActionSpace(page.actions);

  const operations: Record<string, string> = {};
  for (const key of Object.keys(targets)) {
    operations[key] = OPERATION_LABELS[key] ?? key;
  }
  for (const [key, value] of Object.entries(controls)) {
    operations[key] = value.label;
  }

  const target_heads: ChoosePromptState['target_heads'] = {};
  for (const [operation, candidates] of Object.entries(targets)) {
    const head: ChoosePromptState['target_heads'][string] = {};
    for (const [index, a] of Object.entries(candidates)) {
      head[index] = {
        element: `[${index}] ${a.label}`,
        current_value: a.current_value ?? a.value ?? '',
        ...(a.role !== undefined ? { role: a.role } : {}),
        ...(a.checked !== undefined ? { checked: a.checked } : {}),
        ...(a.selected !== undefined ? { selected: a.selected } : {}),
        ...(a.expanded !== undefined ? { expanded: a.expanded } : {}),
      };
    }
    target_heads[operation] = head;
  }

  return {
    goal,
    page: { url: page.url, title: page.title, text: page.text },
    elements,
    operations,
    target_heads,
    recent_actions: history.slice(-10).map((h) => ({
      action: h.action,
      kind: h.kind,
      text: h.text,
      page_changed: h.page_changed,
    })),
    rules: CHOOSE_RULES,
  };
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new ValueError('Choose helper returned no valid JSON; no action executed.');
  }
}

function assertNoSelectorLeak(raw: Record<string, unknown>): void {
  const banned = ['selector', 'xpath', 'css', 'javascript', 'evaluate', 'querySelector'];
  const blob = JSON.stringify(raw).toLowerCase();
  // Only reject explicit selector-like keys on the payload, not labels that mention "css".
  for (const key of Object.keys(raw)) {
    if (banned.includes(key.toLowerCase())) {
      throw new ValueError('Model emitted selector/JS fields; no action executed.');
    }
  }
  void blob;
}

/**
 * Parse LLM JSON into a Decision. Consumes only the selected operation's target head.
 */
export function parseChooseResult(
  raw: unknown,
  promptState: ChoosePromptState,
  page: ObservePayload,
): Decision {
  if (!raw || typeof raw !== 'object') {
    throw new ValueError('Invalid choose result; no action executed.');
  }
  const obj = raw as Record<string, unknown>;
  assertNoSelectorLeak(obj);

  const operation = String(obj.operation ?? '');
  const opProbs = (obj.operation_probabilities ?? {}) as Record<string, number>;
  const confidence = Number(obj.confidence);

  const opAnswer = validateChoice(
    { choice: operation, probabilities: opProbs, confidence },
    promptState.operations,
  );

  const { targets, controls } = buildActionSpace(page.actions);
  let choice: string;
  let target: string | null = null;
  let probabilities: Record<string, number> = {};
  let target_probabilities: Record<string, number> = {};
  let target_confidence: number | null = null;

  if (operation in targets) {
    const primary = operation as PrimaryOperation;
    const targetKey = OPERATION_TARGET_KEY[primary];
    const targetChoice = obj[targetKey];
    if (typeof targetChoice !== 'string') {
      throw new ValueError(`Missing ${targetKey} for ${operation}; no action executed.`);
    }
    const candidates = targets[operation];
    // Prefer explicit per-target probs when present; else peak on the chosen index.
    const explicitTargetProbs = obj[`${operation.toLowerCase()}_target_probabilities`];
    const keys = Object.keys(candidates);
    const targetProbs: Record<string, number> =
      explicitTargetProbs && typeof explicitTargetProbs === 'object'
        ? (explicitTargetProbs as Record<string, number>)
        : Object.fromEntries(keys.map((k) => [k, k === targetChoice ? 1 : 0]));

    const targetAnswer = validateChoice(
      { choice: targetChoice, probabilities: targetProbs, confidence },
      candidates,
    );
    target = targetAnswer.choice;
    target_probabilities = targetAnswer.probabilities;
    target_confidence = targetAnswer.confidence;
    choice = candidates[target].id;
    probabilities = Object.fromEntries(
      Object.entries(candidates).map(([index, a]) => [a.id, targetAnswer.probabilities[index] ?? 0]),
    );
  } else {
    choice = controls[operation]?.id ?? operation;
    probabilities = { [choice]: opAnswer.probabilities[operation] ?? 0 };
  }

  return {
    choice,
    operation,
    target,
    confidence: opAnswer.confidence,
    probabilities,
    operation_probabilities: opAnswer.probabilities,
    target_probabilities,
    target_confidence,
  };
}

function buildChoosePrompt(promptState: ChoosePromptState): string {
  return [
    'You choose the next browser action from an indexed DOM action space.',
    ...promptState.rules,
    '',
    'Respond with a single JSON object only, shaped as:',
    '{"operation":"...","operation_probabilities":{...},"confidence":0.0,"click_target":"...","type_text_target":"...","select_target":"..."}',
    'Include only the *_target field for the operation you selected (or all three speculative heads; only the selected op target is consumed).',
    'operation_probabilities must include every offered operation, sum to 1, and peak on your chosen operation.',
    '',
    JSON.stringify(promptState),
  ].join('\n');
}

/**
 * Ask an LLM for a choose decision and map indexes to observed action ids.
 */
export async function chooseWithLlm(
  state: ObservePayload,
  goal: string,
  history: HistoryEntry[],
  llmFn: LlmFn,
): Promise<Decision> {
  const promptState = buildChoosePromptState(state, goal, history);
  const rawText = await llmFn(buildChoosePrompt(promptState));
  let parsed: unknown;
  try {
    parsed = extractJsonObject(rawText);
  } catch (err) {
    if (err instanceof ValueError) throw err;
    throw new ValueError('Choose helper returned no valid JSON; no action executed.');
  }
  return parseChooseResult(parsed as ChooseLlmRaw, promptState, state);
}
