/**
 * Build indexed action space from observe actions (Jev model.action_space port).
 */
import {
  KIND_TO_OPERATION,
  type ActionSpace,
  type IndexedElement,
  type ObservedAction,
} from './types';

const DONE_CONTROL: ObservedAction = {
  id: 'DONE',
  kind: 'done',
  label: 'Every requirement is visibly satisfied.',
  node: 'DONE',
};

const BLOCKED_CONTROL: ObservedAction = {
  id: 'BLOCKED',
  kind: 'blocked',
  label: 'No supported operation can progress.',
  node: 'BLOCKED',
};

/**
 * One index per observed element node; each primary operation has its own target map.
 * Scroll/wait become controls. DONE and BLOCKED are always offered.
 */
export function buildActionSpace(actions: ObservedAction[]): ActionSpace {
  const elements: IndexedElement[] = [];
  const indices: Record<string, string> = {};
  const targets: Record<string, Record<string, ObservedAction>> = {};
  const controls: Record<string, ObservedAction> = {
    DONE: DONE_CONTROL,
    BLOCKED: BLOCKED_CONTROL,
  };

  for (const action of actions) {
    const kind = action.kind;
    const operation = KIND_TO_OPERATION[kind];
    if (!operation) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }

    const node = action.node;
    if (!(node in indices)) {
      const index = String(elements.length + 1);
      indices[node] = index;
      const element: IndexedElement = {
        index,
        label: action.label.split(' → ')[0] ?? action.label,
        operations: [],
        ...(action.role !== undefined ? { role: action.role } : {}),
        ...(action.value !== undefined ? { value: action.value } : {}),
        ...(action.checked !== undefined ? { checked: action.checked } : {}),
        ...(action.selected !== undefined ? { selected: action.selected } : {}),
        ...(action.expanded !== undefined ? { expanded: action.expanded } : {}),
      };
      if (kind === 'select') {
        element.value = action.current_value ?? '';
        element.options = [];
      }
      elements.push(element);
    }

    const index = indices[node];
    const group = (targets[operation] ??= {});
    const element = elements[Number(index) - 1];
    if (!element.operations.includes(operation)) {
      element.operations.push(operation);
    }

    let target = index;
    if (kind === 'select') {
      const options = element.options ?? (element.options = []);
      target = `${index}:${options.length + 1}`;
      options.push({
        index: target,
        label: action.label,
        value: action.value,
      });
    }
    group[target] = action;
  }

  return { elements, targets, controls };
}

export const OPERATION_LABELS: Record<string, string> = {
  CLICK: 'Click an element, button, menu option, autocomplete suggestion, or calendar day.',
  TYPE_TEXT: 'Enter or replace text in an editable field. A small LLM will supply the value from the goal.',
  SELECT: 'Select an observed dropdown value.',
};
